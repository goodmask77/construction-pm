// ── AI 共用層：用量計價／callAI／顧問 system prompt（由 App.jsx 原樣搬出，2026-07-18 拆檔第二刀；行為零改變）──
// App（全域AI/細項AI）、設定頁（AI設定/用量）、工程專案（儀表板/比價/零用金）共用同一套。
import { K, conf } from "./runtime.js";
import { catRawEst, catEstAfter, catPaid, isFundingCat } from "./cost.js";

const MODEL_PRICES = [
  [/opus/i,            [15, 75]],
  [/haiku/i,           [1, 5]],
  [/sonnet/i,          [3, 15]],
  [/claude-3-5-sonnet/i, [3, 15]],
];
const PRICE_DEFAULT = [3, 15];
export const USD_TWD = 32.5; // 估算匯率（USD→TWD，可日後調整）
const priceFor = (model) => (MODEL_PRICES.find(([re]) => re.test(model || ""))?.[1]) || PRICE_DEFAULT;
async function recordAIUsage(model, usage, kind = "chat") {
  if (!usage) return;
  const inTok = Number(usage.input_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  if (inTok + outTok === 0) return;
  const [pin, pout] = priceFor(model);
  const usd = inTok / 1e6 * pin + outTok / 1e6 * pout;
  try {
    const r = await window.storage.get(K("pm_ai_usage"), true);
    let log = [];
    if (r && r.value) { try { log = JSON.parse(r.value); } catch (_) {} }
    log.push({ ts: new Date().toISOString(), model: model || "?", kind, inTok, outTok, usd });
    if (log.length > 2000) log = log.slice(-2000);
    await window.storage.set(K("pm_ai_usage"), JSON.stringify(log), true);
  } catch (_) {}
}

export async function callAI(messages, systemPrompt, kind = "chat", extSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000); // 逾時保護：避免大圖/PDF 解析永遠卡住
  if (extSignal) { if (extSignal.aborted) ctrl.abort(); else extSignal.addEventListener("abort", () => ctrl.abort()); } // 外部「取消」也能中斷
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system: systemPrompt }),
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok) return data.error || "（AI 顧問尚未設定，請於 Vercel 加入 ANTHROPIC_API_KEY）";
    if (data.usage) recordAIUsage(data.model, data.usage, kind); // 記錄用量＋用途（不阻塞回覆）
    return data.content?.map(b => b.text || "").join("") || "（AI無回應）";
  } catch (e) {
    return e?.name === "AbortError" ? "（AI 解析逾時，請改用較清晰或較小的檔案再試）" : "（AI 連線失敗，請稍後再試）";
  } finally {
    clearTimeout(timer);
  }
}
export const KIND_LABEL = { chat: "AI 顧問對話", import: "PDF/估價單匯入", weekly: "AI 週報", compare: "估價單比價", tidy: "日誌整理" };

