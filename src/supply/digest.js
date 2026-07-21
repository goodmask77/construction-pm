// 供應鏈 AI 資料摘要（純函式）——D哥(api/line-webhook.js) 與 App 全域 AI 顧問(App.jsx) 共用同一份
// 【100%資料鐵則】供應鏈新資料域一律加在這裡，兩邊自動同步接上，不准各寫各的
import { unitCost, lastPaid, srcsOf, latestRecipeOf, recipeCost, packToBase, priceAlert } from "./inv.js";

export function supplyDigest({ supply, orders, recipes }) {
  try {
    const db = supply || {};
    const parts = [];
    const nt = (n) => "NT$" + Math.round(n || 0).toLocaleString();
    const d3 = (n) => n >= 100 ? Math.round(n).toLocaleString() : Math.round(n * 1000) / 1000;
    const vname = (id) => ((db.vendors || []).find(v => v.id === id) || {}).name || "?";
    // 廠商
    if ((db.vendors || []).length) parts.push(`▍廠商（${db.vendors.length} 家；✓=正式供應商會進叫貨表）\n` + db.vendors.map(v => `- ${v.official ? "✓" : ""}${v.name || "（未命名）"}｜${(v.vcat || "未分類")}/${v.dept || "共用"}${v.lineGroupId ? "｜LINE群已綁可DD發單" : ""}${v.note ? "｜" + v.note : ""}`).join("\n"));
    // 物料清單（含比價/盤點設定/入數）
    const ings = (db.ingredients || []).filter(g => !g.nonStock);
    if (ings.length) {
      const fq = (f) => !f || f.type === "none" || !f.type ? "不盤" : (f.paused ? "⏸" : "") + (f.type === "daily" ? "每日" : f.type === "weekly" ? "每週" + (f.days || []).map(d => "日一二三四五六"[d]).join("") : "每月" + (f.dom || 1) + "日");
      parts.push(`▍物料清單（${ings.length} 項；★=重點比價；$=最近實付、報$=最新報價；成本一律用實付價）\n` + ings.map(g => {
        const ss = srcsOf(db, g.id);
        const us = ss.map(vi => ({ vi, u: unitCost(vi) })).filter(x => x.u != null).sort((a, b) => a.u - b.u);
        const sellers = ss.map(vi => { const lp = lastPaid(vi); return `${vname(vi.vendor_id)}${lp ? `$${d3(lp.price)}/${vi.unit || "件"}` : ""}${vi.quote && vi.quote.price ? `(報$${d3(vi.quote.price)})` : ""}${Number(vi.moq) > 0 ? `(MOQ${Number(vi.moq).toLocaleString()})` : ""}${vi.note ? `(${vi.note})` : ""}`; }).join("、");
        const pk = ss.find(vi => packToBase(vi));
        return `- ${g.isKey ? "★" : ""}${g.name}｜${(g.cat || "").trim() || "未分類"}｜盤點${fq(g.countFreq)}${g.safeStock ? `｜安全庫存${g.safeStock}${g.baseUnit}` : ""}${pk ? `｜1${pk.unit || "件"}=${Number(pk.packToBase).toLocaleString()}${g.baseUnit}` : ""}｜賣家:${sellers || "（沒人賣）"}${us.length ? `｜最低$${d3(us[0].u)}/${g.baseUnit}=${vname(us[0].vi.vendor_id)}` : ""}`;
      }).join("\n"));
    }
    // 最近變價（實付 vs 上次實付）
    const chg = (db.vendorItems || []).map(vi => ({ vi, al: priceAlert(vi, 0.01) })).filter(x => x.al);
    if (chg.length) parts.push("▍最近變價（叫貨實付價變動）\n" + chg.slice(0, 20).map(({ vi, al }) => `- ${vi.name}（${vname(vi.vendor_id)}）：$${vi.last.prevPrice}→$${vi.last.price}（${al.up ? "▲+" : "▼-"}${Math.abs(al.pct)}%）`).join("\n"));
    // 叫貨紀錄＋驗收問題追蹤
    const ods = Array.isArray(orders) ? orders : [];
    if (ods.length) {
      parts.push(`▍叫貨紀錄（最近 ${Math.min(ods.length, 15)} 筆／共 ${ods.length} 筆）\n` + ods.slice(0, 15).map(od => {
        const amt = (od.items || []).reduce((t, x) => t + (Number(x.price) || 0) * (x.qty || 0), 0);
        return `- ${(od.ts || "").slice(5, 10)} ${od.vendorName}｜${(od.items || []).map(x => `${x.name}×${x.qty}`).join("、")}｜${nt(amt)}｜${od.status}`;
      }).join("\n"));
      const okOpt = ((db.inspectOpts || ["✓ 正確"]))[0];
      const issues = [];
      ods.forEach(od => {
        const chk = od.check; if (!chk || !chk.items) return;
        (od.items || []).forEach((x, i) => {
          const ci = chk.items[i]; if (!ci || !ci.st || ci.st === okOpt) return;
          const st = (ci.fu && ci.fu.st) || "待處理";
          const log = ci.fu && ci.fu.log && ci.fu.log.length ? ci.fu.log[ci.fu.log.length - 1].text : "";
          issues.push(`- ${(od.ts || "").slice(5, 10)} ${od.vendorName}｜${x.name}｜${ci.st}${ci.note ? `(${ci.note})` : ""}｜追蹤:${st}${log ? "｜最新:" + log : ""}`);
        });
      });
      if (issues.length) parts.push("▍驗收問題追蹤\n" + issues.slice(0, 20).join("\n"));
    }
    // 食譜／成本（用料×最近實付價＋包材）
    const recs2 = Array.isArray(recipes) ? recipes : [];
    if (recs2.length && (db.products || []).length) {
      const lines = [];
      [...new Set(recs2.map(r => r.product_id))].forEach(pid => {
        const p = (db.products || []).find(x => x.id === pid); if (!p) return;
        const r = latestRecipeOf(recs2, pid); if (!r) return;
        const c = recipeCost(db, recs2, pid);
        const sell = Number(p.price) || 0;
        lines.push(`- ${p.name}：${(r.ingredients || []).map(li => { const g = (db.ingredients || []).find(x => x.id === li.ingredient_id); return `${g ? g.name : "?"}×${li.qty}${g ? g.baseUnit : ""}`; }).join("、") || "（未填用料）"}${(r.steps || []).length ? `｜SOP ${r.steps.length} 步` : ""}${c.total > 0 ? `｜成本${nt(c.total)}` : ""}${c.total > 0 && sell > 0 ? `｜售價${nt(sell)}｜毛利${Math.round((sell - c.total) / sell * 100)}%` : ""}${c.missing.length ? `｜⚠成本不完整:${c.missing.join(";")}` : ""}`);
      });
      if (lines.length) parts.push("▍食譜/成本（" + lines.length + " 道；成本=用料×最近實付價+包材）\n" + lines.join("\n"));
    }
    // 菜單產品（無食譜的也列名）
    if ((db.products || []).length) {
      const byCat = {};
      db.products.forEach(x => { (byCat[x.category || "未分類"] = byCat[x.category || "未分類"] || []).push(x.name); });
      parts.push(`▍菜單（${db.products.length} 項）\n` + Object.entries(byCat).map(([c2, arr]) => `- ${c2}：${arr.join("、")}`).join("\n"));
    }
    return parts.length ? "\n\n【供應鏈全域資料（廠商/物料比價/變價/叫貨驗收/食譜成本）】\n（進價流水 pm_price_ 與報價流水 pm_quote_ 每筆都在庫；下面已列最新值，要查歷史走勢請張良叫 Claude 撈）\n" + parts.join("\n") : "";
  } catch (_) { return ""; }
}
