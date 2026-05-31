import { useState, useEffect, useRef, useCallback } from "react";
import { supabase, CLIENT_ID, DOC_KEYS, loadData, saveData, loadGlobalChat, saveGlobalChat } from "./supa.js";

const ACCENT = "#E8B84B";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// ── INITIAL DATA from JOEL FAST CASUAL quote ──────────────────────────────────
const INITIAL_CATEGORIES = [
  {
    id: "cat-1", order: 0, name: "假設工程", budget: 364450, status: "pending",
    items: [
      { id: "i-1-1", name: "配合現場施工之放樣工資", qty: 251, unit: "M²", unitPrice: 200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "含機電出口點位", chat: [] },
      { id: "i-1-2", name: "樣品及打版費用", qty: 1, unit: "式", unitPrice: 25000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-3", name: "原建物戶外地坪保護工程(防潮布+9MM夾板)", qty: 67, unit: "M²", unitPrice: 500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-4", name: "施工中場地清潔及整頓維護", qty: 251, unit: "M²", unitPrice: 120, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-5", name: "施工過程廢棄物清運及搬運", qty: 6, unit: "車", unitPrice: 18000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-6", name: "完工現場細部清潔", qty: 251, unit: "M²", unitPrice: 180, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-7", name: "臨時施工照明及動力，臨時分電盤建置", qty: 1, unit: "式", unitPrice: 25000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-8", name: "施工圍籬及防護措施", qty: 43.5, unit: "尺", unitPrice: 700, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-1-9", name: "施工中組合式活動鷹架工程", qty: 2, unit: "式", unitPrice: 8500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-2", order: 1, name: "拆除工程", budget: 154580, status: "pending",
    items: [
      { id: "i-2-1", name: "全室既有地坪打毛粗底", qty: 251, unit: "M²", unitPrice: 180, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-2-2", name: "既有廚房防火門拆除", qty: 1, unit: "樘", unitPrice: 5000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-2-3", name: "既有廚房隔間拆除", qty: 36, unit: "M²", unitPrice: 900, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-2-4", name: "拆除廢棄物清運及搬運", qty: 4, unit: "車", unitPrice: 18000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-3", order: 2, name: "隔間工程", budget: 546400, status: "pending",
    items: [
      { id: "i-3-1", name: "雙面單層(92mm骨料+雙面12mm矽酸鈣板+60K岩棉)", qty: 183, unit: "M²", unitPrice: 2500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-3-2", name: "單面單層(92mm骨料+單面12mm矽酸鈣板)", qty: 35.5, unit: "M²", unitPrice: 1800, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-3-3", name: "牆面結構補強作業", qty: 1, unit: "式", unitPrice: 25000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-4", order: 3, name: "天花工程", budget: 886280, status: "pending",
    items: [
      { id: "i-4-1", name: "座位區天花既有管路噴漆", qty: 111, unit: "M²", unitPrice: 480, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-4-2", name: "座位區天花新增鋁格柵造型W:3CM*H:10CM間距10CM", qty: 77, unit: "M²", unitPrice: 5000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-4-3", name: "天花造型吊飾金屬結構補強", qty: 1, unit: "式", unitPrice: 20000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-4-4", name: "吧檯上方天花立板H:35CM", qty: 14, unit: "M", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-4-5", name: "吧檯上方天花立板面貼長城板（綺利）", qty: 46.6, unit: "尺", unitPrice: 3500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-4-6", name: "廚房區60*60明架礦纖板天花", qty: 140, unit: "M²", unitPrice: 480, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-5", order: 4, name: "地坪工程", budget: 1450350, status: "pending",
    items: [
      { id: "i-5-1", name: "座位區地坪打底", qty: 111, unit: "M²", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-2", name: "座位區地坪面貼44*44磁磚工資", qty: 111, unit: "M²", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-3", name: "座位區地坪面貼44*44磁磚材料（喜地CWO444401）", qty: 111, unit: "M²", unitPrice: 2650, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "喜地CWO444401", chat: [] },
      { id: "i-5-4", name: "廚房區地坪防水施作", qty: 140, unit: "M²", unitPrice: 400, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-5", name: "廚房區地坪灌漿增築(輕質灌漿)H:10CM", qty: 140, unit: "M²", unitPrice: 2400, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "附輕質混凝土材料證明", chat: [] },
      { id: "i-5-6", name: "廚房區地坪鋪設EPS高密度保麗龍板材料(6CM)", qty: 140, unit: "M²", unitPrice: 300, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-7", name: "廚房區地坪鋪設EPS保麗龍板工資", qty: 140, unit: "M²", unitPrice: 250, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-8", name: "廚房區地坪打底粉光", qty: 140, unit: "M²", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-9", name: "廚房區地坪面貼30*30磁磚工資", qty: 140, unit: "M²", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-5-10", name: "廚房區地坪面貼30*30磁磚材料（止滑磚）", qty: 140, unit: "M²", unitPrice: 520, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "止滑磚預算內選材", chat: [] },
      { id: "i-5-11", name: "廚房入口高低踏階不鏽鋼收邊框", qty: 3, unit: "M", unitPrice: 4000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-6", order: 5, name: "牆面工程", budget: 1714475, status: "pending",
    items: [
      { id: "i-6-1", name: "入口自動門W:300CM*H:320CM", qty: 1, unit: "樘", unitPrice: 65000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-6-2", name: "入口自動門機組", qty: 1, unit: "組", unitPrice: 30000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-6-3", name: "入口右側形象牆鋁格柵造型W:3CM*H:10CM間距5CM", qty: 15.5, unit: "M²", unitPrice: 8000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-6-4", name: "座位區全區牆面面貼10*30磁磚工資", qty: 121, unit: "M²", unitPrice: 1200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-6-5", name: "座位區全區牆面面貼10*30磁磚材料（喜地CVT130022）", qty: 121, unit: "M²", unitPrice: 950, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "喜地CVT130022", chat: [] },
      { id: "i-6-6", name: "服務櫃台面木作造型格柵面貼長城板（綺利）", qty: 41, unit: "尺", unitPrice: 9000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️沒詳圖", chat: [] },
      { id: "i-6-7", name: "服務櫃台面人造石", qty: 360, unit: "CM", unitPrice: 180, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️沒詳圖", chat: [] },
      { id: "i-6-8", name: "服務櫃台面10MM強化玻璃隔屏", qty: 3, unit: "才", unitPrice: 350, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️沒詳圖", chat: [] },
      { id: "i-6-9", name: "廚房區全室牆面防水施作H:120CM", qty: 69, unit: "M²", unitPrice: 400, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-7", order: 6, name: "活動道具工程", budget: 663970, status: "pending",
    items: [
      { id: "i-7-1", name: "座位區木作造型卡座面貼實木木板", qty: 25.5, unit: "尺", unitPrice: 6000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-7-2", name: "入口右側零售展示檯", qty: 12.5, unit: "尺", unitPrice: 7500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-7-3", name: "橢圓木作造型零售展示檯", qty: 7.5, unit: "尺", unitPrice: 7500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-8", order: 7, name: "機電工程", budget: 1538220, status: "pending",
    items: [
      { id: "i-8-1", name: "1樓電器室匯流排至一次側無熔絲開關3P40A", qty: 1, unit: "處", unitPrice: 12000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-2", name: "15KVA油浸式變壓器管線配置", qty: 1, unit: "台", unitPrice: 70000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-3", name: "蒸烤箱專迴-380v-8平方", qty: 1, unit: "迴", unitPrice: 18000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-4", name: "電炸爐[雙缸]-380v-22平方", qty: 2, unit: "迴", unitPrice: 33000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-5", name: "全自動咖啡機-220v-8平方", qty: 2, unit: "迴", unitPrice: 13000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-6", name: "冷給水管出口配置[白鐵壓接管]", qty: 21, unit: "處", unitPrice: 3300, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-7", name: "排水口-2吋", qty: 41, unit: "處", unitPrice: 1500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-8-8", name: "全室ENT電管及中繼電箱配置", qty: 1, unit: "式", unitPrice: 71500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-9", order: 8, name: "空調工程（大金VRV）", budget: 1584596, status: "pending",
    items: [
      { id: "i-9-1", name: "RXYMQ10TYLT 室外機主機 ×3組", qty: 3, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "大金VRV IV S SERIES", chat: [] },
      { id: "i-9-2", name: "FXMQ124PAVT 客席區吊隱式分機 14.0KW", qty: 2, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-9-3", name: "FXFQ80BVT 廚房四方吹分機 9.0KW ×3", qty: 3, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-9-4", name: "銅管規格36 ×5箱", qty: 5, unit: "箱", unitPrice: 22000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-9-5", name: "空調安裝工資", qty: 1, unit: "式", unitPrice: 200000, labor: 200000, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-10", order: 9, name: "消防工程", budget: 630525, status: "pending",
    items: [
      { id: "i-10-1", name: "R型總機程式設定", qty: 1, unit: "式", unitPrice: 87500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️費用偏高需確認廠牌型號", chat: [] },
      { id: "i-10-2", name: "圖控軟體修改", qty: 1, unit: "式", unitPrice: 37500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️需要書面說明工作項目", chat: [] },
      { id: "i-10-3", name: "既有撒水頭移位安裝", qty: 28, unit: "只", unitPrice: 3200, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-10-4", name: "排煙風管修改延伸", qty: 1, unit: "式", unitPrice: 75000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
      { id: "i-10-5", name: "簡易裝修消防設備師簽證", qty: 1, unit: "式", unitPrice: 20000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
    ]
  },
  {
    id: "cat-11", order: 10, name: "燈具工程", budget: 220000, status: "pending",
    items: [
      { id: "i-11-1", name: "燈具工程（暫估）", qty: 1, unit: "式", unitPrice: 220000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "⚠️無規範暫估，後須依實際需求確認", chat: [] },
    ]
  },
  {
    id: "cat-12", order: 11, name: "弱電工程（業主自理）", budget: 0, status: "pending",
    items: [
      { id: "i-12-1", name: "POS系統佈線", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理，需另行詢價", chat: [] },
      { id: "i-12-2", name: "監控攝影系統", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理，需另行詢價", chat: [] },
      { id: "i-12-3", name: "網路佈線", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理，需另行詢價", chat: [] },
    ]
  },
  {
    id: "cat-13", order: 12, name: "招牌工程（業主自理）", budget: 0, status: "pending",
    items: [
      { id: "i-13-1", name: "服務櫃台背牆電視螢幕 ×11座", qty: 11, unit: "座", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理", chat: [] },
      { id: "i-13-2", name: "戶外入口橫招 9.5M²", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理", chat: [] },
    ]
  },
  {
    id: "cat-14", order: 13, name: "活動家具工程（業主自理）", budget: 0, status: "pending",
    items: [
      { id: "i-14-1", name: "餐桌椅採購", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "業主自理，預估50~200萬", chat: [] },
    ]
  },
];

const STATUS_MAP = {
  pending:     { label: "待開工", color: "#6b7280" },
  inprogress:  { label: "進行中", color: "#4b9fe8" },
  done:        { label: "完工",   color: "#4be87a" },
  issue:       { label: "有問題", color: "#e85c4b" },
  hold:        { label: "暫停",   color: "#e8954b" },
};

const fmt = (n) => "NT$" + Math.round(n || 0).toLocaleString();
const calcEstimated = (it) => (it.estQty || it.qty || 0) * (it.estUnitPrice || it.unitPrice || 0) + (it.estLabor || 0);
const calcActual = (it) => (it.actQty || 0) * (it.actUnitPrice || 0) + (it.actWorkers || 0) * (it.actDailyWage || 0) * (it.actLaborDays || 0);
const calcItemTotal = (it) => calcEstimated(it);

// ── STORAGE：改由 ./supa.js 提供（Supabase 共用後端，未設定時退回 localStorage）──

// ── AI CALL（改走後端代理 /api/ai，金鑰由伺服器環境變數提供）────────────────────
async function callAI(messages, systemPrompt) {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system: systemPrompt }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || "（AI 顧問尚未設定，請於 Vercel 加入 ANTHROPIC_API_KEY）";
    return data.content?.map(b => b.text || "").join("") || "（AI無回應）";
  } catch (e) {
    return "（AI 連線失敗，請稍後再試）";
  }
}

const SYSTEM_GLOBAL = `你是一位專業餐廳裝修工程顧問，熟悉台灣室內裝修市場行情與法規。你正在協助一個餐廳裝修專案管理系統，專案為「宏匯 JOEL FAST CASUAL」位於台北市內湖區瑞光路337號，總預算含稅約1166萬元。
你的職責：
1. 主動提醒潛在問題（如「沒詳圖」風險、業主自理項目預算缺口）
2. 提供市場行情建議與議價策略
3. 協助安排工序與時程
4. 記錄重要決策與待辦事項
請用繁體中文回答，簡潔專業，必要時條列重點。`;

const SYSTEM_ITEM = (catName, itemName) => `你是一位專業餐廳裝修工程顧問。目前討論的工程項目是：【${catName}】中的【${itemName}】。請針對此具體項目提供專業建議，包括施工要點、常見問題、驗收標準、市場行情等。用繁體中文回答。`;

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [cats, setCats] = useState(null);
  const [view, setView] = useState("kanban"); // kanban | list | gantt
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [globalChat, setGlobalChat] = useState([]);
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [saving, setSaving] = useState(false);
  const [collabPing, setCollabPing] = useState(false);
  const skipSave = useRef(false); // 套用協作者更新時，跳過下一次自動儲存（避免回音/乒乓）
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  // load
  useEffect(() => {
    (async () => {
      const d = await loadData();
      setCats(d || INITIAL_CATEGORIES);
      const gc = await loadGlobalChat();
      setGlobalChat(gc);
    })();
  }, []);

  // auto-save（協作者更新套用後跳過一次，避免乒乓）
  useEffect(() => {
    if (!cats) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSaving(true);
    const t = setTimeout(async () => {
      await saveData(cats);
      setSaving(false);
    }, 1200);
    return () => clearTimeout(t);
  }, [cats]);

  // 即時協作：訂閱 pm_documents 變更，套用其他協作者的編輯
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel("pm_documents_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pm_documents" },
        (payload) => {
          const row = payload.new;
          if (!row || row.editor === CLIENT_ID) return; // 忽略自己的寫入
          if (row.id === DOC_KEYS.data && row.data) {
            skipSave.current = true;
            setCats(row.data);
            setCollabPing(true);
            setTimeout(() => setCollabPing(false), 1800);
          } else if (row.id === DOC_KEYS.chat && row.data) {
            setGlobalChat(row.data);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const totalEstimated = cats ? cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + calcEstimated(it), 0), 0) : 0;
  const totalActual = cats ? cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + calcActual(it), 0), 0) : 0;
  const doneCount = cats ? cats.filter(c => c.status === "done").length : 0;


  // drag-drop categories
  const onDragStart = (id) => setDragging(id);
  const onDragOver = (id) => { if (id !== dragging) setDragOver(id); };
  const onDrop = (targetId) => {
    if (!dragging || dragging === targetId) { setDragging(null); setDragOver(null); return; }
    setCats(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(c => c.id === dragging);
      const ti = arr.findIndex(c => c.id === targetId);
      const [item] = arr.splice(fi, 1);
      arr.splice(ti, 0, item);
      return arr.map((c, i) => ({ ...c, order: i }));
    });
    setDragging(null); setDragOver(null);
  };

  if (!cats) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f4f5f7", color: "#e8b84b", fontFamily: "'Noto Sans TC', sans-serif", fontSize: 16 }}>
      載入中…
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", color: "#1a1d2e", fontFamily: "'Noto Sans TC', sans-serif", fontSize: 14 }}>
      {/* TOP NAV */}
      <TopNav view={view} setView={setView} saving={saving} collabPing={collabPing} totalEstimated={totalEstimated} totalActual={totalActual} doneCount={doneCount} catCount={cats.length} onAI={() => setShowGlobalAI(true)} />

      {/* MAIN */}
      <div style={{ padding: "0 16px 80px" }}>
        {view === "kanban" && (
          <KanbanView cats={cats} setCats={setCats} onSelect={(cat) => { setSelectedCat(cat); setSelectedItem(null); }} dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} confirm={confirm} />
        )}
        {view === "list" && (
          <ListView cats={cats} setCats={setCats} onSelectItem={(cat, item) => { setSelectedCat(cat); setSelectedItem(item); }} confirm={confirm} />
        )}
        {view === "gantt" && (
          <GanttView cats={cats} setCats={setCats} />
        )}
      </div>

      {/* CATEGORY DETAIL PANEL */}
      {selectedCat && !selectedItem && (
        <CatPanel cat={selectedCat} cats={cats} setCats={setCats} onClose={() => setSelectedCat(null)} onSelectItem={(item) => setSelectedItem(item)} confirm={confirm} />
      )}

      {/* ITEM DETAIL PANEL */}
      {selectedCat && selectedItem && (
        <ItemPanel cat={selectedCat} item={selectedItem} cats={cats} setCats={setCats} onClose={() => setSelectedItem(null)} confirm={confirm} />
      )}

      {ConfirmDialog}
      {/* GLOBAL AI */}
      {showGlobalAI && (
        <GlobalAIPanel chat={globalChat} setChat={setGlobalChat} onClose={() => setShowGlobalAI(false)} cats={cats} />
      )}
    </div>
  );
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (msg) => new Promise(resolve => setState({ msg, resolve }));
  const Dialog = state ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#f0f1f4", border: "1px solid #2a2f40", borderRadius: 14, padding: "24px 22px", maxWidth: 320, width: "90%", textAlign: "center" }}>
        <div style={{ fontSize: 15, color: "#111827", marginBottom: 20, lineHeight: 1.6 }}>{state.msg}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={() => { state.resolve(false); setState(null); }} style={{ flex: 1, padding: "9px 0", background: "#d8dae3", border: "1px solid #3a3f50", borderRadius: 8, color: "#6b7280", cursor: "pointer", fontSize: 14 }}>取消</button>
          <button onClick={() => { state.resolve(true); setState(null); }} style={{ flex: 1, padding: "9px 0", background: "#fff0ee", border: "1px solid rgba(232,92,75,0.4)", borderRadius: 8, color: "#e85c4b", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>確定刪除</button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, Dialog };
}

// ── KPI CARD WITH TOOLTIP ────────────────────────────────────────────────────
function KPICard({ label, val, color, tip }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ background: "#f7f8fa", border: "1px solid #e4e6ef", borderRadius: 8, padding: "8px 10px", position: "relative", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2, display: "flex", alignItems: "center", gap: 3 }}>
        {label}
        <span style={{ fontSize: 9, color: "#9ca3af", border: "1px solid #4a5070", borderRadius: "50%", width: 11, height: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>?</span>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color }}>{val}</div>
      {show && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#f4f5f7", border: "1px solid #2a2f40", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "#1a1d2e", zIndex: 300, whiteSpace: "nowrap", maxWidth: 240, lineHeight: 1.6, boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
          {tip}
        </div>
      )}
    </div>
  );
}

// ── TOP NAV ───────────────────────────────────────────────────────────────────
function TopNav({ view, setView, saving, collabPing, totalEstimated, totalActual, doneCount, catCount, onAI }) {
  const diff = totalActual - totalEstimated;
  return (
    <div style={{ background: "#ffffff", borderBottom: "1px solid #2a2f40", padding: "12px 16px", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: ACCENT, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" }}>宏匯 JOEL FAST CASUAL</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#111827", lineHeight: 1.2 }}>工程管理系統</div>
        </div>
        <div style={{ flex: 1 }} />
        {collabPing && <div style={{ fontSize: 11, color: "#1a7f37", fontWeight: 700 }}>🔄 協作者已更新</div>}
        {saving && <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>同步中…</div>}
        <button onClick={onAI} style={{ background: "#fff3cc", border: "1px solid rgba(232,184,75,0.4)", color: "#1a1d2e", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          🤖 AI顧問
        </button>
      </div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 10 }}>
        {[
          { label: "預估總額", val: fmt(totalEstimated), color: ACCENT, tip: "各細項「預估數量×預估單價＋預估人工」加總，來自估價單" },
          { label: "實際記錄", val: totalActual > 0 ? fmt(totalActual) : "尚未填入", color: totalActual > 0 ? (diff > 0 ? "#e85c4b" : "#4be87a") : "#6b7280", tip: "各細項「實際數量×實際單價＋人數×日薪×天數」加總，施工中逐筆填入" },
          { label: "差異", val: totalActual > 0 ? (diff >= 0 ? "+" : "") + fmt(diff) : "-", color: diff > 0 ? "#e85c4b" : "#4be87a", tip: totalActual > 0 ? (diff > 0 ? "⚠️ 實際超出預估 " + fmt(Math.abs(diff)) : "✅ 尚有餘額 " + fmt(Math.abs(diff))) : "實際金額填入後自動計算" },
          { label: "完工項目", val: `${doneCount} / ${catCount}`, color: "#4b9fe8", tip: "狀態標示為「完工」的大項數" },
        ].map(k => (
          <KPICard key={k.label} label={k.label} val={k.val} color={k.color} tip={k.tip} />
        ))}
      </div>
      {/* view tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {[["kanban","看板"],["list","明細"],["gantt","工序"]].map(([v,l]) => (
          <button key={v} onClick={() => setView(v)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: view === v ? ACCENT : "#d8dae3", color: view === v ? "#f4f5f7" : "#6b7280" }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// ── KANBAN ─────────────────────────────────────────────────────────────────────
function KanbanView({ cats, setCats, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop, confirm }) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>拖曳卡片可調整工序順序</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 12 }}>
        {[...cats].sort((a,b) => a.order - b.order).map(cat => {
          const done = cat.items.filter(i => i.status === "done").length;
          const pct = cat.items.length ? Math.round(done / cat.items.length * 100) : 0;
          const st = STATUS_MAP[cat.status] || STATUS_MAP.pending;
          const isDragOver = dragOver === cat.id;
          return (
            <div
              key={cat.id}
              draggable
              onDragStart={() => onDragStart(cat.id)}
              onDragOver={(e) => { e.preventDefault(); onDragOver(cat.id); }}
              onDrop={() => onDrop(cat.id)}
              onClick={() => onSelect(cat)}
              style={{ background: isDragOver ? "#e8edf8" : "#ffffff", border: `1px solid ${isDragOver ? ACCENT : "#d8dae3"}`, borderRadius: 12, padding: 14, cursor: "grab", transition: "border-color 0.2s, transform 0.15s", transform: dragging === cat.id ? "scale(0.97) rotate(-1deg)" : "none", userSelect: "none", position: "relative" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <input
                  value={cat.name}
                  onChange={e => { e.stopPropagation(); setCats(prev => prev.map(c => c.id === cat.id ? {...c, name: e.target.value} : c)); }}
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 14, fontWeight: 700, color: "#1a1d2e", flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Noto Sans TC', sans-serif", cursor: "text", minWidth: 0 }}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
                  <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} onClick={e => { e.stopPropagation(); e.preventDefault(); confirm(`確定刪除「${cat.name}」？\n此操作無法復原。`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== cat.id)); }); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff0ee", border: "1px solid rgba(232,92,75,0.3)", color: "#e85c4b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: 0 }} title="刪除此工程">×</button>
                </div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: ACCENT, marginBottom: 8 }}>{fmt(cat.budget)}</div>
              <div style={{ background: "#e2e4ec", borderRadius: 4, height: 5, marginBottom: 6, overflow: "hidden" }}>
                <div style={{ background: pct === 100 ? "#4be87a" : "#4b9fe8", width: pct + "%", height: "100%", transition: "width 0.4s" }} />
              </div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{done}/{cat.items.length} 細項完成 · {pct}%</div>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {Object.entries(STATUS_MAP).map(([k, v]) => {
                  const cnt = cat.items.filter(i => i.status === k).length;
                  if (!cnt) return null;
                  return <span key={k} style={{ fontSize: 10, color: v.color, background: v.color + "18", border: "1px solid " + v.color + "44", borderRadius: 10, padding: "1px 7px" }}>{v.label} {cnt}</span>;
                })}
              </div>
              {cat.items.some(i => i.notes?.includes("⚠️")) && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#e8954b", background: "#fff7ee", borderRadius: 4, padding: "3px 8px" }}>⚠️ 含待確認項目</div>
              )}
            </div>
          );
        })}
      {/* Add new category card */}
        <div
          onClick={() => {
            const id = "cat-" + Date.now();
            const newCat = { id, order: cats.length, name: "新工程大項", budget: 0, status: "pending", items: [] };
            setCats(prev => [...prev, newCat]);
          }}
          style={{ background: "#fafbfc", border: "1px dashed rgba(180,140,30,0.4)", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120, gap: 8, transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="rgba(232,184,75,0.35)"}
        >
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff8e6", border: "1px solid rgba(232,184,75,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: ACCENT }}>+</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>新增工程大項</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, setCats, catId, itemId }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <div style={{ position: "relative" }}>
      <div onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={{ background: st.color + "22", border: `1px solid ${st.color}55`, color: st.color, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{st.label}</div>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 26, background: "#f0f1f4", border: "1px solid #2a2f40", borderRadius: 8, zIndex: 200, minWidth: 100, overflow: "hidden" }}>
          {Object.entries(STATUS_MAP).map(([k, v]) => (
            <div key={k} onClick={(e) => { e.stopPropagation(); setCats(prev => prev.map(c => {
              if (catId && c.id === catId) {
                if (itemId) return { ...c, items: c.items.map(it => it.id === itemId ? { ...it, status: k } : it) };
                return { ...c, status: k };
              }
              return c;
            })); setOpen(false); }} style={{ padding: "7px 12px", cursor: "pointer", color: v.color, fontSize: 12, borderBottom: "1px solid #2a2f4044" }}>{v.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LIST VIEW ─────────────────────────────────────────────────────────────────
function ListView({ cats, setCats, onSelectItem, confirm }) {
  const [expanded, setExpanded] = useState({});
  return (
    <div style={{ paddingTop: 16 }}>
      {[...cats].sort((a,b) => a.order - b.order).map(cat => {
        const isExp = expanded[cat.id];
        const catTotal = cat.items.reduce((s, it) => s + calcItemTotal(it), 0);
        return (
          <div key={cat.id} style={{ background: "#ffffff", border: "1px solid #2a2f40", borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
            <div onClick={() => setExpanded(e => ({...e, [cat.id]: !e[cat.id]}))} style={{ display: "flex", alignItems: "center", padding: "12px 16px", cursor: "pointer", gap: 12 }}>
              <div style={{ fontSize: 16, color: isExp ? ACCENT : "#6b7280", transition: "transform 0.2s", transform: isExp ? "rotate(90deg)" : "none" }}>▶</div>
              <input
                value={cat.name}
                onChange={e => { e.stopPropagation(); setCats(prev => prev.map(c => c.id === cat.id ? {...c, name: e.target.value} : c)); }}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, fontWeight: 700, fontSize: 14, color: "#1a1d2e", background: "transparent", border: "none", outline: "none", fontFamily: "'Noto Sans TC', sans-serif", cursor: "text" }}
              />
              <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(cat.budget)}</div>
              {catTotal > 0 && <div style={{ fontFamily: "monospace", fontSize: 12, color: catTotal > cat.budget ? "#e85c4b" : "#4be87a" }}>實記 {fmt(catTotal)}</div>}
              <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
              <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`確定刪除「${cat.name}」？`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== cat.id)); }); }} style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff0ee", border: "1px solid rgba(232,92,75,0.25)", color: "#e85c4b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, cursor: "pointer", flexShrink: 0, padding: 0 }} title="刪除">×</button>
            </div>
            {isExp && (
              <div style={{ borderTop: "1px solid #2a2f40" }}>
                {/* item table header */}
                <div style={{ display: "grid", gridTemplateColumns: "2fr 60px 60px 70px 70px 80px 80px 100px 80px", gap: 4, padding: "6px 16px", background: "#f0f1f4", fontSize: 10, color: "#6b7280", borderBottom: "1px solid #2a2f40" }}>
                  <div>項目名稱</div><div>預估數量</div><div>單位</div><div>預估單價</div><div>預估複價</div><div>實際複價</div><div>差異</div><div>負責人</div><div>狀態</div>
                </div>
                {cat.items.map(item => (
                  <div key={item.id} onClick={() => onSelectItem(cat, item)} style={{ display: "grid", gridTemplateColumns: "2fr 60px 60px 70px 70px 80px 80px 100px 80px", gap: 4, padding: "8px 16px", borderBottom: "1px solid #2a2f4044", cursor: "pointer", alignItems: "center", transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="#f0f1f4"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}
                  >
                    <input
                      value={item.name}
                      onChange={e => { e.stopPropagation(); setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.map(it => it.id === item.id ? {...it, name: e.target.value} : it)} : c)); }}
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 13, color: item.notes?.includes("⚠️") ? "#e8954b" : "#1a1d2e", background: "transparent", border: "none", outline: "none", fontFamily: "'Noto Sans TC', sans-serif", width: "100%", cursor: "text" }}
                    />
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>{item.estQty ?? item.qty}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{item.unit}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12 }}>{fmt(item.estUnitPrice ?? item.unitPrice ?? 0)}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(calcEstimated(item))}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#4b9fe8" }}>{calcActual(item) > 0 ? fmt(calcActual(item)) : "-"}</div>
                    <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: calcActual(item) > calcEstimated(item) ? "#e85c4b" : calcActual(item) > 0 ? "#4be87a" : "#6b7280" }}>{calcActual(item) > 0 ? (calcActual(item) > calcEstimated(item) ? "+" : "") + fmt(calcActual(item) - calcEstimated(item)) : "-"}</div>
                    <div style={{ fontSize: 12, color: item.assignee ? "#111827" : "#c0c4d0" }}>{item.assignee || "未指派"}</div>
                    <StatusBadge status={item.status} setCats={setCats} catId={cat.id} itemId={item.id} />
                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`刪除「${item.name}」？`).then(ok => { if (ok) setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); }); }} style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff0ee", border: "1px solid rgba(232,92,75,0.2)", color: "#e85c4b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", padding: 0, flexShrink: 0 }}>×</button>
                  </div>
                ))}
                {/* add item */}
                <div onClick={() => {
                  const name = prompt("新增細項名稱：");
                  if (!name) return;
                  const newItem = { id: `i-${cat.id}-${Date.now()}`, name, qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] };
                  setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: [...c.items, newItem] } : c));
                }} style={{ padding: "8px 16px", color: "#6b7280", fontSize: 12, cursor: "pointer", borderTop: "1px solid #2a2f4044", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16, color: ACCENT }}>+</span> 新增細項
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div
        onClick={() => {
          const id = "cat-" + Date.now();
          setCats(prev => [...prev, { id, order: prev.length, name: "新工程大項", budget: 0, status: "pending", items: [] }]);
          setExpanded(e => ({ ...e, [id]: true }));
        }}
        style={{ background: "#fafbfc", border: "1px dashed rgba(180,140,30,0.4)", borderRadius: 12, padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: "#6b7280", fontSize: 13, transition: "border-color 0.2s" }}
        onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
        onMouseLeave={e => e.currentTarget.style.borderColor="rgba(232,184,75,0.35)"}
      >
        <span style={{ fontSize: 20, color: ACCENT }}>+</span> 新增工程大項
      </div>
    </div>
  );
}

// ── GANTT VIEW ────────────────────────────────────────────────────────────────
function GanttView({ cats, setCats }) {
  const weeks = 16;
  return (
    <div style={{ paddingTop: 16, overflowX: "auto" }}>
      <div style={{ minWidth: 800 }}>
        {/* header */}
        <div style={{ display: "flex", marginBottom: 4 }}>
          <div style={{ width: 200, flexShrink: 0, fontSize: 11, color: "#6b7280", padding: "4px 8px" }}>工程項目</div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)` }}>
            {Array.from({length: weeks}, (_,i) => (
              <div key={i} style={{ fontSize: 10, color: "#6b7280", textAlign: "center", borderLeft: "1px solid #2a2f4033" }}>W{i+1}</div>
            ))}
          </div>
        </div>
        {[...cats].sort((a,b) => a.order - b.order).map((cat, ci) => {
          const start = cat.ganttStart ?? ci;
          const dur = cat.ganttDur ?? Math.max(1, Math.round(cat.budget / 200000));
          const st = STATUS_MAP[cat.status] || STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ display: "flex", marginBottom: 6, alignItems: "center" }}>
              <div style={{ width: 200, flexShrink: 0, fontSize: 12, color: "#1a1d2e", padding: "4px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)`, height: 28, background: "#f0f2f5", borderRadius: 4, overflow: "hidden", cursor: "pointer" }}
                onClick={() => {
                  const s = parseInt(prompt(`「${cat.name}」開始週 (1-${weeks}):`, start+1)) - 1;
                  const d = parseInt(prompt("持續週數:", dur));
                  if (!isNaN(s) && !isNaN(d)) setCats(prev => prev.map(c => c.id === cat.id ? {...c, ganttStart: Math.max(0,s), ganttDur: Math.max(1,d)} : c));
                }}
              >
                {Array.from({length: weeks}, (_,i) => {
                  const inBar = i >= start && i < start + dur;
                  return (
                    <div key={i} style={{ borderLeft: "1px solid #2a2f4033", height: "100%", background: inBar ? st.color + "cc" : "transparent", position: "relative" }}>
                      {inBar && i === start && <div style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#f4f5f7", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" }}>{cat.name.slice(0,6)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8, padding: "0 8px" }}>點擊工序列可調整開始週與持續時間</div>
      </div>
    </div>
  );
}

// ── CATEGORY PANEL ─────────────────────────────────────────────────────────────
function CatPanel({ cat: catProp, cats, setCats, onClose, onSelectItem, confirm }) {
  const cat = cats.find(c => c.id === catProp.id) || catProp;
  const updateCat = (field, val) => setCats(prev => prev.map(c => c.id === cat.id ? { ...c, [field]: val } : c));
  return (
    <SidePanel onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>工程大項名稱</div>
        <input
          value={cat.name}
          onChange={e => updateCat("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 16, fontWeight: 700, color: "#111827" }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "#fffbf0", border: "1px solid rgba(232,184,75,0.2)", borderRadius: 8, padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>預估總額（細項加總）</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: ACCENT }}>{fmt(cat.items.reduce((s,it) => s + calcEstimated(it), 0))}</div>
        </div>
        <div style={{ background: "#f0f7ff", border: "1px solid rgba(75,159,232,0.2)", borderRadius: 8, padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>實際總額（細項加總）</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#4b9fe8" }}>{cat.items.reduce((s,it) => s + calcActual(it), 0) > 0 ? fmt(cat.items.reduce((s,it) => s + calcActual(it), 0)) : "尚未填入"}</div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>狀態</div>
        <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
      </div>
      <input
        placeholder="負責單位/廠商"
        value={cat.vendor || ""}
        onChange={e => updateCat("vendor", e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>細項列表</div>
      {cat.items.map(item => (
        <div key={item.id} onClick={() => onSelectItem(item)} style={{ background: "#f0f1f4", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer", border: "1px solid #2a2f40", transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="#d8dae3"}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, color: item.notes?.includes("⚠️") ? "#e8954b" : "#1a1d2e", flex: 1 }}>{item.name}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(calcItemTotal(item))}</div>
            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`刪除「${item.name}」？`).then(ok => { if (ok) setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); }); }} style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff0ee", border: "1px solid rgba(232,92,75,0.25)", color: "#e85c4b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flexShrink: 0, padding: 0 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {item.qty} {item.unit} · {item.assignee || "未指派"} · <span style={{ color: STATUS_MAP[item.status]?.color || "#6b7280" }}>{STATUS_MAP[item.status]?.label}</span>
            {item.chat?.length > 0 && " · 💬" + item.chat.length}
          </div>
        </div>
      ))}
      <button onClick={() => {
        const newItem = { id: "i-" + cat.id + "-" + Date.now(), name: "新細項", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] };
        setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: [...c.items, newItem] } : c));
      }} style={{ width: "100%", padding: "8px", background: "#fff8e6", border: "1px dashed rgba(232,184,75,0.4)", borderRadius: 8, color: ACCENT, cursor: "pointer", fontSize: 13, marginTop: 4 }}>
        + 新增細項
      </button>
    </SidePanel>
  );
}

// ── ITEM PANEL ─────────────────────────────────────────────────────────────────
function ItemPanel({ cat, item, cats, setCats, onClose, confirm }) {
  const updateItem = (field, val) => {
    setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: c.items.map(it => it.id === item.id ? {...it, [field]: val} : it) } : c));
  };
  const currentItem = cats.find(c => c.id === cat.id)?.items.find(i => i.id === item.id) || item;

  return (
    <SidePanel onClose={onClose} wide>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>{cat.name}</div>
        <input
          value={currentItem.name}
          onChange={e => updateItem("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 15, fontWeight: 700, color: "#111827" }}
          placeholder="細項名稱"
        />
        <button onClick={() => confirm(`確定刪除細項「${currentItem.name}」？`).then(ok => { if (ok) { setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); onClose(); } })} style={{ marginTop: 6, background: "#fff0ee", border: "1px solid rgba(232,92,75,0.25)", borderRadius: 7, color: "#e85c4b", fontSize: 12, padding: "5px 12px", cursor: "pointer", alignSelf: "flex-start" }}>🗑 刪除此細項</button>
      </div>
      {/* ── 預估 vs 實際 兩欄 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 14, border: "1px solid #2a2f40", borderRadius: 10, overflow: "hidden" }}>
        {/* headers */}
        <div style={{ background: "#fffbf0", borderBottom: "1px solid #2a2f40", borderRight: "1px solid #2a2f40", padding: "7px 12px", fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: 1 }}>📋 預估（估價單）</div>
        <div style={{ background: "#e8f3ff", borderBottom: "1px solid #2a2f40", padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "#4b9fe8", letterSpacing: 1 }}>🔨 實際（施工記錄）</div>
        {/* qty */}
        <div style={{ borderRight: "1px solid #2a2f40", borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.estQty ?? currentItem.qty ?? 0} onChange={v => updateItem("estQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <input value={currentItem.unit} onChange={e => updateItem("unit", e.target.value)} style={{ ...inputStyle, width: 56, fontSize: 12 }} />
          </div>
        </div>
        <div style={{ borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.actQty ?? 0} onChange={v => updateItem("actQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap" }}>{currentItem.unit}</span>
          </div>
        </div>
        {/* unit price */}
        <div style={{ borderRight: "1px solid #2a2f40", borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6b7280" }}>NT$</span><NumInput value={currentItem.estUnitPrice ?? currentItem.unitPrice ?? 0} onChange={v => updateItem("estUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6b7280" }}>NT$</span><NumInput value={currentItem.actUnitPrice ?? 0} onChange={v => updateItem("actUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        {/* labor */}
        <div style={{ borderRight: "1px solid #2a2f40", borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>人工費（整筆估）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6b7280" }}>NT$</span><NumInput value={currentItem.estLabor ?? currentItem.labor ?? 0} onChange={v => updateItem("estLabor", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #2a2f4055", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 3 }}>人數 / 日薪 / 天數</div>
          <div style={{ display: "flex", gap: 4 }}>
            <NumInput value={currentItem.actWorkers ?? 0} onChange={v => updateItem("actWorkers", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="人" />
            <NumInput value={currentItem.actDailyWage ?? 0} onChange={v => updateItem("actDailyWage", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="日薪" />
            <NumInput value={currentItem.actLaborDays ?? 0} onChange={v => updateItem("actLaborDays", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="天" />
          </div>
        </div>
        {/* totals */}
        <div style={{ borderRight: "1px solid #2a2f40", padding: "8px 12px", background: "#fffdf7" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>預估複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: ACCENT }}>{fmt(calcEstimated(currentItem))}</div>
        </div>
        <div style={{ padding: "8px 12px", background: "#f5faff" }}>
          <div style={{ fontSize: 10, color: "#6b7280", marginBottom: 2 }}>實際複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: calcActual(currentItem) > calcEstimated(currentItem) ? "#e85c4b" : "#4b9fe8" }}>
            {calcActual(currentItem) > 0 ? fmt(calcActual(currentItem)) : "尚未填入"}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Field label="負責人/廠商" value={currentItem.assignee} onChange={v => updateItem("assignee", v)} />
        <div>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>狀態</div>
          <StatusBadge status={currentItem.status} setCats={setCats} catId={cat.id} itemId={currentItem.id} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Field label="備註" value={currentItem.notes} onChange={v => updateItem("notes", v)} multiline />
      </div>
      {/* Receipts */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>憑證紀錄 ({currentItem.receipts?.length || 0})</div>
        {currentItem.receipts?.map((r, ri) => (
          <div key={ri} style={{ background: "#f0f1f4", borderRadius: 6, padding: "6px 10px", marginBottom: 4, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
            <span>{r.name}</span>
            <span style={{ color: ACCENT, fontFamily: "monospace" }}>{fmt(r.amount)}</span>
          </div>
        ))}
        <button onClick={() => {
          const name = prompt("憑證名稱：");
          if (!name) return;
          const amt = parseFloat(prompt("金額：") || "0");
          updateItem("receipts", [...(currentItem.receipts || []), { name, amount: amt, date: new Date().toLocaleDateString("zh-TW") }]);
        }} style={{ fontSize: 12, background: "none", border: "1px dashed #2a2f40", color: "#6b7280", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
          + 新增憑證
        </button>
      </div>
      {/* Item Chat + AI */}
      <ItemChat cat={cat} item={currentItem} setCats={setCats} />
    </SidePanel>
  );
}

// ── ITEM CHAT ──────────────────────────────────────────────────────────────────
function ItemChat({ cat, item, setCats }) {
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [item.chat]);

  const addMsg = (role, text) => {
    setCats(prev => prev.map(c => c.id === cat.id ? {
      ...c, items: c.items.map(it => it.id === item.id ? { ...it, chat: [...(it.chat || []), { role, text, ts: new Date().toLocaleTimeString("zh-TW", {hour:"2-digit",minute:"2-digit"}) }] } : it)
    } : c));
  };

  const send = async () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    addMsg("user", t);
    setAiLoading(true);
    try {
      const history = (item.chat || []).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      history.push({ role: "user", content: t });
      const reply = await callAI(history, SYSTEM_ITEM(cat.name, item.name));
      addMsg("assistant", reply);
    } catch (_) {
      addMsg("assistant", "⚠️ AI連線失敗，請稍後再試。");
    }
    setAiLoading(false);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>💬 項目討論室 & AI顧問</div>
      <div style={{ background: "#f4f5f7", borderRadius: 8, border: "1px solid #2a2f40", maxHeight: 280, overflowY: "auto", padding: 10, marginBottom: 8 }}>
        {(!item.chat || item.chat.length === 0) && (
          <div style={{ fontSize: 12, color: "#d8dae3", textAlign: "center", padding: "20px 0" }}>輸入問題詢問AI工程顧問，或記錄討論內容</div>
        )}
        {item.chat?.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.role === "user" ? "#4b9fe8" : "#ffeea0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, border: m.role !== "user" ? `1px solid ${ACCENT}44` : "none" }}>
              {m.role === "user" ? "👤" : "🤖"}
            </div>
            <div style={{ background: m.role === "user" ? "#e8f0fe" : "#fffbf0", border: m.role === "user" ? "1px solid #2a2f40" : `1px solid ${ACCENT}22`, borderRadius: 8, padding: "7px 10px", maxWidth: "85%", fontSize: 12.5, lineHeight: 1.6, color: m.role === "user" ? "#1a1d2e" : "#7a5c00", whiteSpace: "pre-wrap" }}>
              {m.text}
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3 }}>{m.ts}</div>
            </div>
          </div>
        ))}
        {aiLoading && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#ffeea0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, border: `1px solid ${ACCENT}44` }}>🤖</div>
            <div style={{ fontSize: 12, color: ACCENT, padding: "8px 10px" }}>AI顧問分析中…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()} placeholder="詢問AI顧問或記錄討論…" style={{ ...inputStyle, flex: 1, margin: 0 }} />
        <button onClick={send} disabled={aiLoading || !input.trim()} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 14px", color: "#1a1d2e", fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: aiLoading ? 0.6 : 1 }}>送出</button>
      </div>
    </div>
  );
}

// ── GLOBAL AI PANEL ────────────────────────────────────────────────────────────
function GlobalAIPanel({ chat, setChat, onClose, cats }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  const addMsg = (role, text) => {
    setChat(prev => {
      const next = [...prev, { role, text, ts: new Date().toLocaleTimeString("zh-TW", {hour:"2-digit",minute:"2-digit"}) }];
      saveGlobalChat(next);
      return next;
    });
  };

  // auto greeting
  useEffect(() => {
    if (chat.length === 0) {
      addMsg("assistant", `你好！我是宏匯 JOEL FAST CASUAL 工程AI顧問。\n\n目前專案包含 ${cats.length} 個工程大項，有以下幾點需要特別注意：\n\n🔴 8處「沒詳圖」項目（牆面工程含服務台）需簽約前補齊\n🔴 監督管理費 10% 偏高，建議壓至 7~8%\n🟡 弱電、招牌、家具等業主自理項目預估額外需 135~420萬\n🟡 燈具工程 $22萬為暫估，需確認上限\n\n請問有什麼我可以協助的？`);
    }
  }, []);

  const send = async () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    addMsg("user", t);
    setLoading(true);
    try {
      const projectSummary = `目前專案狀態：共${cats.length}個工程大項，估價總額${fmt(cats.reduce((s,c)=>s+c.budget,0))}，完工項目${cats.filter(c=>c.status==="done").length}個。`;
      const history = chat.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      history.push({ role: "user", content: `[${projectSummary}] ${t}` });
      const reply = await callAI(history, SYSTEM_GLOBAL);
      addMsg("assistant", reply);
    } catch (_) {
      addMsg("assistant", "⚠️ AI連線失敗，請稍後再試。");
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "min(480px,100vw)", height: "min(680px,90vh)", background: "#ffffff", borderRadius: "16px 0 0 16px", display: "flex", flexDirection: "column", border: "1px solid #2a2f40", borderRight: "none" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #2a2f40", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff3cc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: `1px solid ${ACCENT}44` }}>🤖</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1d2e" }}>工程AI顧問</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>JOEL FAST CASUAL 專案</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.role === "user" ? "#4b9fe8" : "#fff3cc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {m.role === "user" ? "👤" : "🤖"}
              </div>
              <div style={{ background: m.role === "user" ? "#e8f0fe" : "#fffbf0", border: m.role === "user" ? "1px solid #2a2f40" : `1px solid ${ACCENT}22`, borderRadius: 10, padding: "9px 12px", maxWidth: "85%", fontSize: 13, lineHeight: 1.7, color: m.role === "user" ? "#1a1d2e" : "#7a5c00", whiteSpace: "pre-wrap" }}>
                {m.text}
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 4 }}>{m.ts}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#fff3cc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
              <div style={{ fontSize: 13, color: ACCENT, padding: "9px 12px" }}>顧問分析中…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* quick prompts */}
        <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {["⚠️ 當前風險摘要","📋 未完成待辦","💰 預算差異分析","📅 建議工序安排"].map(q => (
            <button key={q} onClick={() => { setInput(q); setTimeout(() => document.getElementById("global-input")?.focus(),0); }} style={{ whiteSpace: "nowrap", background: "#f0f1f4", border: "1px solid #2a2f40", color: "#6b7280", borderRadius: 20, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{q}</button>
          ))}
        </div>
        <div style={{ padding: "0 14px 14px", display: "flex", gap: 8 }}>
          <input id="global-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()} placeholder="詢問工程問題或記錄決策…" style={{ ...inputStyle, flex: 1, margin: 0 }} />
          <button onClick={send} disabled={loading || !input.trim()} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 16px", color: "#1a1d2e", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: 14, opacity: loading ? 0.6 : 1 }}>送</button>
        </div>
      </div>
    </div>
  );
}

// ── SIDE PANEL ─────────────────────────────────────────────────────────────────
function SidePanel({ onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: wide ? "min(600px,100vw)" : "min(440px,100vw)", background: "#ffffff", height: "100vh", overflowY: "auto", borderLeft: "1px solid #2a2f40", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #2a2f40", display: "flex", alignItems: "center", justifyContent: "flex-end", position: "sticky", top: 0, background: "#ffffff", zIndex: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#374151", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 16, flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── NUM INPUT (inline number input with string state) ────────────────────────
function NumInput({ value, onChange, style, placeholder }) {
  const [local, setLocal] = useState(String(value ?? ""));
  const ref = useRef(value);
  useEffect(() => {
    if (value !== ref.current) { ref.current = value; setLocal(String(value ?? "")); }
  }, [value]);
  return (
    <input
      type="text" inputMode="decimal"
      value={local}
      placeholder={placeholder}
      onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value) || e.target.value === "") setLocal(e.target.value); }}
      onBlur={() => { const n = parseFloat(local); const v = isNaN(n) ? 0 : n; ref.current = v; setLocal(String(v)); onChange(v); }}
      onFocus={e => e.target.select()}
      style={style}
    />
  );
}

// ── FIELD ──────────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type, readOnly, accent, prefix, suffix, multiline }) {
  const isNum = type === "number";
  const [local, setLocal] = useState(isNum ? String(value ?? "") : "");
  const committed = useRef(value);
  useEffect(() => {
    if (isNum && value !== committed.current) {
      committed.current = value;
      setLocal(String(value ?? ""));
    }
  }, [value, isNum]);
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      {readOnly ? (
        <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: accent ? ACCENT : "#1a1d2e", padding: "6px 0" }}>{value}</div>
      ) : multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, height: 72, resize: "vertical" }} />
      ) : isNum ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6b7280" }}>{prefix}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={local}
            onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value) || e.target.value === "") setLocal(e.target.value); }}
            onBlur={() => { const n = parseFloat(local); const v = isNaN(n) ? 0 : n; committed.current = v; setLocal(String(v)); onChange(v); }}
            onFocus={e => e.target.select()}
            style={{ ...inputStyle, flex: 1 }}
          />
          {suffix && <span style={{ fontSize: 11, color: "#6b7280" }}>{suffix}</span>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6b7280" }}>{prefix}</span>}
          <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          {suffix && <span style={{ fontSize: 11, color: "#6b7280" }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: "#f0f1f4",
  border: "1px solid #d8dae3",
  borderRadius: 8,
  color: "#1a1d2e",
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "'Noto Sans TC', sans-serif",
};