export const buildAdvisorSystem = (settings, cats, journal, events, plans) => {
  journal = journal || [];
  events = events || [];
  plans = plans || [];
  const totalEst = cats.filter(c=>!isFundingCat(c)).reduce((s,c) => s+catEstAfter(c),0); // 議價後含稅總額（排除撥款帳）
  const totalAct = cats.filter(c=>!isFundingCat(c)).reduce((s,c) => s+catPaid(c),0); // 已付總額（排除撥款帳）
  const doneItems = cats.flatMap(c=>c.items).filter(i=>i.done||i.status==="done").length;
  const totalItems = cats.reduce((s,c)=>s+c.items.length,0);
  const issueItems = cats.flatMap(c=>c.items).filter(i=>i.status==="issue");
  const today = new Date().toLocaleDateString("zh-TW");
  const targetDate = settings?.targetDate || "未設定";
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;
  const projectName = settings?.projectName || "宏匯 GROUN:D";
  const projectAddr = settings?.projectAddress || "台北市內湖區瑞光路337號";
  const owner = settings?.ownerName || "業主";
  const contractor = settings?.contractorName || "碩藝室內裝修";
  const notes = settings?.notes || "";

  const catLines = cats.map(c => {
    const est = catEstAfter(c); // 議價後
    const raw = catRawEst(c);
    const act = catPaid(c);
    const done = c.items.filter(i=>i.done||i.status==="done").length;
    const dInfo = (raw > est) ? "（原報價" + Math.round(raw/10000) + "萬，議價省" + Math.round((raw-est)/10000) + "萬）" : "";
    return "  • " + c.name + "（" + c.status + "）：預估" + Math.round(est/10000) + "萬" + dInfo + "，已付" + (act>0?Math.round(act/10000)+"萬":"未付") + "，" + done + "/" + c.items.length + "細項完成";
  }).join("\n");

  const priorityItems = cats.flatMap(c=>c.items).filter(i=>i.priority || (settings?.priorities||[]).includes(i.id)).map(i=>i.name).join("、");

  return (conf().aiRole ? conf().aiRole + "\n\n" : "") + "你是專屬於「" + projectName + "」的" + (conf().aiRole ? "助理" : "AI工程總顧問") + "，以下是今日（" + today + "）的完整狀態，請根據此資料進行分析與回應。\n\n" +
    "【專案基本資訊】\n" +
    "- 專案名稱：" + projectName + "\n" +
    "- 地址：" + projectAddr + "\n" +
    "- 業主：" + owner + "\n" +
    "- 承包商：" + contractor + "\n" +
    "- 目標完工日：" + targetDate + (daysLeft !== null ? "（距今 "+daysLeft+" 天）" : "") + "\n" +
    "- 今日日期：" + today + "\n" +
    (notes ? "- 特別指示："+notes+"\n" : "") +
    ((settings?.aiDocs||[]).length ? "- 知識庫參考檔："+(settings.aiDocs||[]).map(d=>d.name).join("、")+"\n" : "") +
    "\n【財務狀況】\n" +
    "- 預估總額（含稅）：NT$" + Math.round(totalEst).toLocaleString() + "\n" +
    "- 已付總額：" + (totalAct>0?"NT$"+Math.round(totalAct).toLocaleString():"尚未付款") + "\n" +
    "- 未付總額：NT$" + Math.round(totalEst-totalAct).toLocaleString() + (totalAct>totalEst?"（溢付）":"") + "\n" +
    "\n【工程進度】\n" +
    "- 完成細項：" + doneItems + " / " + totalItems + "（" + Math.round(doneItems/Math.max(totalItems,1)*100) + "%）\n" +
    (issueItems.length>0?"- ⚠️ 有問題項目："+issueItems.map(i=>i.name).join("、")+"\n":"") +
    (priorityItems?"- ⭐ 標記優先項目："+priorityItems+"\n":"") +
    "\n【各大項狀態】\n" + catLines + "\n" +
    "\n【你的核心任務】\n" +
    "1. 每日追蹤：主動詢問各工程進度、是否有阻礙、材料是否到位\n" +
    "2. 優先序管理：依照工序相依性、距完工日時間、風險程度排列當前最優先事項\n" +
    "3. 衝突偵測：檢查工序時間衝突、預算超支風險、未分配項目\n" +
    "4. 進度推演：根據目前進度推算能否如期完工，給出預警\n" +
    "5. 決策建議：當發現問題主動提出具體解決方案（不只指出問題）\n\n" +
    (journal.length>0 ? "\n【最近工作日誌（" + journal.length + "筆）】\n" + journal.slice(0,10).map(j => "• " + (j.date||"") + " 「" + (j.title||"") + "」: " + (j.content||"").slice(0,80)).join("\n") + "\n" : "") +
    (events.length>0 ? "\n【近期行事曆】\n" + events.filter(e => new Date(e.date) >= new Date(Date.now()-7*24*3600*1000)).slice(0,15).map(e => "• " + e.date + " " + e.title + (e.catName?"（"+e.catName+"）":"")).join("\n") + "\n" : "") +
    (plans.length>0 ? "\n【未來排程任務】\n" + plans.filter(p => !p.done).slice(0,20).map(p => "• [" + (p.priority||"中")+"] " + p.title + (p.dueDate?" — 截止 "+p.dueDate:"")).join("\n") + "\n" : "") +
    "\n請用繁體中文回答，條理清晰，必要時用編號清單，關鍵數字請標示清楚。\n當使用者提供新資料時：主動協助歸檔、分析、整理；當發現工序/工法/成本不合理處：結合理論與實務經驗提出優化建議；當某項目太久沒更新：提醒可能跟不上進度；每天被要求時：輸出當日執行計劃與檢核表。";
};