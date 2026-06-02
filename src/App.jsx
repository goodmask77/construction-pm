import { useState, useEffect, useRef, useCallback } from "react";
import { uploadPhoto, deletePhotoFile } from "./supa.js";
import SequenceView from "./SequenceView.jsx";

// ── DESIGN TOKENS (Warm editorial — 米色紙感 + 磚紅 + 黑) ──────────────────
const ACCENT  = "#C13A22"; // 品牌磚紅 — Logo / 主按鈕 / tag
const PRIMARY = "#1A1A1A"; // 黑 — 選中 tab / 深色按鈕
const BG      = "#ECE6D7"; // 米色紙背景
const SURFACE = "#FCFAF4"; // 卡片/表面（暖白）
const BORDER  = "#D8CFBB"; // 暖棕邊框
const TEXT    = "#211C15"; // 主文字（暖黑）
const SUB     = "#6F6656"; // 次文字（暖灰）
const ACCENT_SOFT = "#F3E4DE"; // 磚紅淡底
const DARKCHIP = "#33281E"; // 深棕 chip（分類標籤）
const GOLD    = "#C13A22"; // Logo 用磚紅
const ADMIN_USER = "goodmask77"; // 僅此帳號可編輯（不顯示於介面）
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

// ── INITIAL DATA from GROUN:D quote ──────────────────────────────────
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
      { id: "i-9-1", name: "RXYMQ10TYLT 室外機主機 ×3組", qty: 1, unit: "式", unitPrice: 301136, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "大金VRV IV S SERIES，含3組室外機", chat: [] },
      { id: "i-9-2", name: "FXMQ124PAVT 客席區吊隱式分機 14.0KW ×2", qty: 1, unit: "式", unitPrice: 301136, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "含控制器+接收器", chat: [] },
      { id: "i-9-3", name: "FXFQ80BVT 廚房四方吹分機 9.0KW ×3", qty: 1, unit: "式", unitPrice: 340824, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "含控制面板×3", chat: [] },
      { id: "i-9-4", name: "銅管規格36 ×5箱＋規格37 ×3箱", qty: 1, unit: "式", unitPrice: 168500, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "銅管36: 5箱×22000=110000，銅管37: 3箱×19500=58500", chat: [] },
      { id: "i-9-5", name: "控制線+隔離線+排水+風管五金", qty: 1, unit: "式", unitPrice: 273000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "含控制線×3捲、隔離線×2捲、排水×7組、集出風箱、風管、焊接暫壓五金等", chat: [] },
      { id: "i-9-6", name: "空調安裝工資", qty: 1, unit: "式", unitPrice: 200000, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] },
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
  pending:     { label: "待開工", color: "#6F6656" },
  inprogress:  { label: "進行中", color: "#3E72A8" },
  done:        { label: "完工",   color: "#3C8C3C" },
  issue:       { label: "有問題", color: "#C0392B" },
  hold:        { label: "暫停",   color: "#C2872E" },
};

const fmt = (n) => "NT$" + Math.round(n || 0).toLocaleString();
// ── 成本金額模型：base=數量×單價，依稅別算稅額與含稅預估；付款=已付/未付（整數 NT$）──
const baseAmount = (it) => (Number(it.estQty ?? it.qty) || 0) * (Number(it.estUnitPrice ?? it.unitPrice) || 0);
const taxOf = (it) => { const b = baseAmount(it); const t = it.taxType || "未稅"; if (t === "免稅") return 0; if (t === "含稅") return b - Math.round(b / 1.05); return Math.round(b * 0.05); };
const estAmount = (it) => { const b = baseAmount(it); return (it.taxType || "未稅") === "未稅" ? b + Math.round(b * 0.05) : b; }; // 含稅/免稅=base；未稅=base+稅額
const paidOf = (it) => Number(it.paid ?? it.cust?.paid) || 0;
const unpaidOf = (it) => estAmount(it) - paidOf(it);
const calcEstimated = (it) => estAmount(it); // 預估金額（含稅）＝真正預算數字
const calcActual = (it) => (it.actQty || 0) * (it.actUnitPrice || 0) + (it.actWorkers || 0) * (it.actDailyWage || 0) * (it.actLaborDays || 0); // 舊「施工記錄」沿用於細項詳情

// ── 大項層級議價折扣：折扣套在「未稅」層、稅金重算（細項原報價不動）──────────────
const pretaxOf = (it) => { const b = baseAmount(it); return (it.taxType || "未稅") === "含稅" ? Math.round(b / 1.05) : b; }; // 未稅基底
const isTaxable = (it) => (it.taxType || "未稅") !== "免稅";
const catRawEst = (cat) => (cat?.items || []).reduce((s, it) => s + estAmount(it), 0); // 原報價含稅
const catPretaxSub = (cat) => (cat?.items || []).reduce((s, it) => s + pretaxOf(it), 0); // 未稅小計
const catDiscount = (cat) => {
  const sub = catPretaxSub(cat);
  const mode = cat?.discountMode === "amt" ? "amt" : "pct";
  const v = Number(cat?.discountValue) || 0;
  if (v <= 0 || sub <= 0) return { hasDiscount: false, factor: 1, pct: 0, amt: 0, mode, value: v, sub };
  let factor = 1, pct = 0, amt = 0;
  if (mode === "amt") { amt = Math.min(Math.max(v, 0), sub); factor = (sub - amt) / sub; pct = amt / sub * 100; }
  else { pct = Math.min(Math.max(v, 0), 100); factor = 1 - pct / 100; amt = sub * pct / 100; }
  return { hasDiscount: factor < 1, factor, pct, amt, mode, value: v, sub };
};
const catEstAfter = (cat) => { // 議價後含稅（大項預估金額＝headline 預算）
  const { factor } = catDiscount(cat);
  if (factor === 1) return catRawEst(cat);
  return (cat?.items || []).reduce((s, it) => {
    const pre = pretaxOf(it) * factor;
    const tax = isTaxable(it) ? pre * 0.05 : 0;
    return s + Math.round(pre + tax);
  }, 0);
};
const catSaved = (cat) => catRawEst(cat) - catEstAfter(cat);

// ── RWD：偵測手機寬度（< 768px）──────────────────────────────────────────────
const MOBILE_BP = 768;
function useIsMobile(bp = MOBILE_BP) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}

// ── LINE 推播通知 ───────────────────────────────────────────────────────────
const LINE_PUSH_URL = "https://ground-pm-webhook.vercel.app/api/push";
const LINE_API_KEY = "ground-pm-2026-secret-abc123"; // 先寫死，之後再改後端代理/加密
const DEFAULT_LINE_GROUP = "Cf7940efc6517b0c084ad2ad496b45f30";
// 通知開關清單（key 同時供 webhook server 排程使用）
const LINE_EVENTS = [
  ["issue",   "細項狀態變為「有問題」時通知"],
  ["done",    "細項狀態變為「完工」時通知"],
  ["stalled", "卡關超過 3 天提醒"],
  ["weekly",  "AI 週報每週五自動推送"],
  ["due",     "排程任務截止日提醒"],
  ["journal", "新工作日誌建立時通知"],
];
async function _lineSettings() {
  try { const r = await window.storage.get("pm_settings", true); return r && r.value ? JSON.parse(r.value) : {}; } catch { return {}; }
}
async function _linePush(body) {
  try {
    const res = await fetch(LINE_PUSH_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": LINE_API_KEY }, body: JSON.stringify(body) });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) { return { ok: false, error: String(e) }; }
}
// 共用：直接推送一段文字（讀 storage 群組 ID；無設定則用預設群組）
async function sendLineNotify(text) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, message: text });
}
// 共用：推送 LINE Flex 訊息
async function sendLineFlex(flex) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, flex });
}
// 事件型通知：依「通知開關」決定是否推送
async function notifyLineEvent(type, text) {
  const s = await _lineSettings();
  if (!((s.lineNotify || {})[type])) return { ok: false, reason: "disabled" };
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, message: text });
}
const calcItemTotal = (it) => calcEstimated(it);

// ── STORAGE HELPERS ───────────────────────────────────────────────────────────
async function loadData() {
  try {
    const r = await window.storage.get("pm_data", true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveData(cats) {
  try {
    await window.storage.set("pm_data", JSON.stringify(cats), true);
  } catch (_) {}
}
async function loadGlobalChat() {
  try {
    const r = await window.storage.get("pm_global_chat", true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveGlobalChat(msgs) {
  try {
    await window.storage.set("pm_global_chat", JSON.stringify(msgs), true);
  } catch (_) {}
}

async function loadSettings() {
  try {
    const r = await window.storage.get("pm_settings", true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveSettings(s) {
  try { await window.storage.set("pm_settings", JSON.stringify(s), true); } catch (_) {}
}
async function loadRole() {
  try { const r = await window.storage.get("pm_role", false); if (r&&r.value) return r.value; } catch(_){}
  return null;
}
async function saveRole(role) {
  try { await window.storage.set("pm_role", role, false); } catch(_){}
}
async function loadActivityLog() {
  try { const r = await window.storage.get("pm_activity", true); if (r&&r.value) return JSON.parse(r.value); } catch(_){}
  return [];
}
async function saveActivityLog(log) {
  try { await window.storage.set("pm_activity", JSON.stringify(log.slice(-200)), true); } catch(_){}
}
async function loadAILog() {
  try {
    const r = await window.storage.get("pm_ai_log", true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveAILog(log) {
  try { await window.storage.set("pm_ai_log", JSON.stringify(log), true); } catch (_) {}
}

// ── AI CALL ───────────────────────────────────────────────────────────────────
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

const SYSTEM_GLOBAL = `你是一位專業餐廳裝修工程顧問，熟悉台灣室內裝修市場行情與法規。你正在協助一個餐廳裝修專案管理系統，專案為「宏匯 GROUN:D」位於台北市內湖區瑞光路337號，總預算含稅約1166萬元。
你的職責：
1. 主動提醒潛在問題（如「沒詳圖」風險、業主自理項目預算缺口）
2. 提供市場行情建議與議價策略
3. 協助安排工序與時程
4. 記錄重要決策與待辦事項
請用繁體中文回答，簡潔專業，必要時條列重點。`;

const buildAdvisorSystem = (settings, cats, journal, events, plans) => {
  journal = journal || [];
  events = events || [];
  plans = plans || [];
  const totalEst = cats.reduce((s,c) => s+catEstAfter(c),0); // 議價後含稅總額
  const totalAct = cats.reduce((s,c) => s+c.items.reduce((ss,it)=>ss+paidOf(it),0),0); // 已付總額
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
    const act = c.items.reduce((s,it)=>s+paidOf(it),0);
    const done = c.items.filter(i=>i.done||i.status==="done").length;
    const dInfo = (raw > est) ? "（原報價" + Math.round(raw/10000) + "萬，議價省" + Math.round((raw-est)/10000) + "萬）" : "";
    return "  • " + c.name + "（" + c.status + "）：預估" + Math.round(est/10000) + "萬" + dInfo + "，已付" + (act>0?Math.round(act/10000)+"萬":"未付") + "，" + done + "/" + c.items.length + "細項完成";
  }).join("\n");

  const priorityItems = cats.flatMap(c=>c.items).filter(i=>(settings?.priorities||[]).includes(i.id)).map(i=>i.name).join("、");

  return "你是專屬於「" + projectName + "」的AI工程總顧問，以下是今日（" + today + "）的完整專案狀態，請根據此資料進行分析與回應。\n\n" +
    "【專案基本資訊】\n" +
    "- 專案名稱：" + projectName + "\n" +
    "- 地址：" + projectAddr + "\n" +
    "- 業主：" + owner + "\n" +
    "- 承包商：" + contractor + "\n" +
    "- 目標完工日：" + targetDate + (daysLeft !== null ? "（距今 "+daysLeft+" 天）" : "") + "\n" +
    "- 今日日期：" + today + "\n" +
    (notes ? "- 備註："+notes+"\n" : "") +
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

const SYSTEM_ITEM = (catName, itemName) => `你是一位專業餐廳裝修工程顧問。目前討論的工程項目是：【${catName}】中的【${itemName}】。請針對此具體項目提供專業建議，包括施工要點、常見問題、驗收標準、市場行情等。用繁體中文回答。`;

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [cats, setCats] = useState(null);
  const [view, setView] = useState("gantt"); // 預設工序頁
  const [selectedCat, setSelectedCat] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [globalChat, setGlobalChat] = useState([]);
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(null);
  const [aiLog, setAiLog] = useState([]);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [userName, setUserName] = useState(null); // null=not logged in
  const [activityLog, setActivityLog] = useState([]);
  const [showLogin, setShowLogin] = useState(false);
  const [knownUsers, setKnownUsers] = useState([]);
  const [worklog, setWorklog] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customCols, setCustomCols] = useState([]);
  const [colOrder, setColOrder] = useState([]);
  const [seqLogs, setSeqLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [journal, setJournal] = useState([]);
  const [plans, setPlans] = useState([]);
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  // 工作日誌：寫入 state 並存進共享後端
  const commitWorklog = (list) => {
    setWorklog(list);
    window.storage.set("pm_worklog", JSON.stringify(list), true).catch(()=>{});
  };
  // 檔案庫照片：metadata 存共享後端（圖片本體在 Supabase Storage）
  const commitPhotos = (list) => {
    setPhotos(list);
    window.storage.set("pm_photos", JSON.stringify(list), true).catch(()=>{});
  };
  const commitAccounts = (list) => {
    setAccounts(list);
    window.storage.set("pm_accounts", JSON.stringify(list), true).catch(()=>{});
  };
  const commitCustomCols = (list) => {
    setCustomCols(list);
    window.storage.set("pm_columns", JSON.stringify(list), true).catch(()=>{});
  };
  const commitColOrder = (list) => {
    setColOrder(list);
    window.storage.set("pm_colorder", JSON.stringify(list), true).catch(()=>{});
  };
  const commitSeqLogs = (list) => {
    setSeqLogs(list);
    window.storage.set("pm_seqlogs", JSON.stringify(list), true).catch(()=>{});
  };

  // load
  useEffect(() => {
    (async () => {
      const d = await loadData();
      setCats(d || INITIAL_CATEGORIES);
      const gc = await loadGlobalChat();
      setGlobalChat(gc);
      const sv = await loadSettings();
      setSettings(sv || { projectName:"宏匯 GROUN:D", projectAddress:"台北市內湖區瑞光路337號", ownerName:"", contractorName:"碩藝室內裝修有限公司", targetDate:"", notes:"", priorities:[], dailyCheckEnabled:false, lineGroupId: DEFAULT_LINE_GROUP, lineNotify: {} });
      const log = await loadAILog();
      setAiLog(log);
      const savedName = await loadRole();
      if (savedName) { setUserName(savedName); }
      // 未登入 → 訪客唯讀瀏覽（不強制登入）
      try {
        const ku = await window.storage.get("pm_known_users", true);
        if (ku && ku.value) {
          const arr = JSON.parse(ku.value).filter(u => u !== ADMIN_USER);
          setKnownUsers(arr);
          // 清掉共享儲存中殘留的管理員帳號，避免顯示
          window.storage.set("pm_known_users", JSON.stringify(arr), true).catch(()=>{});
        } else {
          setKnownUsers([]);
        }
      } catch(_){ setKnownUsers([]); }
      const alog = await loadActivityLog();
      setActivityLog(alog);
      try {
        const wl = await window.storage.get("pm_worklog", true);
        if (wl && wl.value) setWorklog(JSON.parse(wl.value));
      } catch(_){}
      try {
        const ph = await window.storage.get("pm_photos", true);
        if (ph && ph.value) setPhotos(JSON.parse(ph.value));
      } catch(_){}
      try {
        const ac = await window.storage.get("pm_accounts", true);
        if (ac && ac.value) setAccounts(JSON.parse(ac.value));
      } catch(_){}
      try {
        const sl = await window.storage.get("pm_seqlogs", true);
        if (sl && sl.value) setSeqLogs(JSON.parse(sl.value));
      } catch(_){}
      try {
        // 統一欄位設定：內建欄位(成本費用明細新版) + 使用者自訂欄位
        const builtins = COLS.map(c => ({ id:c.id, label:c.label, builtin:true, fixed: !!c.fixed, w:c.w }));
        const builtinIds = new Set(COLS.map(c => c.id));
        const cc = await window.storage.get("pm_columns", true);
        let customs = [];
        if (cc && cc.value) {
          try {
            // 只保留「真正的使用者自訂欄」：非內建、id 不與新內建衝突、且不是重複的「稅金」公式欄
            customs = JSON.parse(cc.value).filter(c => c.builtin === false && !builtinIds.has(c.id) && c.label !== "稅金");
          } catch(_) {}
        }
        // 一律以新版內建欄位重建（移除舊的 實際/重複稅金 欄；遷移到 預估→已付→未付 模型）
        const merged = [...builtins, ...customs];
        setCustomCols(merged);
        window.storage.set("pm_columns", JSON.stringify(merged), true).catch(()=>{});
      } catch(_){}
      try { const ev = await window.storage.get("pm_events", true); if (ev&&ev.value) setEvents(JSON.parse(ev.value)); } catch(_){}
      try { const jn = await window.storage.get("pm_journal", true); if (jn&&jn.value) setJournal(JSON.parse(jn.value)); } catch(_){}
      try { const pl = await window.storage.get("pm_plans", true); if (pl&&pl.value) setPlans(JSON.parse(pl.value)); } catch(_){}
    })();
  }, []);

  // auto-save
  useEffect(() => {
    if (!cats) return;
    setSaving(true);
    const t = setTimeout(async () => {
      await saveData(cats);
      setSaving(false);
    }, 1200);
    return () => clearTimeout(t);
  }, [cats]);

  // LINE：偵測細項狀態變更為「有問題 / 完工」→ 即時推播（依開關）
  const prevCatsRef = useRef(null);
  useEffect(() => {
    const prev = prevCatsRef.current;
    prevCatsRef.current = cats;
    if (!cats || !prev) return; // 首次載入不通知
    for (const nc of cats) {
      const pc = prev.find(c => c.id === nc.id); if (!pc) continue;
      for (const ni of (nc.items || [])) {
        const pi = (pc.items || []).find(i => i.id === ni.id); if (!pi || pi.status === ni.status) continue;
        if (ni.status === "issue") notifyLineEvent("issue", `🚨【${nc.name}】「${ni.name}」狀態變更為「有問題」\n更新者：${userName || "未具名"}`);
        else if (ni.status === "done") notifyLineEvent("done", `✅【${nc.name}】「${ni.name}」完工\n更新者：${userName || "未具名"}`);
      }
    }
  }, [cats]); // eslint-disable-line

  const logActivity = (action, detail) => {
    const entry = { ts: new Date().toISOString(), user: userName||"系統", action, detail };
    setActivityLog(prev => { const next = [entry, ...prev].slice(0,200); saveActivityLog(next); return next; });
  };

  // ── 帳號 / 逐頁權限 ──
  // 內建管理員 goodmask77 恆為 admin；其餘帳號由管理員建立並逐頁開放編輯權限。
  const account = (userName === ADMIN_USER)
    ? { name: ADMIN_USER, role: "admin", pages: [] }
    : (accounts.find(a => a.name === userName) || (userName ? { name: userName, role: "viewer", pages: [] } : null));
  const isAdmin = account?.role === "admin";
  const can = (page) => isAdmin || !!account?.pages?.includes(page);
  const canEditData = can("data");
  const canEditWorklog = can("worklog");
  const canEditFiles = can("files");
  const canEditAdvisor = can("advisor");
  const canEdit = canEditData; // 相容：工程資料編輯

  const requireLogin = () => setShowLogin(true);
  const denyEdit = () => { if (!userName) setShowLogin(true); else alert("此帳號沒有編輯此頁面的權限，請聯絡管理員開放。"); };
  const guardedSetCats = (updater) => {
    if (!canEditData) { denyEdit(); return; }
    setCats(prev => typeof updater === "function" ? updater(prev) : updater);
  };
  const guardedSetSettings = (s) => {
    if (!canEditAdvisor) { denyEdit(); return; }
    setSettings(s); saveSettings(s);
  };

  const setCatsLogged = (updater) => {
    if (!canEditData) { denyEdit(); return; }
    setCats(prev => typeof updater === "function" ? updater(prev) : updater);
  };
  const setEventsLogged = (updater) => {
    setEvents(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set("pm_events", JSON.stringify(next), true).catch(()=>{});
      return next;
    });
  };
  const setJournalLogged = (updater) => {
    setJournal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set("pm_journal", JSON.stringify(next.slice(0,500)), true).catch(()=>{});
      return next;
    });
  };
  const setPlansLogged = (updater) => {
    setPlans(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set("pm_plans", JSON.stringify(next), true).catch(()=>{});
      return next;
    });
  };

  // Stall detection: items not updated > 3 days
  const stalledItems = cats ? cats.flatMap(c => c.items.filter(it => {
    if (it.status === "done" || it.done) return false;
    if (!it.lastUpdated) return false;
    const days = (Date.now() - new Date(it.lastUpdated)) / (1000*60*60*24);
    return days > 3;
  })) : [];

  const totalEstimated = cats ? cats.reduce((s, c) => s + catEstAfter(c), 0) : 0; // 議價後含稅總額
  const totalPaid = cats ? cats.reduce((s, c) => s + c.items.reduce((ss, it) => ss + paidOf(it), 0), 0) : 0;
  const doneCount = cats ? cats.filter(c => c.status === "done").length : 0;


  // drag-drop categories
  const onDragStart = (id) => setDragging(id);
  const onDragOver = (id) => { if (id !== dragging) setDragOver(id); };
  const onDrop = (targetId) => {
    if (!canEditData) { denyEdit(); setDragging(null); setDragOver(null); return; }
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

  // ── 工序頁（SequenceView）接線：工序=cats、日誌=pm_seqlogs ──
  const projectStart = settings?.projectStart || "2026-03-30";
  const CAT2WS = { pending:"pending", inprogress:"doing", done:"done", issue:"issue", hold:"wait" };
  const WS2CAT = { pending:"pending", doing:"inprogress", done:"done", issue:"issue", wait:"hold" };
  const _pad = (n)=>String(n).padStart(2,"0");
  const _toKey = (d)=>`${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  const _weekDate = (w0, off) => { const d=new Date(projectStart+"T00:00:00"); d.setDate(d.getDate()+w0*7+off); return _toKey(d); };
  const _segOf = (o) => Array.isArray(o.segments) && o.segments.length ? o.segments.filter(s=>s.start&&s.end)
    : (o.ganttStart != null ? [{ start:_weekDate(o.ganttStart,0), end:_weekDate(o.ganttStart+(o.ganttDur||1),-1) }] : []);
  const seqItems = [];
  (cats || []).slice().sort((a,b)=>(a.order??0)-(b.order??0)).forEach(c => {
    seqItems.push({ id:c.id, name:c.name, status: CAT2WS[c.status] || "pending", segments: _segOf(c), isParent:true, urgent: !!c.urgent });
    (c.seqSubs || []).forEach(sub => seqItems.push({ id:`${c.id}::${sub.id}`, name:sub.name, status: CAT2WS[sub.status] || "pending", segments: _segOf(sub), isSub:true, parentId:c.id, urgent: !!sub.urgent }));
    // 總覽勾選「排入工序」的成本細項 → 同步成工序子項目（工序專屬狀態/排程存在 item.seq）
    (c.items || []).filter(it => it.inSeq).forEach(it => seqItems.push({ id:`${c.id}::ci::${it.id}`, name: it.name, status: CAT2WS[it.seq?.status] || "pending", segments: (it.seq?.segments) || [], isSub:true, parentId:c.id, urgent: !!(it.seq?.urgent), fromCost:true }));
  });
  const seqSaveLog = (l) => {
    if (l.id) commitSeqLogs(seqLogs.map(x => x.id===l.id ? { ...l, updated_at:new Date().toISOString() } : x));
    else commitSeqLogs([...seqLogs, { ...l, id: "sl-"+Math.random().toString(36).slice(2,8), author: userName||"—", created_at:new Date().toISOString() }]);
  };
  const seqDelLog = (id) => commitSeqLogs(seqLogs.filter(x => x.id !== id));
  const _updSub = (itemId, patch) => { const [cid,sid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, seqSubs:(c.seqSubs||[]).map(s => s.id===sid ? { ...s, ...patch } : s) } : c)); };
  const _updCost = (itemId, patch) => { const [cid,,iid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, items:(c.items||[]).map(it => it.id===iid ? { ...it, seq:{ ...(it.seq||{}), ...patch } } : it) } : c)); };
  const _updSeqSub = (itemId, patch) => itemId.includes("::ci::") ? _updCost(itemId, patch) : _updSub(itemId, patch);
  const seqSetStatus = (itemId, wsKey) => { if (!canEditData) { denyEdit(); return; } const st = WS2CAT[wsKey]||"pending"; if (itemId.includes("::")) _updSeqSub(itemId, { status: st }); else setCats(prev => prev.map(c => c.id===itemId ? { ...c, status: st } : c)); };
  const seqSetSchedule = (itemId, segs) => { if (!canEditData) { denyEdit(); return; } if (itemId.includes("::")) _updSeqSub(itemId, { segments: segs }); else setCats(prev => prev.map(c => c.id===itemId ? { ...c, segments: segs } : c)); };
  const seqSetUrgent = (itemId, val) => { if (!canEditData) { denyEdit(); return; } if (itemId.includes("::")) _updSeqSub(itemId, { urgent: val }); else setCats(prev => prev.map(c => c.id===itemId ? { ...c, urgent: val } : c)); };
  const seqReorder = (fromId, toId) => { if (!canEditData) { denyEdit(); return; } setCats(prev => { const arr = [...prev].sort((a,b)=>(a.order??0)-(b.order??0)); const fi = arr.findIndex(c=>c.id===fromId), ti = arr.findIndex(c=>c.id===toId); if (fi<0||ti<0||fi===ti) return prev; const [m] = arr.splice(fi,1); arr.splice(ti,0,m); return arr.map((c,i)=>({ ...c, order:i })); }); };
  const seqAddSub = (catId, name) => { if (!canEditData) { denyEdit(); return; } const n=(name||"").trim(); if(!n) return; setCats(prev => prev.map(c => c.id===catId ? { ...c, seqSubs:[...(c.seqSubs||[]), { id:"ss-"+Math.random().toString(36).slice(2,7), name:n, status:"pending", segments:[] }] } : c)); };
  const seqDelSub = (itemId) => { if (!canEditData) { denyEdit(); return; } if (itemId.includes("::ci::")) { const [cid,,iid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, items:(c.items||[]).map(it => it.id===iid ? { ...it, inSeq:false } : it) } : c)); return; } const [cid,sid] = itemId.split("::"); setCats(prev => prev.map(c => c.id===cid ? { ...c, seqSubs:(c.seqSubs||[]).filter(s=>s.id!==sid) } : c)); };
  const seqSetProjectStart = (v) => { if (!canEditData) { denyEdit(); return; } const s = { ...(settings||{}), projectStart: v }; setSettings(s); saveSettings(s); };
  const seqUploadPhotos = async (files) => { const out=[]; for (const f of files) { try { const { url } = await uploadPhoto(f); out.push(url); } catch(_){} } return out; };
  const seqAiTidy = async (f) => {
    const draft = [f.done && `已完成：${f.done}`, f.issue && `問題：${f.issue}`, f.next && `明日：${f.next}`].filter(Boolean).join("\n") || "（無草稿）";
    const reply = await callAI([{ role:"user", content:`請把以下工地日誌草稿整理成一段精簡通順的施工紀錄（繁體中文、一段話、不要條列、不要開場白）：\n${draft}` }], "你是工程現場記錄助理。");
    return (reply||"").replace(/```[\s\S]*?```/g,"").trim();
  };
  const seqAiWeekly = async (weekLogs) => {
    const lines = weekLogs.map(l => `${l.date} ${seqItems.find(i=>i.id===l.itemId)?.name||""}：${l.done||l.next||""}${l.issue?`（問題：${l.issue}）`:""}`).join("\n") || "（本週無紀錄）";
    return await callAI([{ role:"user", content:`以下是本週各工序施工日誌，請產生給業主看的本週進度週報（繁體中文，淺顯，含：本週完成、進行中、問題/待決、下週預計、整體評估🟢/🟡/🔴）：\n${lines}` }], "你是餐廳裝修工程顧問，為業主寫週報。");
  };

  const isMobile = useIsMobile();

  if (!cats) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG, color: SUB, fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,sans-serif", fontSize: 15 }}>
      載入中…
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, fontFamily: "-apple-system,'PingFang TC','Noto Sans TC',system-ui,'Segoe UI',sans-serif", fontSize: 14, letterSpacing: 0.1 }}>
      {/* TOP NAV */}
      <TopNav view={view} setView={setView} saving={saving} totalEstimated={totalEstimated} totalPaid={totalPaid} doneCount={doneCount} catCount={cats.length} onAI={() => setShowGlobalAI(true)} userName={userName} isAdmin={isAdmin} stalledCount={stalledItems.length} onRoleClick={() => setShowLogin(true)} onActivityLog={() => setShowActivityLog(true)} activityCount={activityLog.length} isMobile={isMobile} />

      {/* MAIN */}
      <div style={{ padding: isMobile ? "0 12px 84px" : "0 16px 80px" }}>
        {view === "owner" && settings && (
          <OwnerDashboard cats={cats} setCats={setCatsLogged} settings={settings} stalledItems={stalledItems} activityLog={activityLog} logActivity={logActivity} userName={userName} journal={journal} events={events} plans={plans} />
        )}
        {view === "overview" && (
          <OverviewTable cats={cats} setCats={guardedSetCats} confirm={confirm} customCols={customCols} setCustomCols={canEditData ? commitCustomCols : null}
            onSelect={(cat) => { setSelectedCat(cat); setSelectedItem(null); }} dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} />
        )}
        {view === "gantt" && (
          <SequenceView
            items={seqItems} logs={seqLogs} projectStart={projectStart} warnDays={3} canEdit={canEditData}
            onSaveLog={seqSaveLog} onDelLog={seqDelLog} onSetStatus={seqSetStatus} onSetSchedule={seqSetSchedule}
            onSetProjectStart={seqSetProjectStart} uploadPhotos={seqUploadPhotos} aiTidy={seqAiTidy} aiWeekly={seqAiWeekly}
            onReorder={seqReorder} onAddSub={seqAddSub} onDelSub={seqDelSub} onSetUrgent={seqSetUrgent}
          />
        )}
        {view === "files" && (
          <PhotoLibraryView photos={photos} setPhotos={commitPhotos} cats={cats} canEdit={canEditFiles} userName={userName} requireLogin={denyEdit} confirm={confirm} />
        )}
        {view === "accounts" && isAdmin && (
          <AccountManager accounts={accounts} setAccounts={commitAccounts} confirm={confirm} />
        )}
        {view === "advisor" && settings && (
          <AdvisorSettingsView settings={settings} setSettings={guardedSetSettings} cats={cats} aiLog={aiLog} setAiLog={l => { setAiLog(l); saveAILog(l); }} journal={journal} events={events} plans={plans} activityLog={activityLog} logActivity={logActivity} userName={userName} />
        )}
      </div>

      {/* CATEGORY DETAIL PANEL */}
      {selectedCat && !selectedItem && (
        <CatPanel cat={selectedCat} cats={cats} setCats={guardedSetCats} onClose={() => setSelectedCat(null)} onSelectItem={(item) => setSelectedItem(item)} confirm={confirm} />
      )}

      {/* ITEM DETAIL PANEL */}
      {selectedCat && selectedItem && (
        <ItemPanel cat={selectedCat} item={selectedItem} cats={cats} setCats={guardedSetCats} onClose={() => setSelectedItem(null)} confirm={confirm} />
      )}

      {showActivityLog && <ActivityLogPanel activityLog={activityLog} onClose={() => setShowActivityLog(false)} />}
      {ConfirmDialog}
      {showLogin && (
        <LoginModal knownUsers={knownUsers} onClose={() => setShowLogin(false)} onLogin={async (name) => {
          setUserName(name);
          saveRole(name);
          setShowLogin(false);
          // Save to known users list（管理員不記錄、不顯示）
          if (name !== ADMIN_USER) {
            try {
              const updated = [name, ...knownUsers.filter(u=>u!==name)].slice(0,8);
              setKnownUsers(updated);
              await window.storage.set("pm_known_users", JSON.stringify(updated), true);
            } catch(_){}
          }
          logActivity("登入", name + " 登入系統");
        }} />
      )}
      {/* GLOBAL AI */}
      {showGlobalAI && (
        <GlobalAIPanel chat={globalChat} setChat={setGlobalChat} onClose={() => setShowGlobalAI(false)} cats={cats} setCats={guardedSetCats} canEdit={canEdit} confirm={confirm} settings={settings} setSettings={guardedSetSettings} worklog={worklog} setWorklog={commitWorklog} />
      )}

      {/* 手機底部固定導覽 */}
      {isMobile && <BottomNav view={view} setView={setView} />}
    </div>
  );
}

// ── BOTTOM NAV (手機) ───────────────────────────────────────────────────────
function BottomNav({ view, setView }) {
  const tabs = [["owner", "儀表板", "📊"], ["overview", "總覽", "📋"], ["gantt", "工序", "📅"], ["files", "檔案庫", "📁"], ["advisor", "AI設定", "🤖"]];
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 60, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderTop: `1px solid ${BORDER}`, boxShadow: "0 -2px 14px rgba(0,0,0,0.08)", display: "flex", zIndex: 350, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(([v, l, icon]) => {
        const on = view === v;
        return (
          <button key={v} onClick={() => setView(v)} title={l} style={{ flex: 1, minHeight: 44, border: "none", background: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", color: on ? ACCENT : SUB, fontWeight: on ? 700 : 500, padding: 0 }}>
            <span style={{ fontSize: 19, lineHeight: 1, filter: on ? "none" : "grayscale(0.4) opacity(0.85)" }}>{icon}</span>
            <span style={{ fontSize: 10.5 }}>{l}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────────
function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (msg) => new Promise(resolve => setState({ msg, resolve }));
  const Dialog = state ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#EFE7D6", border: "1px solid #D8CFBB", borderRadius: 14, padding: "24px 22px", maxWidth: 320, width: "90%", textAlign: "center" }}>
        <div style={{ fontSize: 15, color: "#211C15", marginBottom: 20, lineHeight: 1.6 }}>{state.msg}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={() => { state.resolve(false); setState(null); }} style={{ flex: 1, padding: "9px 0", background: "#D8CFBB", border: "1px solid #D8CFBB", borderRadius: 8, color: "#6F6656", cursor: "pointer", fontSize: 14 }}>取消</button>
          <button onClick={() => { state.resolve(true); setState(null); }} style={{ flex: 1, padding: "9px 0", background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 8, color: "#DC2626", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>確定刪除</button>
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
      style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 9, padding: "6px 11px", position: "relative", cursor: "help" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      <div style={{ fontSize: 11, color: SUB, marginBottom: 2, display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
        {label}
        <span style={{ fontSize: 8, color: "#CDC3AC", border: "1px solid #CDC3AC", borderRadius: "50%", width: 11, height: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>?</span>
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 16, fontWeight: 600, color, letterSpacing: -0.3 }}>{val}</div>
      {show && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, background: PRIMARY, border: "none", borderRadius: 8, padding: "9px 11px", fontSize: 12, color: "#D8CFBB", zIndex: 300, whiteSpace: "normal", width: 240, lineHeight: 1.6, boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
          {tip}
        </div>
      )}
    </div>
  );
}

// ── TOP NAV ───────────────────────────────────────────────────────────────────
function TopNav({ view, setView, saving, totalEstimated, totalPaid, doneCount, catCount, onAI, userName, isAdmin, stalledCount, onRoleClick, onActivityLog, activityCount, isMobile }) {
  const totalUnpaid = totalEstimated - totalPaid;
  const payPct = totalEstimated > 0 ? Math.round(totalPaid / totalEstimated * 100) : 0;
  return (
    <div style={{ background: BG, borderBottom: `1px solid ${BORDER}`, padding: isMobile ? "10px 14px 0" : "16px 22px 0", position: "sticky", top: 0, zIndex: 100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 10 : 12, flexWrap: "wrap" }}>
        <div style={{ flexShrink: 0, order: 0 }}>
          <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 800, color: ACCENT, lineHeight: 1, letterSpacing: -1 }}>GROUN:D</div>
          {!isMobile && <div style={{ fontSize: 9.5, color: SUB, letterSpacing: 2.5, textTransform: "uppercase", marginTop: 4, fontWeight: 600 }}>Construction Project Tracker</div>}
        </div>
        {/* KPI cards inline（手機改 2×2、整列獨佔一行）*/}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,minmax(110px,1fr))", gap: 8, flex: isMobile ? "1 1 100%" : 1, minWidth: isMobile ? 0 : 360, order: isMobile ? 2 : 0 }}>
          {[
            { label: "預估總額", val: fmt(totalEstimated), color: TEXT, tip: "各細項「數量×單價」依稅別換算含稅後加總＝總預算" },
            { label: "已付總額", val: totalPaid > 0 ? fmt(totalPaid) : "尚未付款", color: totalPaid > 0 ? "#3C8C3C" : SUB, tip: `各細項「已付金額」加總。付款進度 ${payPct}%` },
            { label: "未付總額", val: fmt(totalUnpaid), color: totalUnpaid < 0 ? "#DC2626" : "#C2872E", tip: totalUnpaid < 0 ? "已付超過預估（溢付）" : "預估總額 − 已付總額＝尚需支付" },
            { label: "完工項目", val: `${doneCount} / ${catCount}`, color: ACCENT, tip: "狀態標示為「完工」的大項數" },
          ].map(k => <KPICard key={k.label} label={k.label} val={k.val} color={k.color} tip={k.tip} />)}
        </div>
        {/* actions（手機改 icon-only，保留 title 提示）*/}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, order: isMobile ? 1 : 0, marginLeft: isMobile ? "auto" : 0 }}>
          {saving && <div style={{ fontSize: 11, color: SUB }}>同步中…</div>}
          {stalledCount > 0 && (
            <div title={`${stalledCount} 項卡關`} style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "4px 10px", fontSize: 12, color: "#DC2626", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }} onClick={() => setView && setView("overview")}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: "#DC2626" }} />{stalledCount}
            </div>
          )}
          {userName ? (
            <div onClick={onRoleClick} title={`${userName}（點擊可切換帳號 / 登出）`} style={{ display: "flex", alignItems: "center", gap: 7, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: isMobile ? "6px" : "5px 12px", minHeight: 40, cursor: "pointer" }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: ACCENT_SOFT, color: ACCENT, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{(userName[0] || "?").toUpperCase()}</span>
              {!isMobile && <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>{userName}</span>}
            </div>
          ) : (
            <button onClick={onRoleClick} title="登入以編輯" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: PRIMARY, border: "none", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", color: "#fff", fontSize: isMobile ? 17 : 13, fontWeight: 500 }}>
              {isMobile ? "🔑" : "登入以編輯"}
            </button>
          )}
          <button onClick={onActivityLog} title="活動記錄" style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT, borderRadius: 8, padding: isMobile ? 0 : "7px 12px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, position: "relative" }}>
            {isMobile ? "🔔" : <>活動{activityCount > 0 ? <span style={{ fontSize: 10, background: ACCENT_SOFT, color: ACCENT, fontWeight: 600, borderRadius: 10, padding: "1px 6px" }}>{activityCount}</span> : ""}</>}
            {isMobile && activityCount > 0 && <span style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", background: ACCENT, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>{activityCount > 99 ? "99+" : activityCount}</span>}
          </button>
          <button onClick={onAI} title="AI 顧問" style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: isMobile ? 0 : "8px 16px", width: isMobile ? 40 : "auto", height: isMobile ? 40 : "auto", minHeight: 40, cursor: "pointer", fontSize: isMobile ? 17 : 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isMobile ? "🤖" : "AI 顧問"}
          </button>
        </div>
      </div>
      {/* view tabs — boxed editorial（手機隱藏，改用底部導覽）*/}
      {!isMobile && (
      <div style={{ display: "flex", gap: 8, paddingBottom: 12, flexWrap: "wrap" }}>
        {[["owner","儀表板"],["overview","總覽"],["gantt","工序"],["files","檔案庫"],["advisor","AI設定"],...(isAdmin?[["accounts","帳號"]]:[])].map(([v,l]) => (
          <button key={v} onClick={() => setView(v)} style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${view === v ? PRIMARY : BORDER}`, cursor: "pointer", fontSize: 14, fontWeight: 500, background: view === v ? PRIMARY : "transparent", color: view === v ? "#fff" : TEXT, transition: "all .12s" }}>{l}</button>
        ))}
      </div>
      )}
    </div>
  );
}


// ── OVERVIEW TABLE (Notion-style) ────────────────────────────────────────────
const COLS = [
  // 識別區
  { id:"cat",      label:"大項",   w:110, fixed:true },
  { id:"name",     label:"細項名稱", w:200, fixed:true },
  { id:"status",   label:"狀態",   w:90 },
  { id:"assignee", label:"負責人",  w:100 },
  // 金額區
  { id:"estQty",   label:"數量",   w:70 },
  { id:"unit",     label:"單位",   w:56 },
  { id:"estUnitPrice", label:"單價", w:100 },
  { id:"taxType",  label:"稅別",   w:84 },
  { id:"taxAmount",label:"稅額",   w:90 },
  { id:"estTotal", label:"預估金額", w:120 },
  // 付款區
  { id:"paid",     label:"已付金額", w:110 },
  { id:"unpaid",   label:"未付金額", w:110 },
  { id:"payAccount",  label:"付款帳號", w:130 },
  { id:"payDate",  label:"付款日",  w:120 },
  { id:"receipts", label:"憑證",   w:104 },
  // 其他
  { id:"notes",    label:"備註",   w:180 },
];

const MONEY_FIELDS = new Set(["estUnitPrice"]); // 只有這些 number 欄要加 NT$
// 安全地計算公式（變數來自 ctx；錯誤回傳空）
function evalFormula(expr, ctx) {
  if (!expr) return 0;
  try {
    const keys = Object.keys(ctx);
    const fn = new Function(...keys, `"use strict"; try { return (${expr}); } catch(e){ return null; }`);
    const v = fn(...keys.map(k => ctx[k]));
    return (typeof v === "number" && isFinite(v)) ? v : (v ?? "");
  } catch (_) { return ""; }
}
function CustomInput({ value, type, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => { setLocal(value ?? ""); }, [value]);
  const isNum = type === "number" || type === "money";
  const display = (type === "money" && value !== undefined && value !== "" && value !== null) ? fmt(Number(value)||0) : (value ?? "");
  if (editing) {
    return <input autoFocus value={local} onChange={e=>setLocal(e.target.value)}
      onBlur={()=>{ onCommit(isNum ? (parseFloat(local)||0) : local); setEditing(false); }}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Escape") e.target.blur(); }}
      style={{ width:"100%", border:"none", outline:"2px solid "+ACCENT, borderRadius:4, padding:"2px 4px", fontSize:12.5, fontFamily:"'Noto Sans TC',sans-serif", background:"#F3E4DE" }} />;
  }
  return <div onClick={()=>{ setLocal(value ?? ""); setEditing(true); }} style={{ width:"100%", cursor:"text", minHeight:22, color: (value!==undefined&&value!=="")?"#211C15":"#CDC3AC", padding:"2px 2px" }}>{display || "—"}</div>;
}
function OverviewTable({ cats, setCats, confirm, customCols = [], setCustomCols, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop }) {
  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState("money");
  const [newColFormula, setNewColFormula] = useState("");
  const [dragRowId, setDragRowId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [hiddenCols, setHiddenCols] = useState(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [editCell, setEditCell] = useState(null); // {rowId, col}
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewMode, setViewMode] = useState(() => (typeof window !== "undefined" && window.innerWidth < MOBILE_BP) ? "card" : "table"); // 手機預設卡片；table | card（卡片＝原看板）
  const [collapsed, setCollapsed] = useState(new Set()); // 收合的大項 id
  const toggleCollapse = (catId) => setCollapsed(s => { const n = new Set(s); n.has(catId) ? n.delete(catId) : n.add(catId); return n; });
  const allCollapsed = cats.length > 0 && cats.every(c => collapsed.has(c.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(cats.map(c => c.id)));
  const [lightbox, setLightbox] = useState(null); // 憑證放大檢視
  const [rcpBusy, setRcpBusy] = useState(null);    // 正在上傳憑證的 itemId

  // Flatten all items into rows with cat info
  const allRows = [];
  [...cats].sort((a,b) => a.order - b.order).forEach(cat => {
    cat.items.forEach(item => {
      allRows.push({ catId: cat.id, catName: cat.name, item });
    });
  });

  const rows = filterStatus === "all" ? allRows : allRows.filter(r => r.item.status === filterStatus);

  const updateItem = (catId, itemId, field, val) => {
    setCats(prev => prev.map(c => c.id === catId
      ? { ...c, items: c.items.map(it => it.id === itemId ? { ...it, [field]: val } : it) }
      : c
    ));
  };

  const addReceipts = async (catId, item, files) => {
    if (!files || !files.length) return;
    setRcpBusy(item.id);
    const out = [];
    for (const f of files) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); }
      catch (_) {}
    }
    setRcpBusy(null);
    if (out.length) updateItem(catId, item.id, "receipts", [...(item.receipts || []), ...out]);
  };
  const removeReceipt = async (catId, item, rid, ri) => {
    const r = (item.receipts || [])[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    updateItem(catId, item.id, "receipts", (item.receipts || []).filter((_, i) => i !== ri));
  };

  const deleteItem = (catId, itemId, name) => {
    confirm(`刪除「${name}」？`).then(ok => {
      if (ok) setCats(prev => prev.map(c => c.id === catId
        ? { ...c, items: c.items.filter(it => it.id !== itemId) }
        : c
      ));
    });
  };

  // Row drag-drop (reorder within same cat, or across cats)
  const onRowDragStart = (rowKey) => setDragRowId(rowKey);
  const onRowDrop = (targetKey) => {
    if (!dragRowId || dragRowId === targetKey) { setDragRowId(null); setDragOverId(null); return; }
    // Move item in cats
    const [srcCatId, srcItemId] = dragRowId.split("||");
    const [tgtCatId, tgtItemId] = targetKey.split("||");
    setCats(prev => {
      let newCats = prev.map(c => ({ ...c, items: [...c.items] }));
      const srcCat = newCats.find(c => c.id === srcCatId);
      const tgtCat = newCats.find(c => c.id === tgtCatId);
      const srcIdx = srcCat.items.findIndex(i => i.id === srcItemId);
      const tgtIdx = tgtCat.items.findIndex(i => i.id === tgtItemId);
      const [moved] = srcCat.items.splice(srcIdx, 1);
      if (srcCatId === tgtCatId) {
        srcCat.items.splice(tgtIdx, 0, moved);
      } else {
        tgtCat.items.splice(tgtIdx, 0, moved);
      }
      return newCats;
    });
    setDragRowId(null); setDragOverId(null);
  };

  // ── 統一欄位（內建+自訂，皆可排序/改名/刪除/調寬）──
  const builtinMap = Object.fromEntries(COLS.map(c => [c.id, c]));
  const cols = (customCols && customCols.length) ? customCols : COLS.map(c => ({ id:c.id, label:c.label, builtin:true, fixed:!!c.fixed, w:c.w }));
  const resolve = (e) => e.builtin ? { ...builtinMap[e.id], label: e.label ?? builtinMap[e.id]?.label, w: e.w ?? builtinMap[e.id]?.w, builtin:true, fixed: e.fixed ?? builtinMap[e.id]?.fixed } : e;
  const orderedCols = cols.map(resolve).filter(c => c && c.id);
  const totalW = orderedCols.reduce((s,c) => s + (c.w || 110), 0) + 48;

  const NUM_BUILTIN = new Set(["estQty","estUnitPrice","taxAmount","estTotal","paid","unpaid"]);
  const MONEY_TOTAL = new Set(["taxAmount","estTotal","paid","unpaid"]); // 內建總計顯示為金額
  const NO_SUM = new Set(["estUnitPrice"]); // 單價不加總
  const isNumCol = (col) => col.builtin ? NUM_BUILTIN.has(col.id) : (col.type === "money" || col.type === "number" || col.type === "formula");
  const isMoneyCol = (col) => col.builtin ? (MONEY_TOTAL.has(col.id) || ["estUnitPrice"].includes(col.id)) : (col.type === "money" || col.type === "formula");
  const summable = (col) => isNumCol(col) && !NO_SUM.has(col.id);

  const buildCtx = (item) => {
    const ctx = {
      estQty: Number(item.estQty ?? item.qty ?? 0),
      estUnitPrice: Number(item.estUnitPrice ?? item.unitPrice ?? 0),
      taxAmount: taxOf(item),
      estTotal: estAmount(item),
      paid: paidOf(item),
      unpaid: unpaidOf(item),
    };
    cols.filter(c => c.builtin === false && c.type !== "formula").forEach(c => { ctx[c.id] = c.type === "text" ? (item.cust?.[c.id] || "") : (Number(item.cust?.[c.id]) || 0); });
    cols.filter(c => c.builtin === false && c.type === "formula").forEach(c => { ctx[c.id] = evalFormula(c.formula, ctx); });
    return ctx;
  };
  const numVal = (col, item) => {
    if (col.builtin) {
      if (col.id === "estTotal") return estAmount(item);
      if (col.id === "taxAmount") return taxOf(item);
      if (col.id === "paid") return paidOf(item);
      if (col.id === "unpaid") return unpaidOf(item);
      const m = { estQty:item.estQty??item.qty, estUnitPrice:item.estUnitPrice??item.unitPrice };
      return Number(m[col.id]) || 0;
    }
    return Number(buildCtx(item)[col.id]) || 0;
  };

  const updateCustom = (catId, itemId, colId, val) => setCats(prev => prev.map(c => c.id===catId ? { ...c, items: c.items.map(it => it.id===itemId ? { ...it, cust: { ...(it.cust||{}), [colId]: val } } : it) } : c) );
  const addCustomCol = () => {
    if (!setCustomCols) return;
    const label = newColLabel.trim(); if (!label) return;
    const id = "cc-" + Math.random().toString(36).slice(2,6);
    setCustomCols([...cols, { id, label, type:newColType, formula: newColType==="formula"?newColFormula.trim():undefined, w:110, builtin:false }]);
    setNewColLabel(""); setNewColFormula("");
  };
  const delCol = (id) => { if (!setCustomCols) return; const c = cols.find(x=>x.id===id); if (c?.fixed) return; setCustomCols(cols.filter(x => x.id !== id)); };
  const renameCol = (id, label) => setCustomCols && setCustomCols(cols.map(c => c.id===id ? { ...c, label } : c));
  const setColW = (id, w) => setCustomCols && setCustomCols(cols.map(c => c.id===id ? { ...c, w: Math.max(50, Math.round(w)) } : c));
  const reAddBuiltin = (id) => { if (!setCustomCols) return; const def = builtinMap[id]; if (!def) return; setCustomCols([...cols, { id, label:def.label, builtin:true, fixed:false, w:def.w }]); };
  const moveCol = (dragId, targetId) => { if (!setCustomCols || dragId===targetId) return; const arr=[...cols]; const fi=arr.findIndex(c=>c.id===dragId), ti=arr.findIndex(c=>c.id===targetId); if (fi<0||ti<0||arr[fi].fixed||arr[ti].fixed) return; const [m]=arr.splice(fi,1); arr.splice(ti,0,m); setCustomCols(arr); };
  const startColResize = (id, e) => { e.preventDefault(); e.stopPropagation(); const startX=e.clientX; const startW = (cols.find(c=>c.id===id)?.w) || builtinMap[id]?.w || 110; const move=(ev)=>setColW(id, startW + ev.clientX - startX); const up=()=>{ document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up); }; document.addEventListener("mousemove",move); document.addEventListener("mouseup",up); };
  const [colDrag, setColDrag] = useState(null);

  const cellStyle = (col) => ({
    minWidth: col.w, maxWidth: col.w, width: col.w,
    padding: "0 8px", borderRight: "1px solid #D8CFBB",
    fontSize: 12.5, overflow: "hidden", whiteSpace: "nowrap",
    textOverflow: "ellipsis", height: 30, display: "flex", alignItems: "center",
    flexShrink: 0,
  });

  const EditableCell = ({ catId, itemId, field, value, type="text", placeholder="" }) => {
    const key = `${itemId}||${field}`;
    const isEditing = editCell === key;
    const [local, setLocal] = useState(String(value ?? ""));
    useEffect(() => { setLocal(String(value ?? "")); }, [value]);
    if (type === "date") {
      const iso = String(value ?? "").replace(/\//g, "-").slice(0, 10);
      const openPicker = (e) => { try { e.currentTarget.showPicker(); } catch {} };
      return (
        <input
          type="date"
          value={iso}
          onChange={e => updateItem(catId, itemId, field, e.target.value)}
          onClick={openPicker}
          onFocus={openPicker}
          style={{ width: "100%", border: "none", outline: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", color: iso ? "#211C15" : "#CDC3AC", padding: "2px 2px", colorScheme: "light" }}
        />
      );
    }
    if (isEditing) {
      return (
        <input
          autoFocus
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={() => {
            const v = type === "number" ? (parseFloat(local) || 0) : local;
            updateItem(catId, itemId, field, v);
            setEditCell(null);
          }}
          onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
          style={{ width: "100%", border: "none", outline: "2px solid " + ACCENT, borderRadius: 4, padding: "2px 4px", fontSize: 12.5, fontFamily: "'Noto Sans TC', sans-serif", background: "#F3E4DE" }}
        />
      );
    }
    return (
      <div onClick={() => { setLocal(String(value ?? "")); setEditCell(key); }}
        style={{ width: "100%", cursor: "text", minHeight: 22, color: value ? "#211C15" : "#CDC3AC", padding: "2px 2px", borderRadius: 3, transition: "background 0.1s" }}
        onMouseEnter={e => e.currentTarget.style.background="#f0f7ff"}
        onMouseLeave={e => e.currentTarget.style.background="transparent"}
      >
        {type === "number" && value ? (MONEY_FIELDS.has(field) ? fmt(value) : value) : (value || placeholder || "—")}
      </div>
    );
  };

  const catGroups = {};
  // 「全部」檢視時，先列出所有大項（含 0 細項的空大項），確保與其他頁同步
  if (filterStatus === "all") {
    [...cats].sort((a,b) => a.order - b.order).forEach(c => { catGroups[c.id] = { name: c.name, rows: [] }; });
  }
  rows.forEach(r => {
    if (!catGroups[r.catId]) catGroups[r.catId] = { name: r.catName, rows: [] };
    catGroups[r.catId].rows.push(r);
  });

  return (
    <div style={{ paddingTop: 12 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: -0.2 }}>總覽</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{viewMode === "card" ? "工程大項一覽" : "成本費用明細"}</div>
        <div style={{ flex: 1 }} />
        {viewMode === "table" && (
          <button onClick={toggleAll} style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${BORDER}`, fontSize: 12.5, cursor: "pointer", background: SURFACE, color: SUB, fontWeight: 500 }}>{allCollapsed ? "全部展開" : "全部收合"}</button>
        )}
        {/* 表格 / 卡片 切換 */}
        <div style={{ display: "inline-flex", background: "#EFE7D6", borderRadius: 8, padding: 3 }}>
          {[["table","表格"],["card","卡片"]].map(([k,l]) => (
            <button key={k} onClick={() => setViewMode(k)} style={{ border: "none", cursor: "pointer", padding: "5px 16px", borderRadius: 6, fontSize: 13, fontWeight: 500, background: viewMode === k ? SURFACE : "transparent", color: viewMode === k ? TEXT : SUB, boxShadow: viewMode === k ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>{l}</button>
          ))}
        </div>
      </div>

      {viewMode === "card" ? (
        <KanbanView cats={cats} setCats={setCats} onSelect={onSelect} dragging={dragging} dragOver={dragOver} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} confirm={confirm} />
      ) : (
      /* table */
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 168px)", borderRadius: 12, border: `1px solid ${BORDER}`, background: SURFACE }}>
        <div style={{ minWidth: totalW }}>
          {/* header */}
          <div style={{ display: "flex", background: BG, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: `1px solid ${BORDER}` }} />
            {orderedCols.map(col => (
              <div key={col.id} style={{ ...cellStyle(col), position: "relative", fontWeight: 500, fontSize: 12, color: SUB, letterSpacing: 0.2, background: BG }}>
                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{col.label}{col.type==="formula" && <span style={{ fontSize:9, marginLeft:3 }}>ƒ</span>}</span>
                {setCustomCols && <div onMouseDown={e=>startColResize(col.id, e)} title="拖曳調整欄寬" style={{ position:"absolute", right:-3, top:0, bottom:0, width:7, cursor:"col-resize", zIndex:2 }} />}
              </div>
            ))}
            <div style={{ width: 32, flexShrink: 0 }} />
          </div>

          {/* rows grouped by cat */}
          {Object.entries(catGroups).map(([catId, group]) => {
            const cat = cats.find(c => c.id === catId);
            const groupRaw = cat ? catRawEst(cat) : group.rows.reduce((s,r) => s + estAmount(r.item), 0); // 原報價（未折）
            const disc = cat ? catDiscount(cat) : { hasDiscount: false, factor: 1, pct: 0, sub: 0 };
            const groupEst = cat ? catEstAfter(cat) : groupRaw; // 議價後含稅
            const groupSaved = groupRaw - groupEst;
            const groupPaid = group.rows.reduce((s,r) => s + paidOf(r.item), 0);
            const groupUnpaid = groupEst - groupPaid;
            const itemCount = cat ? cat.items.length : group.rows.length;
            const doneCount = cat ? cat.items.filter(i => i.status === "done").length : 0;
            const pct = itemCount ? Math.round(doneCount / itemCount * 100) : 0;
            const isCollapsed = collapsed.has(catId);
            const isCatDragOver = dragOver === catId;
            return (
              <div key={catId}>
                {/* cat group header — 可收合 / 拖曳排序 / 狀態 / 進度 */}
                <div
                  draggable={!!onDragStart}
                  onDragStart={() => onDragStart && onDragStart(catId)}
                  onDragOver={e => { if (onDragOver) { e.preventDefault(); onDragOver(catId); } }}
                  onDrop={() => onDrop && onDrop(catId)}
                  onDragEnd={() => onDragOver && onDragOver(null)}
                  style={{ display: "flex", alignItems: "center", background: isCatDragOver ? "#F3E4DE" : BG, borderBottom: `1px solid ${BORDER}`, borderLeft: `2px solid ${ACCENT}`, padding: "0 10px", height: 32, gap: 10, position: "sticky", top: 40, zIndex: 9 }}>
                  <span title="拖曳排序大項" style={{ cursor: "grab", color: "#C8BCA0", fontSize: 13, flexShrink: 0 }}>⠿</span>
                  <button onClick={() => toggleCollapse(catId)} style={{ border: "none", background: "none", cursor: "pointer", color: SUB, fontSize: 11, width: 14, flexShrink: 0, transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform .15s" }}>▸</button>
                  <div onClick={() => toggleCollapse(catId)} style={{ fontSize: 14, fontWeight: 600, color: PRIMARY, letterSpacing: -0.1, cursor: "pointer", flexShrink: 0 }}>{group.name}</div>
                  <div style={{ flexShrink: 0 }}><StatusBadge status={cat?.status || "pending"} setCats={setCats} catId={catId} /></div>
                  {itemCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                      <div style={{ width: 64, height: 5, background: "#E3DAC6", borderRadius: 3, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: pct === 100 ? "#3C8C3C" : "#3E72A8" }} /></div>
                      <span style={{ fontSize: 11, color: SUB }}>{doneCount}/{itemCount}</span>
                    </div>
                  )}
                  <div style={{ flex: 1 }} />
                  {/* 議價折扣（套用在未稅層、稅金重算；細項原報價不動）*/}
                  {itemCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }} title="大項議價折扣：套用在未稅小計、稅金重算">
                      <button onClick={() => setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: (disc.mode === "amt" ? "pct" : "amt"), discountValue: 0 } : c))}
                        title={disc.mode === "amt" ? "目前：折讓金額（點擊改為折 %）" : "目前：折 %（點擊改為折讓金額）"}
                        style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: ACCENT, borderRadius: 5, width: 22, height: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0 }}>{disc.mode === "amt" ? "$" : "%"}</button>
                      <input type="number" min={0} max={disc.mode === "amt" ? Math.round(disc.sub) : 100} value={cat?.discountValue || ""} placeholder="議價"
                        onChange={e => { const max = disc.mode === "amt" ? catPretaxSub(cat) : 100; let v = Math.min(Math.max(Number(e.target.value) || 0, 0), max); setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: disc.mode, discountValue: v } : c)); }}
                        style={{ width: 54, height: 20, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "0 5px", fontSize: 11, fontVariantNumeric: "tabular-nums", background: "#fff", color: TEXT }} />
                    </div>
                  )}
                  {disc.hasDiscount ? (<>
                    <div style={{ fontSize: 12, color: SUB }}>原報價 <span style={{ color: "#A99F88", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmt(groupRaw)}</span></div>
                    <div style={{ fontSize: 12, color: SUB }}>議價後 <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(groupEst)}</span></div>
                    <div style={{ fontSize: 12, color: "#C0392B", fontWeight: 600, fontVariantNumeric: "tabular-nums" }} title={`折讓 ${fmt(disc.amt)}（未稅）`}>省 {fmt(groupSaved)}（-{Math.round(disc.pct * 10) / 10}%）</div>
                  </>) : (
                    <div style={{ fontSize: 12, color: SUB }}>預估 <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(groupEst)}</span></div>
                  )}
                  <div style={{ fontSize: 12, color: SUB }}>已付 <span style={{ color: "#3C8C3C", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(groupPaid)}</span></div>
                  <div style={{ fontSize: 12, color: SUB }}>未付 <span style={{ color: groupUnpaid < 0 ? "#DC2626" : "#C2872E", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{groupUnpaid < 0 ? `溢付 ${fmt(-groupUnpaid)}` : fmt(groupUnpaid)}</span></div>
                  {itemCount > 0 && (() => {
                    const f = disc.factor;
                    const payTarget = (it) => f === 1 ? estAmount(it) : (() => { const pre = pretaxOf(it) * f; const tax = isTaxable(it) ? pre * 0.05 : 0; return Math.round(pre + tax); })();
                    const allFull = group.rows.every(r => { const e = payTarget(r.item); return e <= 0 || paidOf(r.item) >= e; });
                    return (
                      <button onClick={() => setCats(prev => prev.map(c => c.id === catId ? { ...c, items: c.items.map(it => ({ ...it, paid: allFull ? 0 : payTarget(it) })) } : c))} title={allFull ? "清除本大項所有已付金額" : "本大項全部一鍵付清（已付＝議價後金額）"} style={{ flexShrink: 0, border: `1px solid ${allFull ? "#C2872E" : "#3C8C3C"}`, background: allFull ? "#FFFBEB" : "#F0FDF4", color: allFull ? "#C2872E" : "#3C8C3C", borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{allFull ? "清除付款" : "✓ 全部付清"}</button>
                    );
                  })()}
                  <button onClick={() => confirm(`確定刪除工程大項「${group.name}」？\n（含其下 ${itemCount} 筆細項，無法復原）`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== catId)); })} title="刪除此工程大項" style={{ flexShrink: 0, marginLeft: 4, width: 22, height: 22, borderRadius: "50%", background: "transparent", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} onMouseEnter={e => { e.currentTarget.style.background = "#F3E4DE"; e.currentTarget.style.color = "#DC2626"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C8BCA0"; }}>×</button>
                </div>
                {/* item rows（收合時隱藏） */}
                {!isCollapsed && group.rows.map(({ item }) => {
                  const rowKey = `${catId}||${item.id}`;
                  const isDragOver = dragOverId === rowKey;
                  const stColor = STATUS_MAP[item.status]?.color || "#6F6656";
                  const tinted = !!item.status && item.status !== "pending"; // 由「狀態」決定整行顏色（待開工=白底）
                  return (
                    <div key={item.id}
                      onDragOver={e => { e.preventDefault(); setDragOverId(rowKey); }}
                      onDrop={() => onRowDrop(rowKey)}
                      style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #EFE7D6", background: isDragOver ? "#F3E4DE" : tinted ? stColor + "1A" : "#ffffff", borderLeft: tinted ? `3px solid ${stColor}` : "3px solid transparent", transition: "background 0.15s" }}
                    >
                      {/* drag handle（僅此處可拖曳） */}
                      <div
                        draggable
                        onDragStart={() => onRowDragStart(rowKey)}
                        onDragEnd={() => { setDragRowId(null); setDragOverId(null); }}
                        style={{ width: 24, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", color: "#d1d5db", fontSize: 14, borderRight: "1px solid #EFE7D6", height: 38 }}>⠿</div>

                      {orderedCols.map(col => {
                        const cs = { ...cellStyle(col) };
                        if (col.builtin === false) {
                          if (col.type === "formula") { const v = buildCtx(item)[col.id]; return <div key={col.id} style={{ ...cs, fontFamily:"monospace", fontSize:12, color:"#6F6656" }}>{typeof v === "number" ? fmt(v) : (v || "—")}</div>; }
                          return <div key={col.id} style={cs}><CustomInput value={item.cust?.[col.id]} type={col.type} onCommit={(val)=>updateCustom(catId, item.id, col.id, val)} /></div>;
                        }
                        if (col.id === "cat") return <div key={col.id} style={{ ...cs, fontSize: 11, color: "#A99F88" }}>{group.name}</div>;
                        if (col.id === "name") return <div key={col.id} style={{ ...cs, color: "#211C15", fontWeight: 500, gap: 6 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateItem(catId, item.id, "inSeq", !item.inSeq); }} title={item.inSeq ? "已排入工序（點擊取消同步）" : "排入工序（同步成工序子項目）"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: item.inSeq ? "none" : `1px solid ${BORDER}`, background: item.inSeq ? ACCENT : "transparent", color: item.inSeq ? "#fff" : SUB, fontSize: 10, fontWeight: 600, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>序</button>
                          <EditableCell catId={catId} itemId={item.id} field="name" value={item.name} />
                        </div>;
                        if (col.id === "done") return (
                          <div key={col.id} style={{ ...cs, justifyContent: "center" }}>
                            <input type="checkbox" checked={!!item.done} onChange={e => updateItem(catId, item.id, "done", e.target.checked)}
                              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3C8C3C" }} />
                          </div>
                        );
                        if (col.id === "status") return (
                          <div key={col.id} style={cs}>
                            <select value={item.status} onChange={e => updateItem(catId, item.id, "status", e.target.value)}
                              style={{ border: "none", background: "transparent", fontSize: 12, cursor: "pointer", color: STATUS_MAP[item.status]?.color || "#6F6656", fontFamily: "'Noto Sans TC', sans-serif", width: "100%", outline: "none" }}>
                              {Object.entries(STATUS_MAP).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </div>
                        );
                        if (col.id === "assignee") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="assignee" value={item.assignee} placeholder="指派..." /></div>;
                        if (col.id === "date") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="date" value={item.date} type="date" placeholder="選擇日期" /></div>;
                        if (col.id === "estQty") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="estQty" value={item.estQty ?? item.qty ?? 0} type="number" /></div>;
                        if (col.id === "unit") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="unit" value={item.unit} /></div>;
                        if (col.id === "estUnitPrice") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="estUnitPrice" value={item.estUnitPrice ?? item.unitPrice ?? 0} type="number" /></div>;
                        if (col.id === "taxType") return (
                          <div key={col.id} style={cs}>
                            <select value={item.taxType || "未稅"} onChange={e => updateItem(catId, item.id, "taxType", e.target.value)}
                              style={{ border: "none", background: "transparent", fontSize: 12, cursor: "pointer", color: "#4A4234", fontFamily: "'Noto Sans TC', sans-serif", width: "100%", outline: "none" }}>
                              {["未稅","含稅","免稅"].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        );
                        if (col.id === "taxAmount") return <div key={col.id} style={{ ...cs, color: "#A99F88", fontFamily: "monospace", fontSize: 12 }}>{fmt(taxOf(item))}</div>;
                        if (col.id === "estTotal") return <div key={col.id} style={{ ...cs, color: ACCENT, fontFamily: "monospace", fontWeight: 600 }} title="預估金額（含稅，自動計算）">{fmt(estAmount(item))}</div>;
                        if (col.id === "paid") {
                          const estA = estAmount(item), p = paidOf(item), full = estA > 0 && p >= estA;
                          return <div key={col.id} style={{ ...cs, gap: 6 }}>
                            <input type="checkbox" checked={full} title={full ? "已全額付清（點擊清除）" : "一鍵填入全額"} onChange={() => updateItem(catId, item.id, "paid", full ? 0 : estA)} style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "#3C8C3C" }} />
                            <div style={{ flex: 1, minWidth: 0, color: p > 0 ? "#3C8C3C" : "#CDC3AC" }}><EditableCell catId={catId} itemId={item.id} field="paid" value={item.paid ?? item.cust?.paid ?? 0} type="number" /></div>
                          </div>;
                        }
                        if (col.id === "unpaid") { const u = unpaidOf(item); return <div key={col.id} style={{ ...cs, color: u < 0 ? "#DC2626" : u > 0 ? "#C2872E" : "#3C8C3C", fontFamily: "monospace", fontWeight: 600 }} title={u < 0 ? "溢付（已付超過預估）" : "未付金額（自動）"}>{u < 0 ? `溢付 ${fmt(-u)}` : fmt(u)}</div>; }
                        if (col.id === "payDate") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="payDate" value={item.payDate} type="date" placeholder="付款日" /></div>;
                        if (col.id === "payAccount") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="payAccount" value={item.payAccount} placeholder="銀行/帳號" /></div>;
                        if (col.id === "receipts") {
                          const recs = item.receipts || [];
                          return (
                            <div key={col.id} style={{ ...cs, gap: 3, flexWrap: "wrap", overflow: "visible" }}>
                              {recs.map((r, ri) => {
                                // 新格式：上傳的照片/檔案（有 url）
                                if (r.url) return (
                                  <div key={ri} style={{ position: "relative", width: 28, height: 28, flexShrink: 0 }}
                                    onMouseEnter={e => { const b = e.currentTarget.querySelector("button"); if (b) b.style.display = "flex"; }}
                                    onMouseLeave={e => { const b = e.currentTarget.querySelector("button"); if (b) b.style.display = "none"; }}>
                                    {r.isImage !== false
                                      ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 4, border: "1px solid #D8CFBB", cursor: "zoom-in" }} />
                                      : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 28, height: 28, borderRadius: 4, border: "1px solid #D8CFBB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, textDecoration: "none", background: "#F3E4DE" }}>📄</a>}
                                    <button onClick={() => removeReceipt(catId, item, r.id, ri)} title="刪除" style={{ display: "none", position: "absolute", top: -6, right: -6, width: 15, height: 15, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer", alignItems: "center", justifyContent: "center", padding: 0 }}>×</button>
                                  </div>
                                );
                                // 舊格式：純文字名稱＋金額（點一下可刪除）
                                return <span key={ri} title={r.amount ? `${r.name}　$${r.amount}（點擊刪除）` : `${r.name}（點擊刪除）`} onClick={() => removeReceipt(catId, item, r.id, ri)} style={{ fontSize: 10, background: "#F3E4DE", color: "#92400e", borderRadius: 10, padding: "1px 6px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>📎 {r.name}</span>;
                              })}
                              <label title="上傳發票／憑證照片" style={{ fontSize: 12, background: "none", border: "1px dashed #D8CFBB", borderRadius: 4, padding: rcpBusy === item.id ? "0 6px" : "1px 6px", cursor: "pointer", color: "#A99F88", flexShrink: 0, display: "flex", alignItems: "center", height: 26 }}>
                                {rcpBusy === item.id ? "…" : "＋"}
                                <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { addReceipts(catId, item, e.target.files); e.target.value = ""; }} />
                              </label>
                            </div>
                          );
                        }
                        if (col.id === "notes") return <div key={col.id} style={cs}><EditableCell catId={catId} itemId={item.id} field="notes" value={item.notes} placeholder="備註..." /></div>;
                        return <div key={col.id} style={cs} />;
                      })}

                      {/* delete */}
                      <div style={{ width: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <button onClick={() => deleteItem(catId, item.id, item.name)}
                          style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "color 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.color="#DC2626"}
                          onMouseLeave={e => e.currentTarget.style.color="#d1d5db"}
                        >×</button>
                      </div>
                    </div>
                  );
                })}
                {/* add row in this group（收合時隱藏） */}
                {!isCollapsed && (
                <div onClick={() => {
                  const newItem = { id: `i-${catId}-${Date.now()}`, name: "新細項", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [], done: false };
                  setCats(prev => prev.map(c => c.id === catId ? { ...c, items: [...c.items, newItem] } : c));
                }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 32px", color: "#A99F88", fontSize: 12, cursor: "pointer", borderBottom: "1px solid #EFE7D6", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background="#ECE6D7"}
                  onMouseLeave={e => e.currentTarget.style.background="transparent"}
                >
                  <span style={{ fontSize: 16, color: ACCENT }}>+</span> 新增細項至「{group.name}」
                </div>
                )}
                {/* 新增工程大項（最後一組之後不顯示在這） */}
              </div>
            );
          })}
          {/* 新增工程大項 */}
          <div onClick={() => {
            const id = "cat-" + Date.now();
            setCats(prev => [...prev, { id, order: prev.length, name: "新工程大項", budget: 0, status: "pending", items: [] }]);
          }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", color: ACCENT, fontSize: 13, fontWeight: 500, cursor: "pointer", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}
            onMouseEnter={e => e.currentTarget.style.background="#F4EFE3"}
            onMouseLeave={e => e.currentTarget.style.background=SURFACE}
          >
            <span style={{ fontSize: 16 }}>＋</span> 新增工程大項
          </div>
          {/* 總計列：數字欄位自動加總 */}
          <div style={{ display: "flex", borderTop: `2px solid ${BORDER}`, background: "#ECE6D7", position: "sticky", bottom: 0, zIndex: 5, fontWeight: 600 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: "1px solid #D8CFBB" }} />
            {(() => { const anyDisc = cats.some(c => catDiscount(c).hasDiscount); const afterTotal = cats.reduce((s, c) => s + catEstAfter(c), 0); return
            orderedCols.map(col => {
              const cs = { ...cellStyle(col) };
              if (col.id === "name") return <div key={col.id} style={{ ...cs, fontWeight: 600, color: "#211C15" }}>總計（{rows.length} 筆）{anyDisc && <span style={{ fontWeight: 400, color: SUB, fontSize: 11 }}>　原報價，議價後見各大項</span>}</div>;
              if (col.id === "estTotal" && anyDisc) {
                const sum = rows.reduce((s, r) => s + numVal(col, r.item), 0);
                return <div key={col.id} style={{ ...cs, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0, lineHeight: 1.2 }} title="上：原報價總計　下：議價後總計"><span style={{ fontFamily: "monospace", color: "#A99F88", textDecoration: "line-through", fontSize: 11 }}>{fmt(sum)}</span><span style={{ fontFamily: "monospace", color: ACCENT, fontWeight: 700 }}>{fmt(afterTotal)}</span></div>;
              }
              if (summable(col)) {
                const sum = rows.reduce((s, r) => s + numVal(col, r.item), 0);
                return <div key={col.id} style={{ ...cs, fontFamily: "monospace", color: isMoneyCol(col) ? ACCENT : "#4A4234" }}>{isMoneyCol(col) ? fmt(sum) : (Math.round(sum * 100) / 100)}</div>;
              }
              return <div key={col.id} style={cs} />;
            }); })()}
            <div style={{ width: 32, flexShrink: 0 }} />
          </div>
        </div>
      </div>
      )}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}


// ── SIMPLE LOGIN ─────────────────────────────────────────────────────────────
function LoginModal({ onLogin, knownUsers, onClose }) {
  const [name, setName] = useState("");
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#ffffff", borderRadius:16, padding:28, maxWidth:380, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize:22, fontWeight: 600, color:"#211C15", marginBottom:6 }}>登入以編輯</div>
        <div style={{ fontSize:13, color:"#6F6656", marginBottom:20 }}>未登入只能檢視。登入後預設仍是唯讀，編輯權限由管理員逐頁開放。</div>
        {knownUsers.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#A99F88", marginBottom:8 }}>最近登入過的成員</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {knownUsers.map(u => (
                <button key={u} onClick={() => onLogin(u)}
                  style={{ padding:"6px 14px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:20, fontSize:13, cursor:"pointer", color:"#4A4234", fontWeight:600 }}>
                  {u}
                </button>
              ))}
            </div>
          </div>
        )}
        <input
          value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.nativeEvent.isComposing&&name.trim()&&onLogin(name.trim())}
          placeholder="輸入你的名字…"
          autoFocus
          style={{ width:"100%", padding:"11px 14px", border:"2px solid #D8CFBB", borderRadius:10, fontSize:15, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", marginBottom:14 }}
        />
        <button onClick={() => name.trim() && onLogin(name.trim())}
          disabled={!name.trim()}
          style={{ width:"100%", padding:"12px 0", background:name.trim()?"#211C15":"#D8CFBB", border:"none", borderRadius:10, color:name.trim()?"#ffffff":"#A99F88", fontSize:15, fontWeight: 600, cursor:name.trim()?"pointer":"not-allowed" }}>
          進入
        </button>
        {onClose && (
          <button onClick={onClose}
            style={{ width:"100%", padding:"10px 0", marginTop:10, background:"transparent", border:"none", color:"#6F6656", fontSize:13, cursor:"pointer" }}>
            以訪客身分瀏覽（唯讀）
          </button>
        )}
      </div>
    </div>
  );
}

// ── OWNER DASHBOARD ───────────────────────────────────────────────────────────
function OwnerDashboard({ cats, setCats, settings, stalledItems, activityLog, logActivity, userName, journal, events, plans }) {
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState("");
  const [showReport, setShowReport] = useState(false);

  const totalItems = cats.reduce((s,c)=>s+c.items.length, 0);
  const doneItems = cats.flatMap(c=>c.items).filter(i=>i.done||i.status==="done").length;
  const inProgressItems = cats.flatMap(c=>c.items).filter(i=>i.status==="inprogress");
  const issueItems = cats.flatMap(c=>c.items).filter(i=>i.status==="issue");
  const pct = totalItems ? Math.round(doneItems/totalItems*100) : 0;
  const totalEst = cats.reduce((s,c)=>s+catEstAfter(c),0); // 議價後含稅總額
  const totalAct = cats.reduce((s,c)=>s+c.items.reduce((ss,it)=>ss+paidOf(it),0),0); // 已付總額
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;
  const today = new Date().toLocaleDateString("zh-TW");

  // 狀態項目數
  const allItems = cats.flatMap(c=>c.items);
  const cnt = (s)=>allItems.filter(i=>i.status===s).length;
  const holdItems = allItems.filter(i=>i.status==="hold");
  // 進度 vs 時程（開工日→完工日，時間已過 % 對比完成 %）
  const ps = settings?.projectStart, td = settings?.targetDate;
  let timePct = null, behind = 0;
  if (ps && td) {
    const total = new Date(td) - new Date(ps), elapsed = new Date() - new Date(ps);
    if (total > 0) { timePct = Math.max(0, Math.min(100, Math.round(elapsed/total*100))); behind = timePct - pct; }
  }
  const budgetPct = totalEst>0 ? Math.round(totalAct/totalEst*100) : 0;
  const overBudget = totalAct > totalEst && totalEst>0;
  // 整體健康燈號
  const health = (issueItems.length>0 || behind>=15) ? "red" : (stalledItems.length>0 || holdItems.length>0 || behind>=5) ? "amber" : "green";
  const hh = { green:{c:"#3C8C3C",bg:"#F0FDF4",dot:"🟢",txt:"進度正常"}, amber:{c:"#C2872E",bg:"#FFFBEB",dot:"🟡",txt:"需要注意"}, red:{c:"#C0392B",bg:"#FEF2F2",dot:"🔴",txt:"需立即處理"} }[health];

  const todayActivity = activityLog.filter(a => {
    const d = new Date(a.ts).toLocaleDateString("zh-TW");
    return d === today;
  });

  const generateReport = async () => {
    setReportLoading(true);
    setShowReport(true);
    const system = buildAdvisorSystem(settings, cats, journal||[], events||[], plans||[]);
    const prompt = "請為業主產生一份本週工程進度報告。格式要求：\n1. 開頭用一句話總結本週整體狀況\n2. 各工程大項進度（用百分比和狀態說明）\n3. 本週完成的重要事項（條列）\n4. 目前需要業主知道的問題或決策點\n5. 下週預計完成的工作\n6. 結尾給一個整體評估（樂觀/正常/需注意）\n\n請用業主能理解的語言，避免太多技術術語，語氣專業但親切。";
    try {
      const reply = await callAI([{role:"user",content:prompt}], system);
      setReport(reply);
    } catch(e) { setReport("⚠️ 生成失敗：" + e.message); }
    setReportLoading(false);
  };

  const ProgressRing = ({ pct, size=80, stroke=8, color="#3C8C3C" }) => {
    const r = (size-stroke)/2;
    const circ = 2*Math.PI*r;
    const offset = circ - (pct/100)*circ;
    return (
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#EFE7D6" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.8s ease" }} />
      </svg>
    );
  };

  const card = { background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:16, padding:18 };
  const kLabel = { fontSize:12, color:"#6F6656", fontWeight:600 };
  const Stat = ({ n, label, color }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span style={{ fontSize:12.5, color:"#4A4234" }}>{label}</span>
      <span style={{ fontSize:14, fontWeight:700, color:n>0?color:"#C9BFA8" }}>{n}</span>
    </div>
  );

  return (
    <div style={{ paddingTop:16, maxWidth:1040, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:22, fontWeight: 600, color:"#211C15" }}>{settings?.projectName || "工程進度"}</div>
          <div style={{ fontSize:13, color:"#6F6656", marginTop:2 }}>{settings?.projectAddress}{settings?.contractorName ? ` · ${settings.contractorName}` : ""} · 今日 {today}</div>
        </div>
        <button onClick={generateReport} style={{ padding:"10px 20px", background:"#211C15", border:"none", borderRadius:10, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          📄 產生業主週報
        </button>
      </div>

      {/* 健康燈號橫幅 */}
      <div style={{ display:"flex", alignItems:"center", gap:12, background:hh.bg, border:`1px solid ${hh.c}33`, borderRadius:14, padding:"12px 18px", marginBottom:16, flexWrap:"wrap" }}>
        <span style={{ fontSize:20 }}>{hh.dot}</span>
        <div style={{ fontSize:15, fontWeight:700, color:hh.c }}>{hh.txt}</div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:14, fontSize:12.5, color:"#6F6656", flexWrap:"wrap" }}>
          {issueItems.length>0 && <span style={{ color:"#C0392B", fontWeight:600 }}>🚨 問題 {issueItems.length}</span>}
          {stalledItems.length>0 && <span style={{ color:"#C2872E", fontWeight:600 }}>⏰ 卡關 {stalledItems.length}</span>}
          {timePct!=null && behind>=5 && <span style={{ color:"#C0392B", fontWeight:600 }}>📉 落後時程 {behind}%</span>}
          {health==="green" && <span>各項進度皆在掌握中</span>}
        </div>
      </div>

      {/* Main KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:14, marginBottom:20 }}>
        {/* 完成度 */}
        <div style={card}>
          <div style={kLabel}>整體完成度</div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:8 }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <ProgressRing pct={pct} size={70} color={pct>75?"#3C8C3C":pct>40?"#C2872E":"#C0392B"} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:700, color:"#211C15" }}>{pct}%</div>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:"#211C15" }}>{doneItems}<span style={{ fontSize:13, color:"#A99F88", fontWeight:400 }}> / {totalItems} 項</span></div>
              <div style={{ fontSize:12, color:"#3E72A8", marginTop:3, fontWeight:600 }}>進行中 {inProgressItems.length} 項</div>
            </div>
          </div>
        </div>

        {/* 時程 */}
        <div style={card}>
          <div style={kLabel}>距完工</div>
          {daysLeft !== null ? (
            <>
              <div style={{ fontSize:26, fontWeight:700, color:daysLeft<14?"#C0392B":daysLeft<30?"#C2872E":"#211C15", marginTop:4 }}>{daysLeft}<span style={{ fontSize:13, fontWeight:400, color:"#A99F88" }}> 天</span></div>
              {timePct!=null ? (
                <div style={{ marginTop:8 }}>
                  <div style={{ fontSize:11, color:"#6F6656", marginBottom:4 }}>時程已過 {timePct}%・完成 {pct}%</div>
                  <div style={{ position:"relative", background:"#EFE7D6", borderRadius:20, height:7 }}>
                    <div style={{ position:"absolute", left:0, top:0, bottom:0, width:pct+"%", background:behind>=10?"#C0392B":"#3C8C3C", borderRadius:20, transition:"width .8s" }} />
                    <div style={{ position:"absolute", left:`calc(${timePct}% - 1px)`, top:-2, bottom:-2, width:2, background:"#211C15" }} title="今日時程基準" />
                  </div>
                  <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color: behind>=10?"#C0392B":behind>=5?"#C2872E":"#3C8C3C" }}>{behind>=5?`進度落後 ${behind}%`:behind<=-5?`進度超前 ${-behind}%`:"進度符合時程"}</div>
                </div>
              ) : <div style={{ fontSize:12, color:"#A99F88", marginTop:8 }}>完工日 {td}</div>}
            </>
          ) : <div style={{ fontSize:13, color:"#A99F88", marginTop:12 }}>尚未設定完工日</div>}
        </div>

        {/* 預算 */}
        <div style={card}>
          <div style={kLabel}>付款進度（已付／預估）</div>
          <div style={{ fontSize:19, fontWeight:700, color:overBudget?"#C0392B":"#3C8C3C", marginTop:4, fontFamily:"ui-monospace, monospace" }}>{totalAct>0?fmt(totalAct):"—"}</div>
          <div style={{ fontSize:11.5, color:"#6F6656", marginTop:2 }}>預估 <span style={{ fontFamily:"ui-monospace, monospace" }}>{fmt(totalEst)}</span>・未付 <span style={{ fontFamily:"ui-monospace, monospace", color:"#C2872E" }}>{fmt(totalEst-totalAct)}</span></div>
          <div style={{ background:"#EFE7D6", borderRadius:20, height:7, overflow:"hidden", marginTop:9 }}>
            <div style={{ background:overBudget?"#C0392B":"#3C8C3C", height:"100%", width:Math.min(100,budgetPct)+"%", borderRadius:20, transition:"width .8s" }} />
          </div>
          <div style={{ fontSize:11.5, fontWeight:700, marginTop:5, color:overBudget?"#C0392B":"#6F6656" }}>{totalAct>0?`已付 ${budgetPct}%${overBudget?"（溢付）":""}`:"尚未付款"}</div>
        </div>

        {/* 狀態總覽 */}
        <div style={card}>
          <div style={kLabel}>狀態總覽</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7, marginTop:9 }}>
            <Stat n={issueItems.length} label="🚨 有問題" color="#C0392B" />
            <Stat n={stalledItems.length} label="⏰ 卡關 >3天" color="#C2872E" />
            <Stat n={holdItems.length} label="⏸ 暫停" color="#C2872E" />
            <Stat n={cnt("pending")} label="○ 待開工" color="#6F6656" />
          </div>
        </div>
      </div>

      {/* Category progress bars */}
      <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:16, padding:20, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:14, fontWeight: 600, color:"#211C15" }}>各工程進度</div>
          <div style={{ fontSize:12, color:"#6F6656" }}>{cats.length} 大項 · 完工 {cats.filter(c=>c.status==="done").length} · 進行中 {cats.filter(c=>c.status==="inprogress").length} · 待開工 {cats.filter(c=>c.status==="pending").length}</div>
        </div>
        {[...cats].sort((a,b)=>{
          const rank = s => s==="issue"?0 : s==="inprogress"?1 : s==="hold"?2 : s==="done"?4 : 3;
          const r = rank(a.status)-rank(b.status); return r!==0 ? r : (a.order-b.order);
        }).map(cat => {
          const total = cat.items.length;
          const done = cat.items.filter(i=>i.done||i.status==="done").length;
          const pct = total ? Math.round(done/total*100) : 0;
          const hasIssue = cat.items.some(i=>i.status==="issue");
          const hasStall = cat.items.some(i=>stalledItems.find(s=>s.id===i.id));
          const st = STATUS_MAP[cat.status]||STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:4, background:st.color, flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight:600, color:"#4A4234" }}>{cat.name}</span>
                  {hasIssue && <span style={{ fontSize:10, background:"#F3E4DE", color:"#dc2626", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>問題</span>}
                  {hasStall && <span style={{ fontSize:10, background:"#fffbeb", color:"#d97706", borderRadius:10, padding:"1px 7px", fontWeight: 600 }}>卡關</span>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:11, color:"#A99F88" }}>{done}/{total}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#211C15", minWidth:34, textAlign:"right" }}>{pct}%</span>
                  <span style={{ fontSize:11, color:st.color, background:st.color+"18", borderRadius:20, padding:"1px 8px", fontWeight: 600 }}>{st.label}</span>
                </div>
              </div>
              <div style={{ background:"#EFE7D6", borderRadius:20, height:8, overflow:"hidden" }}>
                <div style={{ background:pct===100?"#3C8C3C":hasIssue?"#C0392B":"#3E72A8", height:"100%", width:pct+"%", borderRadius:20, transition:"width 0.8s" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Today's activity */}
      <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:16, padding:20, marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight: 600, color:"#211C15", marginBottom:12 }}>今日動態 {todayActivity.length>0&&<span style={{ fontSize:12, color:"#6F6656", fontWeight:400 }}>（{todayActivity.length} 筆）</span>}</div>
        {todayActivity.length === 0 ? (
          <div style={{ fontSize:13, color:"#A99F88", textAlign:"center", padding:"20px 0" }}>今日尚無更新記錄</div>
        ) : (
          <div style={{ maxHeight:200, overflowY:"auto" }}>
            {todayActivity.slice(0,20).map((a,i) => (
              <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", paddingBottom:10, marginBottom:10, borderBottom:i<todayActivity.length-1?"1px solid #EFE7D6":"none" }}>
                <div style={{ fontSize:11, color:"#A99F88", whiteSpace:"nowrap", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
                <div style={{ fontSize:12, color:"#4A4234" }}><span style={{ fontWeight:600, color:"#211C15" }}>{a.user}</span> {a.action}：{a.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stalled items detail */}
      {stalledItems.length > 0 && (
        <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:16, padding:20, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight: 600, color:"#92400e", marginBottom:12 }}>⏰ 卡關項目（超過3天未更新）</div>
          {stalledItems.map(item => {
            const cat = cats.find(c=>c.items.find(i=>i.id===item.id));
            const days = item.lastUpdated ? Math.floor((Date.now()-new Date(item.lastUpdated))/(1000*60*60*24)) : null;
            return (
              <div key={item.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #fde68a" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#92400e" }}>{item.name}</div>
                  <div style={{ fontSize:11, color:"#b45309" }}>{cat?.name} · {item.assignee||"未指派"}</div>
                </div>
                {days && <div style={{ fontSize:12, color:"#dc2626", fontWeight: 600 }}>卡關 {days} 天</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Weekly Report Modal */}
      {showReport && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowReport(false)}>
          <div style={{ background:"#ffffff", borderRadius:16, padding:24, maxWidth:620, width:"100%", maxHeight:"80vh", overflow:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontSize:16, fontWeight: 600, color:"#211C15" }}>📄 業主週報</div>
              <button onClick={()=>setShowReport(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#6F6656" }}>×</button>
            </div>
            {reportLoading ? (
              <div style={{ textAlign:"center", padding:"40px", color:ACCENT }}>🤖 AI 生成中…</div>
            ) : (
              <div style={{ fontSize:13, lineHeight:1.9, color:"#4A4234", whiteSpace:"pre-wrap", background:"#f9fafb", borderRadius:10, padding:"16px 18px" }}>{report}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ACTIVITY LOG PANEL ────────────────────────────────────────────────────────
function ActivityLogPanel({ activityLog, onClose }) {
  const today = new Date().toLocaleDateString("zh-TW");
  const grouped = {};
  activityLog.forEach(a => {
    const d = new Date(a.ts).toLocaleDateString("zh-TW");
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(a);
  });
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:400, display:"flex", justifyContent:"flex-end" }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ width:"min(420px,100vw)", background:"#ffffff", height:"100vh", overflowY:"auto", borderLeft:"1px solid #D8CFBB" }}>
        <div style={{ padding:"14px 16px", borderBottom:"1px solid #D8CFBB", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, background:"#ffffff" }}>
          <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>活動記錄</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#6F6656" }}>×</button>
        </div>
        <div style={{ padding:16 }}>
          {Object.keys(grouped).length === 0 && <div style={{ textAlign:"center", color:"#A99F88", padding:"40px 0" }}>尚無記錄</div>}
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date} style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, color:"#6F6656", fontWeight: 600, marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ height:1, flex:1, background:"#D8CFBB" }} />
                {date === today ? "今天" : date}
                <div style={{ height:1, flex:1, background:"#D8CFBB" }} />
              </div>
              {entries.map((a, i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:10, alignItems:"flex-start" }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"#EFE7D6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>
                    {"👤"}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, color:"#211C15" }}><span style={{ fontWeight: 600 }}>{a.user}</span> {a.action}</div>
                    <div style={{ fontSize:11, color:"#6F6656" }}>{a.detail}</div>
                    <div style={{ fontSize:10, color:"#A99F88", marginTop:2 }}>{new Date(a.ts).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── CALENDAR VIEW ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function CalendarView({ cats, setCats, settings, events, setEvents, userName }) {
  const [cursor, setCursor] = useState(new Date()); // month being viewed
  const [selectedDate, setSelectedDate] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const days = [];
  for (let i = 0; i < firstWeekday; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));

  const todayStr = new Date().toISOString().slice(0,10);
  const targetStr = settings?.targetDate || "";

  // Gather events per day
  const eventsForDay = (d) => {
    if (!d) return [];
    const ds = d.toISOString().slice(0,10);
    return events.filter(e => e.date === ds);
  };

  // Cat milestones: target date
  const milestonesForDay = (d) => {
    if (!d) return [];
    const ds = d.toISOString().slice(0,10);
    const results = [];
    if (ds === targetStr) results.push({ type:"target", label:"🎯 目標完工日", color:"#dc2626" });
    return results;
  };

  const WEEK = ["日","一","二","三","四","五","六"];

  const addEvent = (dateStr) => {
    setEditingEvent({ id: "evt-"+Date.now(), date: dateStr, title: "", catId: "", note: "", createdBy: userName });
    setShowEventModal(true);
  };

  const saveEvent = (evt) => {
    setEvents(prev => {
      const exists = prev.find(e => e.id === evt.id);
      if (exists) return prev.map(e => e.id === evt.id ? evt : e);
      return [...prev, evt];
    });
    setShowEventModal(false); setEditingEvent(null);
  };

  const deleteEvent = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    setShowEventModal(false); setEditingEvent(null);
  };

  return (
    <div style={{ paddingTop:16, maxWidth:1000, margin:"0 auto" }}>
      {/* header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>📅 行事曆</div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setCursor(new Date(year, month-1, 1))} style={{ padding:"6px 10px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, cursor:"pointer", fontSize:13 }}>←</button>
        <div style={{ fontSize:15, fontWeight: 600, color:"#211C15", minWidth:120, textAlign:"center" }}>{year}年 {month+1}月</div>
        <button onClick={()=>setCursor(new Date(year, month+1, 1))} style={{ padding:"6px 10px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, cursor:"pointer", fontSize:13 }}>→</button>
        <button onClick={()=>setCursor(new Date())} style={{ padding:"6px 14px", background:ACCENT, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, color:"#211C15", fontWeight: 600 }}>今天</button>
      </div>

      {/* weekday headers */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, marginBottom:4 }}>
        {WEEK.map((w,i) => (
          <div key={w} style={{ padding:"6px 0", textAlign:"center", fontSize:11, fontWeight: 600, color: i===0||i===6?"#dc2626":"#6F6656" }}>{w}</div>
        ))}
      </div>

      {/* days grid */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
        {days.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight:96, background:"transparent" }} />;
          const ds = d.toISOString().slice(0,10);
          const isToday = ds === todayStr;
          const isWeekend = d.getDay()===0 || d.getDay()===6;
          const evs = eventsForDay(d);
          const miles = milestonesForDay(d);
          return (
            <div key={i} onClick={()=>addEvent(ds)}
              style={{ minHeight:96, background:"#ffffff", border:`1px solid ${isToday?ACCENT:"#D8CFBB"}`, borderWidth:isToday?2:1, borderRadius:8, padding:6, cursor:"pointer", transition:"background 0.15s", display:"flex", flexDirection:"column", gap:3 }}
              onMouseEnter={e=>e.currentTarget.style.background="#FCFAF4"}
              onMouseLeave={e=>e.currentTarget.style.background="#ffffff"}
            >
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:13, fontWeight:isToday?900:600, color: isToday?ACCENT:isWeekend?"#dc2626":"#4A4234" }}>{d.getDate()}</div>
                {evs.length>0 && <div style={{ fontSize:10, background:"#F3E4DE", color:"#92400e", borderRadius:10, padding:"0 6px", fontWeight: 600 }}>{evs.length}</div>}
              </div>
              {miles.map((m,mi) => (
                <div key={mi} style={{ fontSize:10, background:m.color+"20", color:m.color, borderRadius:4, padding:"1px 4px", fontWeight: 600 }}>{m.label}</div>
              ))}
              {evs.slice(0,3).map((e,ei) => (
                <div key={ei} onClick={ev=>{ev.stopPropagation(); setEditingEvent(e); setShowEventModal(true);}}
                  style={{ fontSize:10, background:"#eff6ff", color:"#1e40af", borderRadius:4, padding:"1px 5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", border:"1px solid #bfdbfe" }}>
                  {e.title || "(未命名)"}
                </div>
              ))}
              {evs.length>3 && <div style={{ fontSize:9, color:"#A99F88" }}>+{evs.length-3} 更多</div>}
            </div>
          );
        })}
      </div>

      {/* legend */}
      <div style={{ marginTop:12, display:"flex", gap:14, fontSize:11, color:"#6F6656" }}>
        <div><span style={{ display:"inline-block", width:10, height:10, background:ACCENT, borderRadius:2, marginRight:4, verticalAlign:"middle" }} />今天</div>
        <div>🎯 目標完工日</div>
        <div>點擊日期可新增事件，點擊事件可編輯</div>
      </div>

      {/* event modal */}
      {showEventModal && editingEvent && (
        <EventEditModal event={editingEvent} setEvent={setEditingEvent} cats={cats} onSave={saveEvent} onDelete={deleteEvent} onClose={()=>{setShowEventModal(false); setEditingEvent(null);}} />
      )}
    </div>
  );
}

function EventEditModal({ event, setEvent, cats, onSave, onDelete, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:420, width:"100%", boxShadow:"0 10px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📅 {event.title?"編輯":"新增"}事件</div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
            <input type="date" value={event.date||""} onChange={e=>setEvent({...event, date:e.target.value})}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>事件標題 *</div>
            <input value={event.title||""} onChange={e=>setEvent({...event, title:e.target.value})}
              placeholder="例如：磁磚到貨、業主驗收、停工..."
              style={{ width:"100%", padding:"9px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程（選填）</div>
            <select value={event.catId||""} onChange={e=>{
              const cat = cats.find(c=>c.id===e.target.value);
              setEvent({...event, catId:e.target.value, catName:cat?.name||""});
            }}
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
              <option value="">— 未關聯 —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>備註</div>
            <textarea value={event.note||""} onChange={e=>setEvent({...event, note:e.target.value})}
              placeholder="備註..."
              style={{ width:"100%", padding:"8px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
          </div>
        </div>
        <div style={{ display:"flex", gap:8, marginTop:18 }}>
          {event.createdBy && <button onClick={()=>onDelete(event.id)} style={{ padding:"10px 14px", background:"#F3E4DE", border:"1px solid #fca5a5", borderRadius:8, color:"#dc2626", fontSize:13, cursor:"pointer", fontWeight:600 }}>刪除</button>}
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ padding:"10px 16px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
          <button onClick={()=>event.title&&onSave(event)} disabled={!event.title} style={{ padding:"10px 20px", background:event.title?"#211C15":"#D8CFBB", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:event.title?"pointer":"not-allowed" }}>儲存</button>
        </div>
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── JOURNAL VIEW (工作日誌) ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function JournalView({ journal, setJournal, cats, userName }) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title:"", content:"", catId:"", weather:"", date:new Date().toISOString().slice(0,10), workers:"", issues:"" });
  const [filter, setFilter] = useState("");

  const sorted = [...journal].sort((a,b) => (b.date||"").localeCompare(a.date||""));
  const filtered = filter ? sorted.filter(j => (j.title+j.content+j.catName).toLowerCase().includes(filter.toLowerCase())) : sorted;

  const save = () => {
    if (!draft.title && !draft.content) { setShowNew(false); return; }
    const cat = cats.find(c=>c.id===draft.catId);
    const entry = {
      id: "j-" + Date.now(),
      ...draft,
      catName: cat?.name || "",
      author: userName,
      createdAt: new Date().toISOString(),
    };
    setJournal(prev => [entry, ...prev]);
    notifyLineEvent("journal", `📓 ${entry.author || "有人"} 新增日誌：「${entry.title || "(無標題)"}」\n${(entry.content || "").slice(0, 80)}${(entry.content || "").length > 80 ? "..." : ""}`);
    setShowNew(false);
    setDraft({ title:"", content:"", catId:"", weather:"", date:new Date().toISOString().slice(0,10), workers:"", issues:"" });
  };

  const remove = (id) => {
    setJournal(prev => prev.filter(j => j.id !== id));
  };

  return (
    <div style={{ paddingTop:16, maxWidth:880, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>📓 工作日誌</div>
        <div style={{ fontSize:12, color:"#6F6656" }}>共 {journal.length} 筆記錄</div>
        <div style={{ flex:1 }} />
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="搜尋…"
          style={{ padding:"7px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", width:180, fontFamily:"'Noto Sans TC',sans-serif" }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增日誌</button>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#ffffff", border:"1px dashed #D8CFBB", borderRadius:14, padding:"60px 20px", textAlign:"center", color:"#A99F88" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📓</div>
          <div style={{ fontSize:14 }}>尚無日誌記錄，點擊右上「+ 新增日誌」開始記錄</div>
        </div>
      )}

      {filtered.map(j => (
        <div key={j.id} style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:14, padding:18, marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <div style={{ fontSize:15, fontWeight: 600, color:"#211C15" }}>{j.title||"(無標題)"}</div>
                {j.catName && <span style={{ fontSize:10, background:"#F3E4DE", color:"#92400e", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{j.catName}</span>}
              </div>
              <div style={{ fontSize:11, color:"#A99F88", display:"flex", gap:10, flexWrap:"wrap" }}>
                <span>📅 {j.date}</span>
                {j.author && <span>✍️ {j.author}</span>}
                {j.weather && <span>🌤 {j.weather}</span>}
                {j.workers && <span>👷 {j.workers}</span>}
              </div>
            </div>
            <button onClick={()=>remove(j.id)} style={{ background:"none", border:"none", color:"#d1d5db", cursor:"pointer", fontSize:16, padding:0 }}>×</button>
          </div>
          {j.content && <div style={{ fontSize:13, lineHeight:1.8, color:"#4A4234", whiteSpace:"pre-wrap", marginTop:10 }}>{j.content}</div>}
          {j.issues && (
            <div style={{ marginTop:10, padding:"8px 12px", background:"#F3E4DE", border:"1px solid #fca5a5", borderRadius:8, fontSize:12, color:"#991b1b" }}>
              <strong>⚠️ 問題/待處理：</strong> {j.issues}
            </div>
          )}
        </div>
      ))}

      {/* New entry modal */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowNew(false)}>
          <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:520, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>📓 新增工作日誌</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>日期</div>
                <input type="date" value={draft.date} onChange={e=>setDraft({...draft, date:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>天氣</div>
                <input value={draft.weather} onChange={e=>setDraft({...draft, weather:e.target.value})} placeholder="晴 / 雨 / 陰"
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>標題</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder="例如：廚房地坪灌漿完成..."
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} autoFocus />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>現場人員</div>
              <input value={draft.workers} onChange={e=>setDraft({...draft, workers:e.target.value})} placeholder="例如：水電2人、泥作3人"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>內容</div>
              <textarea value={draft.content} onChange={e=>setDraft({...draft, content:e.target.value})}
                placeholder="今日完成什麼？遇到什麼？&#10;可記錄：進度、用料、人員、照片說明、重要決策..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:120, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif", lineHeight:1.7 }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>⚠️ 問題/待處理</div>
              <textarea value={draft.issues} onChange={e=>setDraft({...draft, issues:e.target.value})}
                placeholder="需要上級決策、材料短缺、工序卡關..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:60, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>儲存日誌</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// ── PLAN VIEW (排程規劃) ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function PlanView({ cats, setCats, plans, setPlans, settings, userName }) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title:"", description:"", priority:"中", dueDate:"", catId:"", assignee:"", done:false });
  const [filter, setFilter] = useState("pending"); // pending | all | done

  const priorityOrder = { "高":1, "中":2, "低":3 };
  const sorted = [...plans].sort((a,b) => {
    if (a.done !== b.done) return a.done?1:-1;
    const p = (priorityOrder[a.priority]||2) - (priorityOrder[b.priority]||2);
    if (p !== 0) return p;
    return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
  });
  const filtered = filter === "all" ? sorted : filter === "done" ? sorted.filter(p=>p.done) : sorted.filter(p=>!p.done);

  const save = () => {
    if (!draft.title) { setShowNew(false); return; }
    const cat = cats.find(c=>c.id===draft.catId);
    const entry = {
      id: "plan-" + Date.now(),
      ...draft,
      catName: cat?.name || "",
      createdBy: userName,
      createdAt: new Date().toISOString(),
    };
    setPlans(prev => [...prev, entry]);
    setShowNew(false);
    setDraft({ title:"", description:"", priority:"中", dueDate:"", catId:"", assignee:"", done:false });
  };

  const toggleDone = (id) => {
    setPlans(prev => prev.map(p => p.id === id ? {...p, done:!p.done, doneAt: !p.done ? new Date().toISOString() : null} : p));
  };

  const remove = (id) => {
    setPlans(prev => prev.filter(p => p.id !== id));
  };

  const todayStr = new Date().toISOString().slice(0,10);
  const overdueCount = plans.filter(p => !p.done && p.dueDate && p.dueDate < todayStr).length;
  const highCount = plans.filter(p => !p.done && p.priority === "高").length;

  const priorityColor = { "高":"#dc2626", "中":"#f59e0b", "低":"#6F6656" };

  return (
    <div style={{ paddingTop:16, maxWidth:900, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div style={{ fontSize:20, fontWeight: 600, color:"#211C15" }}>🗓 排程規劃</div>
        <div style={{ fontSize:12, color:"#6F6656" }}>待處理 {plans.filter(p=>!p.done).length} · 已完成 {plans.filter(p=>p.done).length}</div>
        <div style={{ flex:1 }} />
        <button onClick={()=>setShowNew(true)} style={{ padding:"8px 16px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>+ 新增任務</button>
      </div>

      {/* summary */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        {overdueCount>0 && <div style={{ background:"#F3E4DE", border:"1px solid #fca5a5", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#dc2626", fontWeight: 600 }}>⏰ 逾期 {overdueCount} 項</div>}
        {highCount>0 && <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:20, padding:"5px 14px", fontSize:12, color:"#92400e", fontWeight: 600 }}>🔥 高優先 {highCount} 項</div>}
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:4 }}>
          {[["pending","待處理"],["done","已完成"],["all","全部"]].map(([k,l]) => (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:"5px 12px", borderRadius:20, fontSize:12, border:"1px solid #D8CFBB", cursor:"pointer", background:filter===k?ACCENT:"#ECE6D7", color:filter===k?"#ffffff":"#6F6656", fontWeight:filter===k?700:400 }}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div style={{ background:"#ffffff", border:"1px dashed #D8CFBB", borderRadius:14, padding:"50px 20px", textAlign:"center", color:"#A99F88" }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🗓</div>
          <div style={{ fontSize:14 }}>{filter==="done"?"尚無已完成任務":filter==="pending"?"沒有待處理任務，太棒了！":"尚無任務"}</div>
        </div>
      )}

      {filtered.map(p => {
        const isOverdue = !p.done && p.dueDate && p.dueDate < todayStr;
        return (
          <div key={p.id} style={{ background:"#ffffff", border:`1px solid ${isOverdue?"#fca5a5":"#D8CFBB"}`, borderLeft:`4px solid ${p.done?"#3C8C3C":priorityColor[p.priority]||"#6F6656"}`, borderRadius:12, padding:"12px 16px", marginBottom:10, display:"flex", alignItems:"flex-start", gap:12, opacity:p.done?0.6:1 }}>
            <input type="checkbox" checked={!!p.done} onChange={()=>toggleDone(p.id)}
              style={{ width:18, height:18, marginTop:3, cursor:"pointer", accentColor:"#3C8C3C", flexShrink:0 }} />
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
                <div style={{ fontSize:14, fontWeight: 600, color:p.done?"#A99F88":"#211C15", textDecoration:p.done?"line-through":"none" }}>{p.title}</div>
                <span style={{ fontSize:10, background:priorityColor[p.priority]+"22", color:priorityColor[p.priority], borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>{p.priority}</span>
                {p.catName && <span style={{ fontSize:10, background:"#eff6ff", color:"#1e40af", borderRadius:10, padding:"1px 8px" }}>{p.catName}</span>}
                {isOverdue && <span style={{ fontSize:10, background:"#F3E4DE", color:"#dc2626", borderRadius:10, padding:"1px 8px", fontWeight: 600 }}>⏰ 逾期</span>}
              </div>
              {p.description && <div style={{ fontSize:12, color:"#6F6656", lineHeight:1.7, marginBottom:4 }}>{p.description}</div>}
              <div style={{ fontSize:11, color:"#A99F88", display:"flex", gap:12, flexWrap:"wrap" }}>
                {p.dueDate && <span>📅 {p.dueDate}</span>}
                {p.assignee && <span>👤 {p.assignee}</span>}
                {p.createdBy && <span>✍️ {p.createdBy}</span>}
              </div>
            </div>
            <button onClick={()=>remove(p.id)} style={{ background:"none", border:"none", color:"#d1d5db", cursor:"pointer", fontSize:16, padding:0 }}>×</button>
          </div>
        );
      })}

      {/* New task modal */}
      {showNew && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={e=>e.target===e.currentTarget&&setShowNew(false)}>
          <div style={{ background:"#ffffff", borderRadius:14, padding:22, maxWidth:460, width:"100%", maxHeight:"88vh", overflow:"auto" }}>
            <div style={{ fontSize:16, fontWeight: 600, color:"#211C15", marginBottom:14 }}>🗓 新增排程任務</div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>任務標題 *</div>
              <input value={draft.title} onChange={e=>setDraft({...draft, title:e.target.value})} placeholder="例如：下週前確認磁磚廠商..." autoFocus
                style={{ width:"100%", padding:"9px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:14, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>優先度</div>
                <select value={draft.priority} onChange={e=>setDraft({...draft, priority:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                  <option>高</option><option>中</option><option>低</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>截止日</div>
                <input type="date" value={draft.dueDate} onChange={e=>setDraft({...draft, dueDate:e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>關聯工程</div>
              <select value={draft.catId} onChange={e=>setDraft({...draft, catId:e.target.value})}
                style={{ width:"100%", padding:"8px 10px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", background:"#ffffff" }}>
                <option value="">— 未指定 —</option>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>負責人</div>
              <input value={draft.assignee} onChange={e=>setDraft({...draft, assignee:e.target.value})} placeholder="誰要做？"
                style={{ width:"100%", padding:"8px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#6F6656", marginBottom:4, fontWeight:600 }}>描述</div>
              <textarea value={draft.description} onChange={e=>setDraft({...draft, description:e.target.value})}
                placeholder="詳細說明..."
                style={{ width:"100%", padding:"10px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box", height:70, resize:"vertical", fontFamily:"'Noto Sans TC',sans-serif" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <div style={{ flex:1 }} />
              <button onClick={()=>setShowNew(false)} style={{ padding:"10px 16px", background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, color:"#6F6656", fontSize:13, cursor:"pointer" }}>取消</button>
              <button onClick={save} style={{ padding:"10px 22px", background:"#211C15", border:"none", borderRadius:8, color:"#ffffff", fontSize:13, fontWeight: 600, cursor:"pointer" }}>建立任務</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── KANBAN ─────────────────────────────────────────────────────────────────────
function KanbanView({ cats, setCats, onSelect, dragging, dragOver, onDragStart, onDragOver, onDrop, confirm }) {
  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 12 }}>拖曳卡片可調整工序順序</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px,100%),1fr))", gap: 12 }}>
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
              style={{ background: isDragOver ? "#e8edf8" : "#ffffff", border: `1px solid ${isDragOver ? ACCENT : "#D8CFBB"}`, borderRadius: 12, padding: 14, cursor: "grab", transition: "border-color 0.2s, transform 0.15s", transform: dragging === cat.id ? "scale(0.97) rotate(-1deg)" : "none", userSelect: "none", position: "relative" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <input
                  value={cat.name}
                  onChange={e => { e.stopPropagation(); setCats(prev => prev.map(c => c.id === cat.id ? {...c, name: e.target.value} : c)); }}
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 14, fontWeight: 600, color: "#211C15", flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: "'Noto Sans TC', sans-serif", cursor: "text", minWidth: 0 }}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
                  <button onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }} onClick={e => { e.stopPropagation(); e.preventDefault(); confirm(`確定刪除「${cat.name}」？\n此操作無法復原。`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== cat.id)); }); }} style={{ width: 22, height: 22, borderRadius: "50%", background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer", lineHeight: 1, flexShrink: 0, padding: 0 }} title="刪除此工程">×</button>
                </div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 13, color: ACCENT, marginBottom: 8 }}>{fmt(cat.items.reduce((s,it) => s + calcEstimated(it), 0))}</div>
              <div style={{ background: "#e2e4ec", borderRadius: 4, height: 5, marginBottom: 6, overflow: "hidden" }}>
                <div style={{ background: pct === 100 ? "#3C8C3C" : "#3E72A8", width: pct + "%", height: "100%", transition: "width 0.4s" }} />
              </div>
              <div style={{ fontSize: 11, color: "#6F6656" }}>{done}/{cat.items.length} 細項完成 · {pct}%</div>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {Object.entries(STATUS_MAP).map(([k, v]) => {
                  const cnt = cat.items.filter(i => i.status === k).length;
                  if (!cnt) return null;
                  return <span key={k} style={{ fontSize: 10, color: v.color, background: v.color + "18", border: "1px solid " + v.color + "44", borderRadius: 10, padding: "1px 7px" }}>{v.label} {cnt}</span>;
                })}
              </div>
              {cat.items.some(i => i.notes?.includes("⚠️")) && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#C2872E", background: "#fff7ee", borderRadius: 4, padding: "3px 8px" }}>⚠️ 含待確認項目</div>
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
          style={{ background: "#FCFAF4", border: "1px dashed rgba(193,58,34,0.3)", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120, gap: 8, transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="rgba(193,58,34,0.3)"}
        >
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff8e6", border: "1px solid rgba(193,58,34,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: ACCENT }}>+</div>
          <div style={{ fontSize: 13, color: "#6F6656" }}>新增工程大項</div>
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
      <div onClick={(e) => { e.stopPropagation(); setOpen(!open); }} style={{ background: st.color + "22", border: `1px solid ${st.color}55`, color: st.color, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{st.label}</div>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 26, background: "#EFE7D6", border: "1px solid #D8CFBB", borderRadius: 8, zIndex: 200, minWidth: 100, overflow: "hidden" }}>
          {Object.entries(STATUS_MAP).map(([k, v]) => (
            <div key={k} onClick={(e) => { e.stopPropagation(); setCats(prev => prev.map(c => {
              if (catId && c.id === catId) {
                if (itemId) return { ...c, items: c.items.map(it => it.id === itemId ? { ...it, status: k, lastUpdated: new Date().toISOString() } : it) };
                return { ...c, status: k };
              }
              return c;
            })); setOpen(false); }} style={{ padding: "7px 12px", cursor: "pointer", color: v.color, fontSize: 12, borderBottom: "1px solid #D8CFBB44" }}>{v.label}</div>
          ))}
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
      const text = await callAI([{ role: "user", content: "請為業主產生一份精簡的本週工程進度週報（約 300 字內，含：整體狀況一句話、各大項進度、本週重點、待決問題、下週預計、整體評估🟢/🟡/🔴）。用業主能懂的口吻，純文字、適合在 LINE 閱讀。" }], system);
      const r = await sendLineNotify("📋 本週工程進度週報\n\n" + text);
      flash(r && r.ok ? "✅ 週報已推送到 LINE 群組" : `⚠️ 推送失敗：${r?.error || r?.reason || "請確認群組 ID"}`);
    } catch (e) { flash("⚠️ 產生失敗：" + e.message); }
    setWbusy(false);
  };

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D8CFBB", borderRadius: 12, padding: "20px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#211C15", marginBottom: 4 }}>💬 LINE 通知</div>
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 14 }}>設定推播群組與各類事件通知（設定儲存於共用空間，供伺服器排程使用）</div>

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, marginBottom: 6 }}>LINE 群組 ID</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <input value={groupId} onChange={e => upd("lineGroupId", e.target.value)} placeholder="群組 ID" style={{ flex: 1, minWidth: 200, border: "1px solid #D8CFBB", borderRadius: 8, padding: "10px 12px", fontSize: 14, fontFamily: "monospace" }} />
        <button onClick={test} disabled={busy} style={{ border: "none", background: "#06C755", color: "#fff", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>{busy ? "傳送中…" : "測試推送"}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✅") ? "#3C8C3C" : msg.startsWith("⚠️") ? "#C0392B" : "#6F6656", marginBottom: 10 }}>{msg}</div>}

      <div style={{ fontSize: 12.5, color: "#4A4234", fontWeight: 600, margin: "14px 0 6px" }}>通知開關</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {LINE_EVENTS.map(([k, label]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", cursor: "pointer", fontSize: 13.5, color: "#211C15", borderBottom: "1px solid #F4EFE3" }}>
            <input type="checkbox" checked={!!notify[k]} onChange={() => toggle(k)} style={{ width: 18, height: 18, accentColor: ACCENT, flexShrink: 0 }} />
            {label}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#A99F88", marginTop: 8, lineHeight: 1.6 }}>※「有問題 / 完工 / 新日誌」由系統即時推播；「卡關 / 週五週報 / 截止日」為時間排程，由 webhook 伺服器依此設定推播。</div>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #EFE7D6" }}>
        <button onClick={pushWeekly} disabled={wbusy} style={{ border: "none", background: "#211C15", color: "#fff", borderRadius: 9, padding: "11px 18px", fontSize: 13.5, fontWeight: 600, cursor: wbusy ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>{wbusy ? "產生中…" : "📋 立即推送業主週報到 LINE"}</button>
      </div>
    </div>
  );
}

// ── ADVISOR SETTINGS VIEW ────────────────────────────────────────────────────
function AdvisorSettingsView({ settings, setSettings, cats, aiLog, setAiLog, activityLog, logActivity, userName, journal, events, plans }) {
  const [activeTab, setActiveTab] = useState("command"); // command | upload | settings | log
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [pendingUpload, setPendingUpload] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [aiLog]);

  const totalItems = cats.reduce((s,c)=>s+c.items.length,0);
  const doneItems = cats.flatMap(c=>c.items).filter(i=>i.done||i.status==="done").length;
  const issueItems = cats.flatMap(c=>c.items).filter(i=>i.status==="issue");
  const unassigned = cats.flatMap(c=>c.items).filter(i=>!i.assignee);
  const noDate = cats.flatMap(c=>c.items).filter(i=>!i.date&&i.status!=="done");
  const stalledItems = cats.flatMap(c=>c.items).filter(it=>{
    if(it.status==="done"||it.done) return false;
    if(!it.lastUpdated) return false;
    return (Date.now()-new Date(it.lastUpdated))/(1000*60*60*24)>3;
  });
  const today = new Date().toLocaleDateString("zh-TW");
  const daysLeft = settings?.targetDate ? Math.ceil((new Date(settings.targetDate)-new Date())/(1000*60*60*24)) : null;

  const addMsg = (role, text, meta) => {
    const entry = { role, text, ts: new Date().toLocaleString("zh-TW"), meta };
    setAiLog(prev => [...prev, entry]);
    return entry;
  };

  const runAI = async (userMsg, systemOverride, displayMsg) => {
    if(displayMsg) addMsg("user", displayMsg||userMsg);
    else addMsg("user", userMsg);
    setLoading(true);
    try {
      const system = systemOverride || buildAdvisorSystem(settings, cats, journal||[], events||[], plans||[]);
      const history = aiLog.slice(-16).map(m=>({ role:m.role==="user"?"user":"assistant", content:m.text }));
      history.push({ role:"user", content:userMsg });
      const reply = await callAI(history, system);
      addMsg("assistant", reply);
    } catch(e) { addMsg("assistant", "⚠️ AI連線失敗：" + e.message); }
    setLoading(false);
  };

  // ── QUICK COMMAND PROMPTS ──────────────────────────────────────────────────
  const COMMANDS = [
    {
      icon:"📋", label:"今日執行計劃",
      prompt: "請根據目前所有工程資料，給我今天的具體執行計劃。格式：\n1. 今日必須完成的3件最重要的事（說明理由）\n2. 今日需要推進的工程（每項給出具體行動）\n3. 今日需要確認或決策的事項\n4. 需要提前準備以免明後天卡關的事\n請給非常具體可執行的指令，不要空泛建議。"
    },
    {
      icon:"🔍", label:"完整衝突檢查",
      prompt: "請執行全面的工程衝突與矛盾檢查：\n1. 工序衝突：哪些工程的施工順序有問題？（列出具體衝突對）\n2. 時間衝突：哪些工程同時進行會產生場地或人力問題？\n3. 預算風險：哪些項目的預估金額明顯偏低或偏高？給出市場行情比較\n4. 資料缺漏：列出所有缺少關鍵資訊的項目（負責人、日期、金額）\n5. 施工工法問題：根據你的專業判斷，有哪些工法、材料或做法值得質疑或優化？\n\n如果以上都沒有問題，請直接給出完整的施工執行順序清單。"
    },
    {
      icon:"⚠️", label:"風險評估",
      prompt: "請從專業工程顧問角度，對這個專案進行風險評估：\n1. 進度風險：根據目前完成率和剩餘天數，能否如期完工？給出百分比信心度\n2. 預算風險：哪些項目最可能超支？超支可能原因是什麼？\n3. 品質風險：哪些工序最容易出現品質問題？預防措施是什麼？\n4. 法規風險：這個專案有哪些需要特別注意的法規或申請事項？\n5. 廠商風險：目前哪些項目的廠商安排最令人擔憂？\n請給出優先級和具體建議。"
    },
    {
      icon:"💰", label:"成本優化建議",
      prompt: "請從成本角度分析這個工程：\n1. 哪些項目的單價明顯高於市場行情？（請給出台灣市場參考價格）\n2. 哪些工序可以整合施工降低成本？\n3. 目前哪些「業主自理」項目應該盡快詢價？預估金額是多少？\n4. 有哪些項目可以優化材料選擇但不影響品質？\n5. 監督管理費是否合理？如何議價？\n請給出具體的省錢建議和預估節省金額。"
    },
    {
      icon:"📅", label:"工序排程建議",
      prompt: "請根據專業施工知識，為這個餐廳裝修工程排出最優化的施工順序：\n1. 列出所有大項工程的建議施工順序（1到最後）\n2. 哪些工程可以同時進行（並行作業）？\n3. 哪些工程有嚴格的先後順序要求（說明原因）？\n4. 每個大項建議的施工週數是多少？\n5. 關鍵路徑是什麼（最不能延誤的工程鏈）？\n請給出具體的甘特圖文字版本。"
    },
    {
      icon:"📊", label:"週報（給業主）",
      prompt: "請產生一份本週工程進度報告，格式要求：\n- 語言淺顯易懂（業主不是工程師）\n- 開頭一句話總結本週狀況\n- 完成了什麼（條列，用業主能理解的語言）\n- 目前進行中的工程\n- 需要業主知道或決策的事\n- 下週預計完成的工作\n- 整體評估（🟢順利 / 🟡需注意 / 🔴有問題）\n報告要讓業主看了放心或知道該問什麼。"
    },
    {
      icon:"🔔", label:"資料缺漏提醒",
      prompt: "請幫我找出所有資料不完整的地方，並告訴我為什麼這些資料缺漏會影響工程管理：\n1. 哪些細項沒有負責人？（沒有負責人意味著什麼風險？）\n2. 哪些細項沒有日期？（缺少日期對進度管理的影響？）\n3. 哪些細項的預估金額是0或不合理？\n4. 哪些重要工程文件可能還沒上傳？（如：施工圖、合約、估價單明細）\n5. 哪些項目的「備註」欄有⚠️警告但還沒處理？\n請按照緊迫程度排列，告訴我最優先要補充的資料是什麼。"
    },
    {
      icon:"🏗️", label:"工法專業審查",
      prompt: "請以資深工程顧問的身份，審查這個餐廳裝修工程的技術面：\n1. 地坪工程：輕質灌漿+EPS保麗龍的做法是否恰當？有無風險？\n2. 空調工程：大金VRV系統的配置（室外機×3、廚房四方吹×3）是否適合這個空間？\n3. 消防工程：R型總機費用$87,500是否合理？需要注意什麼？\n4. 機電工程：380V系統配置是否完整？有無遺漏的迴路？\n5. 整體：這個工程在工法或材料上有哪些你認為需要特別確認或質疑的地方？\n請給出具體的專業意見，必要時引用相關規範。"
    },
  ];

  // ── FILE UPLOAD HANDLER ────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const fileData = { name: file.name, type: file.type, size: file.size, data: ev.target.result, ts: new Date().toISOString() };
        setPendingUpload(fileData);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const sendFileToAI = async () => {
    if (!pendingUpload) return;
    setLoading(true);
    setActiveTab("command");
    addMsg("user", "📎 上傳檔案：" + pendingUpload.name);
    try {
      let prompt = "";
      let messages = [];
      if (pendingUpload.type.startsWith("image/")) {
        prompt = "這是我上傳的工程相關圖片：" + pendingUpload.name + "。請分析這張圖片的內容，如果是施工圖、估價單、合約或現場照片，請：1.描述你看到的內容 2.指出任何需要注意的問題 3.提供相關專業建議。";
        messages = [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: pendingUpload.type, data: pendingUpload.data.split(",")[1] } },
            { type: "text", text: prompt }
          ]
        }];
      } else {
        prompt = "我上傳了一份文件：「" + pendingUpload.name + "」（" + Math.round(pendingUpload.size/1024) + "KB）。這是一份工程相關文件，請根據文件名稱和類型，告訴我：1.你判斷這是什麼類型的文件 2.我應該從這份文件中確認哪些關鍵資訊 3.這份文件和目前的工程管理有什麼關聯？";
        messages = [{ role:"user", content: prompt }];
      }
      const system = buildAdvisorSystem(settings, cats, journal||[], events||[], plans||[]);
      const reply = await callAI(messages, system);
      addMsg("assistant", reply, { file: pendingUpload.name });
      setUploadedFiles(prev => [...prev, { name: pendingUpload.name, ts: pendingUpload.ts, type: pendingUpload.type }]);
      logActivity("上傳文件", pendingUpload.name);
    } catch(e) { addMsg("assistant", "⚠️ 分析失敗：" + e.message); }
    setPendingUpload(null);
    setLoading(false);
  };

  const upd = (field, val) => setSettings({ ...settings, [field]: val });
  const fieldStyle = { width:"100%", padding:"9px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, color:"#211C15", outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", background:"#f9fafb" };

  return (
    <div style={{ paddingTop:12, maxWidth:900, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:14, padding:"14px 18px" }}>
        <div style={{ width:44, height:44, borderRadius:12, background:"#211C15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🤖</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:16, fontWeight: 600, color:"#211C15" }}>AI 工程特助</div>
          <div style={{ fontSize:12, color:"#6F6656" }}>
            {today} · 完成 {doneItems}/{totalItems} 項
            {daysLeft!==null && <span style={{ color:daysLeft<14?"#dc2626":daysLeft<30?"#f59e0b":"#3C8C3C", fontWeight: 600 }}> · 距完工 {daysLeft} 天</span>}
            {stalledItems.length>0 && <span style={{ color:"#dc2626", fontWeight: 600 }}> · ⏰ {stalledItems.length} 項卡關</span>}
            {issueItems.length>0 && <span style={{ color:"#dc2626", fontWeight: 600 }}> · 🚨 {issueItems.length} 項有問題</span>}
          </div>
        </div>
        {/* Status chips */}
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {unassigned.length>0 && <span style={{ fontSize:11, background:"#fff7ed", color:"#c2410c", borderRadius:20, padding:"3px 10px", fontWeight:600 }}>未指派 {unassigned.length}</span>}
          {noDate.length>0 && <span style={{ fontSize:11, background:"#F3E4DE", color:"#6F6656", borderRadius:20, padding:"3px 10px", fontWeight:600 }}>未設日期 {noDate.length}</span>}
        </div>
      </div>

      {/* Sub tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:14 }}>
        {[["command","⚡ 指令中心"],["upload","📎 上傳資料"],["settings","⚙ 專案設定"],["log","💬 對話記錄"]].map(([t,l]) => (
          <button key={t} onClick={()=>setActiveTab(t)} style={{ padding:"7px 16px", borderRadius:8, border:"1px solid #D8CFBB", fontSize:13, cursor:"pointer", background:activeTab===t?"#211C15":"#ECE6D7", color:activeTab===t?"#ffffff":"#6F6656", fontWeight:activeTab===t?700:400, transition:"all 0.15s" }}>{l}</button>
        ))}
      </div>

      {/* ── COMMAND CENTER ── */}
      {activeTab === "command" && (
        <div>
          {/* Quick commands grid */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
            {COMMANDS.map(cmd => (
              <button key={cmd.label} onClick={() => { setActiveTab("log"); runAI(cmd.prompt, null, cmd.icon + " " + cmd.label); }}
                disabled={loading}
                style={{ padding:"14px 16px", background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, cursor:loading?"not-allowed":"pointer", textAlign:"left", transition:"all 0.15s", opacity:loading?0.6:1 }}
                onMouseEnter={e=>!loading&&(e.currentTarget.style.borderColor=ACCENT,e.currentTarget.style.background="#F3E4DE")}
                onMouseLeave={e=>(e.currentTarget.style.borderColor="#D8CFBB",e.currentTarget.style.background="#ffffff")}
              >
                <div style={{ fontSize:22, marginBottom:6 }}>{cmd.icon}</div>
                <div style={{ fontSize:13, fontWeight: 600, color:"#211C15" }}>{cmd.label}</div>
              </button>
            ))}
          </div>

          {/* Dependency warnings */}
          <DependencyWarnings cats={cats} setCats={setCats => {}} />

          {/* Free input */}
          <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:16 }}>
            <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>自由提問 / 指令</div>
            <div style={{ display:"flex", gap:8 }}>
              <textarea value={chatInput} onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault(); if(chatInput.trim()&&!loading){const t=chatInput.trim();setChatInput("");setActiveTab("log");runAI(t);}}}}
                placeholder="問任何問題，或描述你的狀況讓AI幫你分析…（Enter送出）"
                style={{ ...fieldStyle, flex:1, height:52, resize:"none", background:"#f9fafb" }}
              />
              <button onClick={()=>{if(chatInput.trim()&&!loading){const t=chatInput.trim();setChatInput("");setActiveTab("log");runAI(t);}}}
                disabled={loading||!chatInput.trim()}
                style={{ padding:"0 20px", background:"#211C15", border:"none", borderRadius:10, color:"#fff", fontWeight: 600, cursor:loading||!chatInput.trim()?"not-allowed":"pointer", opacity:loading||!chatInput.trim()?0.5:1, fontSize:14, minWidth:64 }}>
                送出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── UPLOAD TAB ── */}
      {activeTab === "upload" && (
        <div>
          <div style={{ background:"#ffffff", border:"2px dashed #D8CFBB", borderRadius:14, padding:"30px 20px", textAlign:"center", marginBottom:16 }}>
            <div style={{ fontSize:40, marginBottom:10 }}>📎</div>
            <div style={{ fontSize:15, fontWeight: 600, color:"#211C15", marginBottom:6 }}>上傳工程文件</div>
            <div style={{ fontSize:13, color:"#6F6656", marginBottom:20 }}>估價單、合約、施工圖、照片、會議記錄…AI會分析並歸檔</div>
            <label style={{ display:"inline-block", padding:"10px 28px", background:"#211C15", color:"#fff", borderRadius:10, fontSize:14, fontWeight: 600, cursor:"pointer" }}>
              選擇檔案
              <input type="file" accept="image/*,.pdf,.jpg,.jpeg,.png,.gif,.webp" multiple style={{ display:"none" }} onChange={handleFileUpload} />
            </label>
          </div>

          {pendingUpload && (
            <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:12, padding:16, marginBottom:16 }}>
              <div style={{ fontSize:13, fontWeight: 600, color:"#166534", marginBottom:6 }}>✅ 準備分析：{pendingUpload.name}</div>
              <div style={{ fontSize:12, color:"#4ade80", marginBottom:12 }}>{Math.round(pendingUpload.size/1024)}KB · {pendingUpload.type}</div>
              {pendingUpload.type.startsWith("image/") && (
                <img src={pendingUpload.data} alt="preview" style={{ maxWidth:"100%", maxHeight:200, borderRadius:8, marginBottom:12, objectFit:"contain" }} />
              )}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={sendFileToAI} disabled={loading} style={{ flex:1, padding:"10px 0", background:"#211C15", border:"none", borderRadius:8, color:"#fff", fontWeight: 600, cursor:loading?"not-allowed":"pointer", fontSize:14 }}>
                  {loading?"分析中…":"🤖 讓AI分析這份文件"}
                </button>
                <button onClick={()=>setPendingUpload(null)} style={{ padding:"10px 16px", background:"none", border:"1px solid #D8CFBB", borderRadius:8, cursor:"pointer", fontSize:13, color:"#6F6656" }}>取消</button>
              </div>
            </div>
          )}

          {uploadedFiles.length > 0 && (
            <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:16 }}>
              <div style={{ fontSize:13, fontWeight: 600, color:"#211C15", marginBottom:12 }}>已分析的文件（{uploadedFiles.length}）</div>
              {uploadedFiles.map((f,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:i<uploadedFiles.length-1?"1px solid #EFE7D6":"none" }}>
                  <span style={{ fontSize:20 }}>{f.type.startsWith("image/")?"🖼️":"📄"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, color:"#211C15", fontWeight:500 }}>{f.name}</div>
                    <div style={{ fontSize:11, color:"#A99F88" }}>{new Date(f.ts).toLocaleString("zh-TW")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {activeTab === "settings" && (
        <div>
          <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:"20px", marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight: 600, color:"#211C15", marginBottom:14 }}>專案基本資訊</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[["projectName","專案名稱"],["projectAddress","地址"],["ownerName","業主"],["contractorName","承包商"]].map(([f,l]) => (
                <div key={f}>
                  <div style={{ fontSize:11, color:"#6F6656", marginBottom:5, fontWeight:600 }}>{l}</div>
                  <input value={settings[f]||""} onChange={e=>upd(f,e.target.value)} style={fieldStyle} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:5, fontWeight:600 }}>目標完工日</div>
                <input type="date" value={settings.targetDate||""} onChange={e=>upd("targetDate",e.target.value)} style={fieldStyle} />
              </div>
              <div>
                <div style={{ fontSize:11, color:"#6F6656", marginBottom:5, fontWeight:600 }}>總預算上限</div>
                <input type="number" value={settings.budget||""} onChange={e=>upd("budget",e.target.value)} style={fieldStyle} placeholder="NT$" />
              </div>
            </div>
          </div>
          <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:"20px", marginBottom:14 }}>
            <div style={{ fontSize:14, fontWeight: 600, color:"#211C15", marginBottom:8 }}>給AI的特別指示</div>
            <div style={{ fontSize:12, color:"#6F6656", marginBottom:8 }}>告訴AI需要特別注意的事：假日不得施工、業主偏好、付款方式、特殊限制等</div>
            <textarea value={settings.notes||""} onChange={e=>upd("notes",e.target.value)} style={{ ...fieldStyle, height:120, resize:"vertical" }}
              placeholder="例如：週六日不得施工、業主要每週五收到進度報告、磁磚需業主現場確認才能下單、廠商付款需30天票期…" />
          </div>
          <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:"20px" }}>
            <div style={{ fontSize:14, fontWeight: 600, color:"#211C15", marginBottom:8 }}>⭐ 優先追蹤項目</div>
            <div style={{ fontSize:12, color:"#6F6656", marginBottom:12 }}>標記需要AI特別關注的細項</div>
            {cats.map(cat => (
              <div key={cat.id} style={{ marginBottom:12 }}>
                <div style={{ fontSize:12, color:"#4A4234", fontWeight: 600, marginBottom:6 }}>{cat.name}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {cat.items.map(item => {
                    const isPri = (settings.priorities||[]).includes(item.id);
                    return (
                      <button key={item.id} onClick={()=>{ const p=settings.priorities||[]; upd("priorities",isPri?p.filter(x=>x!==item.id):[...p,item.id]); }}
                        style={{ fontSize:11, padding:"4px 12px", borderRadius:20, border:"1px solid "+(isPri?ACCENT:"#D8CFBB"), background:isPri?"#F3E4DE":"#ECE6D7", color:isPri?"#92400e":"#6F6656", cursor:"pointer" }}>
                        {isPri?"⭐ ":""}{item.name.slice(0,22)}{item.name.length>22?"…":""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <LineNotifySettings settings={settings} upd={upd} cats={cats} journal={journal} events={events} plans={plans} />
        </div>
      )}

      {/* ── CHAT LOG TAB ── */}
      {activeTab === "log" && (
        <div>
          <div style={{ background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:16, maxHeight:560, overflowY:"auto", marginBottom:12 }}>
            {aiLog.length===0 && <div style={{ textAlign:"center", color:"#A99F88", padding:"40px 0", fontSize:13 }}>點擊左側指令開始，或直接輸入問題</div>}
            {aiLog.map((m,i) => (
              <div key={i} style={{ marginBottom:16, display:"flex", gap:10, flexDirection:m.role==="user"?"row-reverse":"row" }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:m.role==="user"?"#dbeafe":"#211C15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
                  {m.role==="user"?"👤":"🤖"}
                </div>
                <div style={{ maxWidth:"82%", background:m.role==="user"?"#eff6ff":"#f9fafb", border:m.role==="user"?"1px solid #bfdbfe":"1px solid #D8CFBB", borderRadius:12, padding:"10px 14px" }}>
                  {m.meta?.file && <div style={{ fontSize:11, color:"#6F6656", marginBottom:4 }}>📎 {m.meta.file}</div>}
                  <div style={{ fontSize:13, lineHeight:1.85, color:"#1e293b", whiteSpace:"pre-wrap" }}>{m.text}</div>
                  <div style={{ fontSize:10, color:"#A99F88", marginTop:5 }}>{m.ts}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:"#211C15", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🤖</div>
                <div style={{ padding:"12px 16px", color:"#6F6656", fontSize:13, background:"#f9fafb", border:"1px solid #D8CFBB", borderRadius:12 }}>
                  <span style={{ animation:"pulse 1s infinite" }}>AI 特助分析中…</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <textarea value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(chatInput.trim()&&!loading){const t=chatInput.trim();setChatInput("");runAI(t);}}}}
              placeholder="繼續對話，或提出新問題…（Enter送出，Shift+Enter換行）"
              style={{ flex:1, padding:"10px 12px", border:"1px solid #D8CFBB", borderRadius:10, fontSize:13, outline:"none", fontFamily:"'Noto Sans TC',sans-serif", height:52, resize:"none", background:"#f9fafb" }}
            />
            <button onClick={()=>{if(chatInput.trim()&&!loading){const t=chatInput.trim();setChatInput("");runAI(t);}}} disabled={loading||!chatInput.trim()}
              style={{ padding:"0 20px", background:"#211C15", border:"none", borderRadius:10, color:"#fff", fontWeight: 600, cursor:loading||!chatInput.trim()?"not-allowed":"pointer", opacity:loading||!chatInput.trim()?0.5:1, fontSize:14, minWidth:64 }}>送出</button>
          </div>
          <div style={{ marginTop:8, textAlign:"right" }}>
            <button onClick={()=>setAiLog([])} style={{ fontSize:11, color:"#A99F88", background:"none", border:"none", cursor:"pointer" }}>清除記錄</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DEPENDENCY WARNINGS ───────────────────────────────────────────────────────
function DependencyWarnings({ cats }) {
  const [deps, setDeps] = useState(() => {
    // Default suggested dependencies based on construction logic
    return [
      { from:"拆除工程", to:"隔間工程", reason:"隔間前需完成拆除" },
      { from:"隔間工程", to:"天花工程", reason:"天花施作前隔間需定位" },
      { from:"隔間工程", to:"牆面工程", reason:"牆面工程依賴隔間完成" },
      { from:"機電工程", to:"天花工程", reason:"天花封板前需完成管線" },
      { from:"空調工程", to:"天花工程", reason:"空調風管需在天花前配置" },
      { from:"地坪工程", to:"活動道具工程", reason:"地坪完成後才可安裝固定道具" },
      { from:"消防工程", to:"天花工程", reason:"消防管線需在封天花前完成" },
    ];
  });

  const warnings = deps.map(dep => {
    const fromCat = cats.find(c=>c.name===dep.from||c.name.includes(dep.from.replace("工程","")));
    const toCat = cats.find(c=>c.name===dep.to||c.name.includes(dep.to.replace("工程","")));
    if (!fromCat || !toCat) return null;
    const fromDone = fromCat.status==="done" || fromCat.items.filter(i=>i.done||i.status==="done").length===fromCat.items.length;
    const toStarted = toCat.status==="inprogress" || toCat.items.some(i=>i.status==="inprogress"||i.status==="done");
    if (!fromDone && toStarted) return { ...dep, fromName:fromCat.name, toName:toCat.name, severity:"high" };
    if (!fromDone && toCat.status==="pending" && fromCat.status==="pending") return null;
    return null;
  }).filter(Boolean);

  if (warnings.length === 0) return null;

  return (
    <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:12, padding:14, marginBottom:14 }}>
      <div style={{ fontSize:13, fontWeight: 600, color:"#92400e", marginBottom:8 }}>⚠️ 工序相依提醒（{warnings.length}）</div>
      {warnings.map((w,i) => (
        <div key={i} style={{ fontSize:12, color:"#78350f", padding:"5px 0", borderBottom:i<warnings.length-1?"1px solid #fde68a":"none" }}>
          <span style={{ fontWeight: 600 }}>{w.toName}</span> 已開始，但 <span style={{ fontWeight: 600 }}>{w.fromName}</span> 尚未完成 — {w.reason}
        </div>
      ))}
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
          <div style={{ width: 200, flexShrink: 0, fontSize: 11, color: "#6F6656", padding: "4px 8px" }}>工程項目</div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)` }}>
            {Array.from({length: weeks}, (_,i) => (
              <div key={i} style={{ fontSize: 10, color: "#6F6656", textAlign: "center", borderLeft: "1px solid #D8CFBB33" }}>W{i+1}</div>
            ))}
          </div>
        </div>
        {[...cats].sort((a,b) => a.order - b.order).map((cat, ci) => {
          const start = cat.ganttStart ?? ci;
          const dur = cat.ganttDur ?? Math.max(1, Math.round(cat.budget / 200000));
          const st = STATUS_MAP[cat.status] || STATUS_MAP.pending;
          return (
            <div key={cat.id} style={{ display: "flex", marginBottom: 6, alignItems: "center" }}>
              <div style={{ width: 200, flexShrink: 0, fontSize: 12, color: "#211C15", padding: "4px 8px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${weeks},1fr)`, height: 28, background: "#EFE7D6", borderRadius: 4, overflow: "hidden", cursor: "pointer" }}
                onClick={() => {
                  const s = parseInt(prompt(`「${cat.name}」開始週 (1-${weeks}):`, start+1)) - 1;
                  const d = parseInt(prompt("持續週數:", dur));
                  if (!isNaN(s) && !isNaN(d)) setCats(prev => prev.map(c => c.id === cat.id ? {...c, ganttStart: Math.max(0,s), ganttDur: Math.max(1,d)} : c));
                }}
              >
                {Array.from({length: weeks}, (_,i) => {
                  const inBar = i >= start && i < start + dur;
                  return (
                    <div key={i} style={{ borderLeft: "1px solid #D8CFBB33", height: "100%", background: inBar ? st.color + "cc" : "transparent", position: "relative" }}>
                      {inBar && i === start && <div style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#f4f5f7", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" }}>{cat.name.slice(0,6)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: "#6F6656", marginTop: 8, padding: "0 8px" }}>點擊工序列可調整開始週與持續時間</div>
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
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>工程大項名稱</div>
        <input
          value={cat.name}
          onChange={e => updateCat("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 16, fontWeight: 600, color: "#211C15" }}
        />
      </div>
      {(() => { const e = cat.items.reduce((s,it)=>s+estAmount(it),0), p = cat.items.reduce((s,it)=>s+paidOf(it),0), u = e - p; return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估（含稅）</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(e)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(p)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: u < 0 ? "#DC2626" : "#C2872E" }}>{u < 0 ? `溢付${fmt(-u)}` : fmt(u)}</div>
        </div>
      </div>
      ); })()}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>狀態</div>
        <StatusBadge status={cat.status} setCats={setCats} catId={cat.id} />
      </div>
      <input
        placeholder="負責單位/廠商"
        value={cat.vendor || ""}
        onChange={e => updateCat("vendor", e.target.value)}
        style={{ ...inputStyle, marginBottom: 14 }}
      />
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>細項列表</div>
      {cat.items.map(item => (
        <div key={item.id} onClick={() => onSelectItem(item)} style={{ background: "#EFE7D6", borderRadius: 8, padding: "10px 12px", marginBottom: 6, cursor: "pointer", border: "1px solid #D8CFBB", transition: "border-color 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="#D8CFBB"}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 13, color: item.notes?.includes("⚠️") ? "#C2872E" : "#211C15", flex: 1 }}>{item.name}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: ACCENT }}>{fmt(calcItemTotal(item))}</div>
            <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); confirm(`刪除「${item.name}」？`).then(ok => { if (ok) setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); }); }} style={{ width: 20, height: 20, borderRadius: "50%", background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, cursor: "pointer", flexShrink: 0, padding: 0 }}>×</button>
          </div>
          <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>
            {item.qty} {item.unit} · {item.assignee || "未指派"} · <span style={{ color: STATUS_MAP[item.status]?.color || "#6F6656" }}>{STATUS_MAP[item.status]?.label}</span>
            {item.chat?.length > 0 && " · 💬" + item.chat.length}
          </div>
        </div>
      ))}
      <button onClick={() => {
        const newItem = { id: "i-" + cat.id + "-" + Date.now(), name: "新細項", qty: 1, unit: "式", unitPrice: 0, labor: 0, laborDays: 0, dailyWage: 0, assignee: "", status: "pending", receipts: [], notes: "", chat: [] };
        setCats(prev => prev.map(c => c.id === cat.id ? { ...c, items: [...c.items, newItem] } : c));
      }} style={{ width: "100%", padding: "8px", background: "#fff8e6", border: "1px dashed rgba(193,58,34,0.35)", borderRadius: 8, color: ACCENT, cursor: "pointer", fontSize: 13, marginTop: 4 }}>
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
  const [lightbox, setLightbox] = useState(null);
  const [rcpBusy, setRcpBusy] = useState(false);
  const addReceipts = async (files) => {
    if (!files || !files.length) return;
    setRcpBusy(true);
    const out = [];
    for (const f of files) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); }
      catch (_) {}
    }
    setRcpBusy(false);
    if (out.length) updateItem("receipts", [...(currentItem.receipts || []), ...out]);
  };
  const removeReceipt = async (ri) => {
    const r = (currentItem.receipts || [])[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    updateItem("receipts", (currentItem.receipts || []).filter((_, i) => i !== ri));
  };

  return (
    <SidePanel onClose={onClose} wide>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 2 }}>{cat.name}</div>
        <input
          value={currentItem.name}
          onChange={e => updateItem("name", e.target.value)}
          style={{ ...inputStyle, fontSize: 15, fontWeight: 600, color: "#211C15" }}
          placeholder="細項名稱"
        />
        <button onClick={() => confirm(`確定刪除細項「${currentItem.name}」？`).then(ok => { if (ok) { setCats(prev => prev.map(c => c.id === cat.id ? {...c, items: c.items.filter(it => it.id !== item.id)} : c)); onClose(); } })} style={{ marginTop: 6, background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 7, color: "#DC2626", fontSize: 12, padding: "5px 12px", cursor: "pointer", alignSelf: "flex-start" }}>🗑 刪除此細項</button>
      </div>
      {/* ── 預估 vs 實際 兩欄 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, marginBottom: 14, border: "1px solid #D8CFBB", borderRadius: 10, overflow: "hidden" }}>
        {/* headers */}
        <div style={{ background: "#F3E4DE", borderBottom: "1px solid #D8CFBB", borderRight: "1px solid #D8CFBB", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: ACCENT, letterSpacing: 1 }}>📋 預估（估價單）</div>
        <div style={{ background: "#F3E4DE", borderBottom: "1px solid #D8CFBB", padding: "7px 12px", fontSize: 11, fontWeight: 600, color: "#3E72A8", letterSpacing: 1 }}>🔨 實際（施工記錄）</div>
        {/* qty */}
        <div style={{ borderRight: "1px solid #D8CFBB", borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.estQty ?? currentItem.qty ?? 0} onChange={v => updateItem("estQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <input value={currentItem.unit} onChange={e => updateItem("unit", e.target.value)} style={{ ...inputStyle, width: 56, fontSize: 12 }} />
          </div>
        </div>
        <div style={{ borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>數量</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <NumInput value={currentItem.actQty ?? 0} onChange={v => updateItem("actQty", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} />
            <span style={{ fontSize: 11, color: "#6F6656", whiteSpace: "nowrap" }}>{currentItem.unit}</span>
          </div>
        </div>
        {/* unit price */}
        <div style={{ borderRight: "1px solid #D8CFBB", borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estUnitPrice ?? currentItem.unitPrice ?? 0} onChange={v => updateItem("estUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>單價</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.actUnitPrice ?? 0} onChange={v => updateItem("actUnitPrice", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        {/* labor */}
        <div style={{ borderRight: "1px solid #D8CFBB", borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人工費（整筆估）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 10, color: "#6F6656" }}>NT$</span><NumInput value={currentItem.estLabor ?? currentItem.labor ?? 0} onChange={v => updateItem("estLabor", v)} style={{ ...inputStyle, flex: 1, fontSize: 13 }} /></div>
        </div>
        <div style={{ borderBottom: "1px solid #D8CFBB55", padding: "8px 12px" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 3 }}>人數 / 日薪 / 天數</div>
          <div style={{ display: "flex", gap: 4 }}>
            <NumInput value={currentItem.actWorkers ?? 0} onChange={v => updateItem("actWorkers", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="人" />
            <NumInput value={currentItem.actDailyWage ?? 0} onChange={v => updateItem("actDailyWage", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="日薪" />
            <NumInput value={currentItem.actLaborDays ?? 0} onChange={v => updateItem("actLaborDays", v)} style={{ ...inputStyle, flex: 1, fontSize: 12 }} placeholder="天" />
          </div>
        </div>
        {/* totals */}
        <div style={{ borderRight: "1px solid #D8CFBB", padding: "8px 12px", background: "#ECE6D7" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>預估複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: ACCENT }}>{fmt(calcEstimated(currentItem))}</div>
        </div>
        <div style={{ padding: "8px 12px", background: "#f5faff" }}>
          <div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>實際複價</div>
          <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 600, color: calcActual(currentItem) > calcEstimated(currentItem) ? "#DC2626" : "#3E72A8" }}>
            {calcActual(currentItem) > 0 ? fmt(calcActual(currentItem)) : "尚未填入"}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Field label="負責人/廠商" value={currentItem.assignee} onChange={v => updateItem("assignee", v)} />
        <div>
          <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>狀態</div>
          <StatusBadge status={currentItem.status} setCats={setCats} catId={cat.id} itemId={currentItem.id} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Field label="備註" value={currentItem.notes} onChange={v => updateItem("notes", v)} multiline />
      </div>
      {/* Receipts：發票／憑證照片（點擊放大） */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>🧾 發票／憑證 ({currentItem.receipts?.length || 0})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {currentItem.receipts?.map((r, ri) => (
            r.url ? (
              <div key={ri} style={{ position: "relative" }}>
                {r.isImage !== false
                  ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #D8CFBB", cursor: "zoom-in" }} />
                  : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 80, height: 80, borderRadius: 8, border: "1px solid #D8CFBB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, textDecoration: "none", background: "#F3E4DE" }}>📄</a>}
                <button onClick={() => removeReceipt(ri)} style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 11, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
            ) : (
              <div key={ri} title="點擊刪除" onClick={() => removeReceipt(ri)} style={{ background: "#EFE7D6", borderRadius: 6, padding: "6px 10px", fontSize: 12, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <span>📎 {r.name}</span>{r.amount ? <span style={{ color: ACCENT, fontFamily: "monospace" }}>{fmt(r.amount)}</span> : null}
              </div>
            )
          ))}
          <label style={{ width: 80, height: 80, borderRadius: 8, border: "1px dashed #D8CFBB", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#A99F88", fontSize: 12 }}>
            <span style={{ fontSize: 22 }}>{rcpBusy ? "…" : "＋"}</span>{rcpBusy ? "上傳中" : "上傳"}
            <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { addReceipts(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {/* Photo uploads */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>📷 施工照片 ({currentItem.photos?.length || 0})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {currentItem.photos?.map((p, pi) => (
            <div key={pi} style={{ position: "relative" }}>
              <img src={p.data} alt={p.name} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid #D8CFBB" }} />
              <button onClick={() => updateItem("photos", currentItem.photos.filter((_,i2)=>i2!==pi))}
                style={{ position:"absolute", top:-6, right:-6, width:20, height:20, borderRadius:"50%", background:"#dc2626", border:"none", color:"#fff", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>×</button>
            </div>
          ))}
          <label style={{ width:80, height:80, border:"2px dashed #D8CFBB", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"#A99F88", fontSize:11, gap:4 }}>
            <span style={{ fontSize:24 }}>+</span>
            <span>照片</span>
            <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e => {
              Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => updateItem("photos", [...(currentItem.photos||[]), { data: ev.target.result, name: file.name, ts: new Date().toISOString() }]);
                reader.readAsDataURL(file);
              });
              e.target.value = "";
            }} />
          </label>
        </div>
      </div>
      {/* Item Chat + AI */}
      <ItemChat cat={cat} item={currentItem} setCats={setCats} />
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
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
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 8 }}>💬 項目討論室 & AI顧問</div>
      <div style={{ background: "#f4f5f7", borderRadius: 8, border: "1px solid #D8CFBB", maxHeight: 280, overflowY: "auto", padding: 10, marginBottom: 8 }}>
        {(!item.chat || item.chat.length === 0) && (
          <div style={{ fontSize: 12, color: "#D8CFBB", textAlign: "center", padding: "20px 0" }}>輸入問題詢問AI工程顧問，或記錄討論內容</div>
        )}
        {item.chat?.map((m, i) => (
          <div key={i} style={{ marginBottom: 10, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#F3E4DE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0, border: m.role !== "user" ? `1px solid ${ACCENT}44` : "none" }}>
              {m.role === "user" ? "👤" : "🤖"}
            </div>
            <div style={{ background: m.role === "user" ? ACCENT : "#EFE7D6", border: "none", borderRadius: 10, padding: "8px 11px", maxWidth: "85%", fontSize: 12.5, lineHeight: 1.6, color: m.role === "user" ? "#ffffff" : "#211C15", whiteSpace: "pre-wrap" }}>
              {m.text}
              <div style={{ fontSize: 10, color: "#6F6656", marginTop: 3 }}>{m.ts}</div>
            </div>
          </div>
        ))}
        {aiLoading && (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#F3E4DE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, border: `1px solid ${ACCENT}44` }}>🤖</div>
            <div style={{ fontSize: 12, color: ACCENT, padding: "8px 10px" }}>AI顧問分析中…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="詢問AI顧問或記錄討論…" style={{ ...inputStyle, flex: 1, margin: 0 }} />
        <button onClick={send} disabled={aiLoading || !input.trim()} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 14px", color: "#ffffff", fontWeight: 600, cursor: aiLoading ? "not-allowed" : "pointer", fontSize: 13, opacity: aiLoading ? 0.6 : 1 }}>送出</button>
      </div>
    </div>
  );
}

// ── GLOBAL AI PANEL ────────────────────────────────────────────────────────────
// ── 工作日誌 ─────────────────────────────────────────────────────────────────
const wlMiniBtn = { background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer", color:"#4A4234" };
function WorklogView({ worklog, setWorklog, canEdit, userName, requireLogin, confirm }) {
  const [draft, setDraft] = useState("");
  const [draftDate, setDraftDate] = useState(new Date().toISOString().slice(0,10));
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);

  const uploadAll = async (files) => {
    const arr = Array.from(files||[]);
    const out = [];
    setUploading(true);
    for (const f of arr) {
      try { const { url, path } = await uploadPhoto(f); out.push({ id:"wp-"+Math.random().toString(36).slice(2,8), url, path, name:f.name||"檔案", isImage:/^image\//.test(f.type) }); }
      catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    }
    setUploading(false);
    return out;
  };
  const addPhotosToDraft = async (files) => { if (!canEdit) { requireLogin&&requireLogin(); return; } const ph = await uploadAll(files); if (ph.length) setDraftPhotos(prev => [...prev, ...ph]); };
  const addPhotosToEntry = async (id, files) => { const ph = await uploadAll(files); if (ph.length) setWorklog(worklog.map(w => w.id===id ? { ...w, photos:[...(w.photos||[]), ...ph] } : w)); };

  // 在工作日誌頁時，貼上截圖 → 加到草稿
  const draftRef = useRef(null); draftRef.current = addPhotosToDraft;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items || []; const imgs = [];
      for (const it of items) if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); }
      if (imgs.length) { e.preventDefault(); draftRef.current && draftRef.current(imgs); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const add = () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const c = draft.trim(); if (!c && draftPhotos.length === 0) return;
    const entry = { id: "wl-"+Math.random().toString(36).slice(2,8), date: draftDate || new Date().toISOString().slice(0,10), content: c, photos: draftPhotos, author: userName || "—", ts: new Date().toISOString() };
    setWorklog([entry, ...worklog]);
    setDraft(""); setDraftPhotos([]);
  };
  const saveEdit = (id) => { setWorklog(worklog.map(w => w.id === id ? { ...w, content: editText } : w)); setEditId(null); };
  const del = async (id) => { if (confirm && !(await confirm("確定刪除這筆工作日誌？"))) return; setWorklog(worklog.filter(w => w.id !== id)); };
  const removeEntryPhoto = (id, pid) => setWorklog(worklog.map(w => w.id===id ? { ...w, photos:(w.photos||[]).filter(p=>p.id!==pid) } : w));
  const sorted = [...worklog].sort((a,b) => (b.date||"").localeCompare(a.date||"") || (b.ts||"").localeCompare(a.ts||""));
  const thumb = (p, onRemove) => (
    <div key={p.id} style={{ position:"relative", width:60, height:60, borderRadius:8, overflow:"hidden", border:"1px solid #D8CFBB", background:"#ECE6D7", display:"flex", alignItems:"center", justifyContent:"center" }}>
      {p.isImage!==false ? <img src={p.url} alt="" onClick={()=>setLightbox(p)} style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"zoom-in" }} />
        : <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:20, textDecoration:"none" }}>📄</a>}
      {onRemove && <button onClick={()=>onRemove(p.id)} style={{ position:"absolute", top:-6, right:-6, width:18, height:18, borderRadius:"50%", background:"#211C15", color:"#fff", border:"none", fontSize:11, cursor:"pointer", lineHeight:1 }}>×</button>}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#211C15", marginBottom: 12 }}>📓 工作日誌</div>
      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #D8CFBB", borderRadius:12, padding:16, marginBottom:16 }}>
          <input type="date" value={draftDate} onChange={e=>setDraftDate(e.target.value)} style={{ ...inputStyle, width:170, marginBottom:8 }} />
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder="記錄今天的工程狀況、決策、問題…（也可在「AI顧問」對話框口述，請它幫你建立日誌）"
            style={{ ...inputStyle, width:"100%", minHeight:80, resize:"vertical", boxSizing:"border-box" }} />
          {draftPhotos.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
              {draftPhotos.map(p => thumb(p, (pid)=>setDraftPhotos(prev=>prev.filter(x=>x.id!==pid))))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e=>{ addPhotosToDraft(e.target.files); e.target.value=""; }} />
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
            <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:"#EFE7D6", border:"1px solid #D8CFBB", borderRadius:8, padding:"7px 12px", cursor:"pointer", fontSize:13, color:"#4A4234" }}>{uploading?"上傳中…":"📷 附現場照片"}</button>
            <span style={{ fontSize:11, color:"#A99F88" }}>可貼上截圖</span>
            <div style={{ flex:1 }} />
            <button onClick={add} disabled={!draft.trim() && draftPhotos.length===0} style={{ background: (draft.trim()||draftPhotos.length)?ACCENT:"#D8CFBB", color: (draft.trim()||draftPhotos.length)?"#ffffff":"#A99F88", border:"none", borderRadius:8, padding:"8px 18px", fontWeight: 600, cursor: (draft.trim()||draftPhotos.length)?"pointer":"not-allowed" }}>新增日誌</button>
          </div>
        </div>
      ) : (
        <div style={{ background:"#F4EFE3", border:"1px solid #D8CFBB", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可新增 / 編輯工作日誌。</div>
      )}
      {sorted.length === 0 ? (
        <div style={{ textAlign:"center", color:"#A99F88", padding:40 }}>尚無工作日誌</div>
      ) : sorted.map(w => (
        <div key={w.id} style={{ background:"#fff", border:"1px solid #D8CFBB", borderRadius:12, padding:14, marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight: 600, color:ACCENT, fontFamily:"monospace" }}>{w.date}</span>
            <span style={{ fontSize:11, color:"#A99F88" }}>by {w.author||"—"}</span>
            <div style={{ flex:1 }} />
            {canEdit && editId !== w.id && (<>
              <button onClick={()=>{ setEditId(w.id); setEditText(w.content); }} style={wlMiniBtn}>編輯</button>
              <button onClick={()=>del(w.id)} style={{ ...wlMiniBtn, color:"#dc2626" }}>刪除</button>
            </>)}
          </div>
          {editId === w.id ? (
            <div>
              <textarea value={editText} onChange={e=>setEditText(e.target.value)} style={{ ...inputStyle, width:"100%", minHeight:70, boxSizing:"border-box" }} />
              <div style={{ textAlign:"right", marginTop:6 }}>
                <button onClick={()=>setEditId(null)} style={{ ...wlMiniBtn, marginRight:6 }}>取消</button>
                <button onClick={()=>saveEdit(w.id)} style={{ background:ACCENT, color:"#ffffff", border:"none", borderRadius:6, padding:"5px 14px", fontWeight: 600, cursor:"pointer" }}>儲存</button>
              </div>
            </div>
          ) : (
            <>
              {w.content && <div style={{ fontSize:14, color:"#211C15", whiteSpace:"pre-wrap", lineHeight:1.7 }}>{w.content}</div>}
              {((w.photos||[]).length > 0 || canEdit) && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8, alignItems:"center" }}>
                  {(w.photos||[]).map(p => thumb(p, canEdit ? (pid)=>removeEntryPhoto(w.id, pid) : null))}
                  {canEdit && (<>
                    <input id={"wlf-"+w.id} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e=>{ addPhotosToEntry(w.id, e.target.files); e.target.value=""; }} />
                    <button onClick={()=>document.getElementById("wlf-"+w.id)?.click()} style={{ width:60, height:60, borderRadius:8, border:"1px dashed #D8CFBB", background:"#FCFAF4", color:"#A99F88", fontSize:20, cursor:"pointer" }}>＋</button>
                  </>)}
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out" }}>
          <img src={lightbox.url} alt="" style={{ maxWidth:"95%", maxHeight:"95%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}

// ── 檔案庫 / 相簿 ─────────────────────────────────────────────────────────────
const PHOTO_KINDS = [["quote","估價單"],["site","現場照"],["invoice","發票"],["other","其他"]];
const photoKindLabel = (k) => (PHOTO_KINDS.find(x=>x[0]===k)||[,"其他"])[1];
const photoKindColor = { quote:"#3b82f6", site:"#3C8C3C", invoice:"#DC2626", other:"#A99F88" };
function PhotoLibraryView({ photos, setPhotos, cats, canEdit, userName, requireLogin, confirm }) {
  const [kind, setKind] = useState("site");
  const [catId, setCatId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fKind, setFKind] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [ef, setEf] = useState({});
  const [groupBy, setGroupBy] = useState("none"); // none | cat | date
  const fileRef = useRef(null);
  const sortedCats = [...cats].sort((a,b)=>a.order-b.order);

  const startEdit = (p) => { if (!canEdit) { requireLogin&&requireLogin(); return; } setEditId(p.id); setEf({ kind:p.kind, catId:p.catId||"", date:p.date||"", note:p.note||"" }); };
  const saveEdit = () => {
    setPhotos(photos.map(p => p.id===editId ? { ...p, kind:ef.kind, catId:ef.catId, catName:(cats.find(c=>c.id===ef.catId)?.name)||"", date:ef.date, note:ef.note } : p));
    setEditId(null);
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files||[]);
    if (!arr.length) return;
    setUploading(true);
    const added = [];
    for (const f of arr) {
      try {
        const { url, path } = await uploadPhoto(f);
        const cat = cats.find(c => c.id === catId);
        added.push({ id: "ph-"+Math.random().toString(36).slice(2,8), url, path, name: f.name || "檔案", mime: f.type||"", isImage: /^image\//.test(f.type), kind, catId: catId||"", catName: cat?cat.name:"", date, note, invoiceReceived: false, by: userName||"—", ts: new Date().toISOString() });
      } catch (e) { alert("上傳失敗：" + (e?.message || e)); }
    }
    if (added.length) setPhotos([...added, ...photos]);
    setNote(""); setUploading(false);
  };
  // 截圖貼上：監聽 paste，把剪貼簿圖片直接上傳
  const onPickRef = useRef(null);
  onPickRef.current = onPick;
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items || [];
      const imgs = [];
      for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); } }
      if (imgs.length) { e.preventDefault(); onPickRef.current && onPickRef.current(imgs); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);
  const toggleReceived = (id) => setPhotos(photos.map(p => p.id===id ? {...p, invoiceReceived: !p.invoiceReceived} : p));
  const del = async (p) => { if (confirm && !(await confirm("刪除這張圖片？"))) return; await deletePhotoFile(p.path); setPhotos(photos.filter(x => x.id !== p.id)); };

  const filtered = photos.filter(p => (fKind==="all"||p.kind===fKind) && (fCat==="all"||p.catId===fCat))
    .sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.ts||"").localeCompare(a.ts||""));
  const pendingInvoices = photos.filter(p => p.kind==="invoice" && !p.invoiceReceived).length;

  const selStyle = { ...inputStyle, width:"auto", padding:"6px 10px" };

  const groups = (() => {
    if (groupBy === "cat") {
      const order = [...sortedCats.map(c=>c.name), "（未指定工程）"];
      const m = {};
      filtered.forEach(p => { const k = p.catName || "（未指定工程）"; (m[k]=m[k]||[]).push(p); });
      return order.filter(k=>m[k]).map(k => ({ label: k, items: m[k] }));
    }
    if (groupBy === "date") {
      const m = {};
      filtered.forEach(p => { const k = p.date || "（無日期）"; (m[k]=m[k]||[]).push(p); });
      return Object.keys(m).sort((a,b)=>b.localeCompare(a)).map(k => ({ label: k, items: m[k] }));
    }
    return [{ label: null, items: filtered }];
  })();

  const renderCard = (p) => (
    <div key={p.id} style={{ background:"#fff", border:"1px solid #D8CFBB", borderRadius:12, overflow:"hidden", display:"flex", flexDirection:"column" }}>
      <div style={{ position:"relative", aspectRatio:"4/3", background:"#EFE7D6", cursor: p.isImage!==false?"zoom-in":"default", display:"flex", alignItems:"center", justifyContent:"center" }} onClick={()=>{ if (p.isImage!==false) setLightbox(p); }}>
        {p.isImage !== false
          ? <img src={p.url} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover" }} />
          : <a href={p.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ textAlign:"center", textDecoration:"none", color:"#6F6656", padding:"0 10px" }}>
              <div style={{ fontSize:40 }}>📄</div>
              <div style={{ fontSize:11, marginTop:4, wordBreak:"break-all", maxHeight:32, overflow:"hidden" }}>{p.name}</div>
            </a>}
        <span style={{ position:"absolute", top:6, left:6, fontSize:10, fontWeight: 600, color:"#fff", background:photoKindColor[p.kind]||"#A99F88", borderRadius:6, padding:"2px 7px" }}>{photoKindLabel(p.kind)}</span>
      </div>
      <div style={{ padding:"8px 10px", fontSize:12 }}>
        {editId === p.id ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <select value={ef.kind} onChange={e=>setEf({...ef, kind:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
            <select value={ef.catId} onChange={e=>setEf({...ef, catId:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }}><option value="">（不指定工程）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input type="date" value={ef.date} onChange={e=>setEf({...ef, date:e.target.value})} style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <input value={ef.note} onChange={e=>setEf({...ef, note:e.target.value})} placeholder="備註" style={{ ...inputStyle, padding:"5px 8px", fontSize:12 }} />
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={()=>setEditId(null)} style={{ fontSize:11, color:"#6F6656", background:"none", border:"none", cursor:"pointer" }}>取消</button>
              <button onClick={saveEdit} style={{ fontSize:11, fontWeight: 600, color:"#211C15", background:ACCENT, border:"none", borderRadius:6, padding:"4px 12px", cursor:"pointer" }}>儲存</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ color:"#4A4234", fontWeight:600 }}>{p.catName || "（未指定工程）"}</div>
            <div style={{ color:"#A99F88", fontSize:11, marginTop:2 }}>{p.date} · {p.by}</div>
            {p.note && <div style={{ color:"#6F6656", fontSize:11, marginTop:3, whiteSpace:"pre-wrap" }}>{p.note}</div>}
            {p.kind === "invoice" && (
              <label style={{ display:"flex", alignItems:"center", gap:5, marginTop:6, fontSize:12, color:p.invoiceReceived?"#16a34a":"#dc2626", fontWeight: 600, cursor:canEdit?"pointer":"default" }}>
                <input type="checkbox" checked={!!p.invoiceReceived} disabled={!canEdit} onChange={()=>canEdit&&toggleReceived(p.id)} style={{ accentColor:"#16a34a" }} />
                {p.invoiceReceived ? "✅ 發票已收到" : "⚠️ 發票未收到"}
              </label>
            )}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:"#3b82f6", textDecoration:"none" }}>⬇ 下載</a>
              {canEdit && <button onClick={()=>startEdit(p)} style={{ fontSize:11, color:"#4A4234", background:"none", border:"none", cursor:"pointer", padding:0 }}>編輯</button>}
              {canEdit && <button onClick={()=>del(p)} style={{ fontSize:11, color:"#dc2626", background:"none", border:"none", cursor:"pointer", padding:0 }}>刪除</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:12 }}>📁 檔案庫 / 相簿</div>

      {pendingInvoices > 0 && (
        <div style={{ background:"#F3E4DE", border:"1px solid #fca5a5", borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:13, color:"#dc2626", fontWeight:600 }}>
          🧾 有 {pendingInvoices} 張發票尚未確認收到（請在發票卡片勾選「已收到」）
        </div>
      )}

      {canEdit ? (
        <div style={{ background:"#fff", border:"1px solid #D8CFBB", borderRadius:12, padding:14, marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <select value={kind} onChange={e=>setKind(e.target.value)} style={selStyle}>{PHOTO_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
          <select value={catId} onChange={e=>setCatId(e.target.value)} style={selStyle}><option value="">（不指定工程）</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={selStyle} />
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="備註（選填）" style={{ ...inputStyle, flex:1, minWidth:120, padding:"6px 10px" }} />
          <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ onPick(e.target.files); e.target.value=""; }} />
          <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{ background:ACCENT, color:"#ffffff", border:"none", borderRadius:8, padding:"8px 16px", fontWeight: 600, cursor: uploading?"wait":"pointer" }}>{uploading?"上傳中…":"📎 上傳照片 / 檔案"}</button>
          <span style={{ fontSize:11, color:"#A99F88", width:"100%" }}>支援照片、PDF、Excel 等檔案；也可直接 Ctrl/⌘+V 貼上截圖</span>
        </div>
      ) : (
        <div style={{ background:"#F4EFE3", border:"1px solid #D8CFBB", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:13, color:"#6F6656" }}>🔒 唯讀模式：登入後可上傳 / 管理圖片。</div>
      )}

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12, alignItems:"center" }}>
        <span style={{ fontSize:11, color:"#A99F88" }}>類別</span>
        {[["all","全部"],...PHOTO_KINDS].map(([k,l])=>(
          <button key={k} onClick={()=>setFKind(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #D8CFBB", fontSize:11, cursor:"pointer", background:fKind===k?ACCENT:"#ECE6D7", color:fKind===k?"#ffffff":"#6F6656", fontWeight:fKind===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:11, color:"#A99F88", marginLeft:8 }}>工程</span>
        <select value={fCat} onChange={e=>setFCat(e.target.value)} style={{ ...selStyle, fontSize:12, padding:"4px 8px" }}>
          <option value="all">全部工程</option>{sortedCats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:11, color:"#A99F88" }}>分組</span>
        {[["none","不分組"],["cat","按工程"],["date","按日期"]].map(([k,l])=>(
          <button key={k} onClick={()=>setGroupBy(k)} style={{ padding:"3px 10px", borderRadius:20, border:"1px solid #D8CFBB", fontSize:11, cursor:"pointer", background:groupBy===k?ACCENT:"#ECE6D7", color:groupBy===k?"#ffffff":"#6F6656", fontWeight:groupBy===k?700:400 }}>{l}</button>
        ))}
        <span style={{ fontSize:12, color:"#A99F88", marginLeft:6 }}>共 {filtered.length} 張</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign:"center", color:"#A99F88", padding:40 }}>尚無檔案{canEdit?"，用上方按鈕上傳或貼上截圖":""}</div>
      ) : groups.map(g => (
        <div key={g.label || "all"} style={{ marginBottom: g.label ? 18 : 0 }}>
          {g.label && (
            <div style={{ fontSize:13, fontWeight: 600, color:"#4A4234", margin:"6px 0 8px", display:"flex", alignItems:"center", gap:8 }}>
              {groupBy==="date" ? "📅" : "🏗️"} {g.label}
              <span style={{ fontSize:11, color:"#A99F88", fontWeight:400 }}>（{g.items.length}）</span>
              <div style={{ height:1, flex:1, background:"#D8CFBB" }} />
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:12 }}>
            {g.items.map(renderCard)}
          </div>
        </div>
      ))}

      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:20, cursor:"zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth:"95%", maxHeight:"95%", objectFit:"contain", borderRadius:8 }} />
        </div>
      )}
    </div>
  );
}

// ── 帳號管理 ─────────────────────────────────────────────────────────────────
const ACCT_PAGES = [["data","工程資料"],["files","檔案庫"],["advisor","AI設定"]];
function AccountManager({ accounts, setAccounts, confirm }) {
  const [name, setName] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);
  const add = () => {
    const n = name.trim(); if (!n) return;
    if (n === "goodmask77" || accounts.some(a=>a.name===n)) { alert("帳號已存在"); return; }
    setAccounts([...accounts, { name:n, role: asAdmin?"admin":"normal", pages: [] }]);
    setName(""); setAsAdmin(false);
  };
  const toggleRole = (n) => setAccounts(accounts.map(a => a.name===n ? { ...a, role: a.role==="admin"?"normal":"admin" } : a));
  const togglePage = (n, pg) => setAccounts(accounts.map(a => a.name===n ? { ...a, pages: (a.pages||[]).includes(pg) ? a.pages.filter(x=>x!==pg) : [...(a.pages||[]), pg] } : a));
  const del = async (n) => { if (confirm && !(await confirm(`刪除帳號「${n}」？`))) return; setAccounts(accounts.filter(a=>a.name!==n)); };
  const chip = (active, label, onClick) => (
    <button onClick={onClick} style={{ padding:"4px 12px", borderRadius:8, border:"1px solid "+(active?ACCENT:"#D8CFBB"), background: active?"#F4EFE3":"#ECE6D7", color: active?"#6F6656":"#A99F88", fontSize:12, fontWeight: active?700:400, cursor:"pointer" }}>{label}</button>
  );

  return (
    <div style={{ maxWidth: 1100, margin: "16px auto", padding: "0 4px" }}>
      <div style={{ fontSize:18, fontWeight: 600, color:"#211C15", marginBottom:6 }}>👤 帳號管理（僅管理員）</div>
      <div style={{ background:"#faf6ee", border:"1px solid #e4ddc9", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:13, color:"#6b6450", lineHeight:1.7 }}>
        沒有帳號的人只能<b style={{color:"#b45309"}}>檢視</b>。登入後預設仍是唯讀，需由管理員在下方<b style={{color:"#b45309"}}>逐頁開放編輯權限</b>。<b>管理員</b>恆可編輯全部頁面並管理帳號。新帳號預設<b style={{color:"#b45309"}}>無任何編輯權限</b>。
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, flexWrap:"wrap" }}>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.nativeEvent.isComposing&&add()} placeholder="新帳號名稱" style={{ ...inputStyle, width:240 }} />
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#4A4234", cursor:"pointer" }}>
          <input type="checkbox" checked={asAdmin} onChange={e=>setAsAdmin(e.target.checked)} /> 設為管理員
        </label>
        <button onClick={add} disabled={!name.trim()} style={{ background:name.trim()?"#b5512b":"#D8CFBB", color:name.trim()?"#fff":"#A99F88", border:"none", borderRadius:8, padding:"9px 18px", fontWeight: 600, cursor:name.trim()?"pointer":"not-allowed" }}>＋ 新增帳號</button>
      </div>

      <div style={{ background:"#fff", border:"1px solid #D8CFBB", borderRadius:12, overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 2.4fr 40px", gap:8, padding:"10px 14px", borderBottom:"2px solid #D8CFBB", fontSize:12, fontWeight: 600, color:"#6F6656", background:"#ECE6D7" }}>
          <div>帳號</div><div>角色（點擊切換）</div><div>可編輯頁面（點擊開關）</div><div />
        </div>
        {/* 內建管理員 */}
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 2.4fr 40px", gap:8, padding:"12px 14px", borderBottom:"1px solid #EFE7D6", alignItems:"center" }}>
          <div style={{ fontWeight: 600, color:"#211C15" }}>goodmask77 <span style={{ fontSize:10, background:"#4A4234", color:"#fff", borderRadius:5, padding:"1px 6px", marginLeft:4 }}>內建</span></div>
          <div style={{ fontSize:13, color:"#4A4234" }}>管理員</div>
          <div style={{ fontSize:13, color:"#A99F88" }}>全部（內建管理員）</div>
          <div />
        </div>
        {accounts.length === 0 && <div style={{ padding:20, textAlign:"center", color:"#A99F88", fontSize:13 }}>尚無其他帳號</div>}
        {accounts.map(a => (
          <div key={a.name} style={{ display:"grid", gridTemplateColumns:"1.2fr 1fr 2.4fr 40px", gap:8, padding:"12px 14px", borderBottom:"1px solid #EFE7D6", alignItems:"center" }}>
            <div style={{ fontWeight: 600, color:"#211C15" }}>{a.name}</div>
            <div>
              <button onClick={()=>toggleRole(a.name)} style={{ background:"#ECE6D7", border:"1px solid #D8CFBB", borderRadius:8, padding:"4px 12px", fontSize:13, cursor:"pointer", color:a.role==="admin"?"#b5512b":"#4A4234", fontWeight:a.role==="admin"?700:400 }}>
                {a.role==="admin"?"管理員":"一般"} ⇄
              </button>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {a.role==="admin"
                ? <span style={{ fontSize:13, color:"#A99F88" }}>全部（管理員）</span>
                : ACCT_PAGES.map(([k,l]) => chip((a.pages||[]).includes(k), l, ()=>togglePage(a.name, k)))}
            </div>
            <button onClick={()=>del(a.name)} title="刪除帳號" style={{ background:"none", border:"none", color:"#d1d5db", cursor:"pointer", fontSize:18 }}
              onMouseEnter={e=>e.currentTarget.style.color="#DC2626"} onMouseLeave={e=>e.currentTarget.style.color="#d1d5db"}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI 代理：可執行操作的指令引擎 ───────────────────────────────────────────────
const STATUS_ALIASES = {
  "待開工":"pending","未開工":"pending","pending":"pending",
  "進行中":"inprogress","施工中":"inprogress","inprogress":"inprogress","in_progress":"inprogress",
  "完工":"done","完成":"done","已完成":"done","done":"done",
  "有問題":"issue","問題":"issue","issue":"issue",
  "暫停":"paused","paused":"paused",
};
const normStatus = (s) => STATUS_ALIASES[String(s||"").trim()] || null;
const genId = (p) => p + "-" + Math.random().toString(36).slice(2,8);
const findCat = (cats, q) => {
  if (!q) return null;
  return cats.find(c => c.name === q) || cats.find(c => c.name.includes(q) || q.includes(c.name));
};
const findItem = (cat, q) => {
  if (!cat || !q) return null;
  return cat.items.find(i => i.name === q) || cat.items.find(i => i.name.includes(q) || q.includes(i.name));
};

// 從字串中掃出所有「括號平衡」的 {...} 物件（含被截斷的外層也能撿出內層完整物件）
function extractBalancedObjects(s) {
  const out = []; const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") stack.push(i);
    else if (ch === "}") { const st = stack.pop(); if (st != null) out.push(s.slice(st, i + 1)); }
  }
  return out;
}

// 解析 AI 回覆中的指令。容錯：抓 ```json 區塊；接受 {actions:[]} / 裸{type} / 陣列；
// 並對「回覆被截斷」(沒結尾 ``` / JSON 不完整) 做搶救：逐一撿出已完整的 {type:...} 物件。
function parseActions(text) {
  if (!text) return [];
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map(m => m[1]);
  if (blocks.length === 0) {
    const m = text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (m) blocks.push(m[0]);
  }
  if (blocks.length === 0) blocks.push(text); // 連 ```json 圍欄都被截掉時，直接掃整段文字
  const actions = [];
  for (const b of blocks) {
    let ok = false;
    try {
      const obj = JSON.parse(b);
      if (Array.isArray(obj)) { actions.push(...obj); ok = true; }
      else if (Array.isArray(obj.actions)) { actions.push(...obj.actions); ok = true; }
      else if (obj && obj.type) { actions.push(obj); ok = true; }
    } catch (_) {}
    if (!ok) { // 截斷搶救：撿出每個完整的 {...}，保留帶 type 的當作指令
      for (const objStr of extractBalancedObjects(b)) {
        try { const o = JSON.parse(objStr); if (o && o.type) actions.push(o); } catch (_) {}
      }
    }
  }
  return actions;
}

// 套用指令到 cats / settings，回傳 { cats, settings, results }
function applyActions(actions, cats, settings, worklog) {
  let next = JSON.parse(JSON.stringify(cats));
  let nextSettings = settings ? { ...settings } : settings;
  let nextWorklog = Array.isArray(worklog) ? [...worklog] : [];
  const results = [];
  for (const a of actions) {
    const t = a.type;
    try {
      if (t === "clear_all") {
        next = [];
        results.push("🗑️ 已清空所有工程資料");
      } else if (t === "clear_items") {
        const n = next.reduce((s,c)=>s+c.items.length,0);
        next = next.map(c => ({ ...c, items: [] }));
        results.push(`🧹 已清空所有大項的細項（共 ${n} 筆，保留 ${next.length} 個大項）`);
      } else if (t === "clear_category_items") {
        const c = findCat(next, a.category);
        if (c) { const n = c.items.length; c.items = []; results.push(`🧹 已清空「${c.name}」的 ${n} 筆細項`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "add_category") {
        const cat = { id: genId("cat"), order: next.length, name: a.name || "新工程大項", budget: Number(a.budget)||0, status: "pending", items: [] };
        next.push(cat);
        results.push(`➕ 新增大項「${cat.name}」`);
      } else if (t === "delete_category") {
        const c = findCat(next, a.category);
        if (c) { next = next.filter(x => x.id !== c.id); results.push(`🗑️ 刪除大項「${c.name}」`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "set_category_budget") {
        const c = findCat(next, a.category);
        if (c) { c.budget = Number(a.amount)||0; results.push(`💰 「${c.name}」預算設為 ${fmt(c.budget)}`); }
        else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "set_category_status") {
        const c = findCat(next, a.category); const s = normStatus(a.status);
        if (c && s) { c.status = s; results.push(`🔖 「${c.name}」狀態設為 ${a.status}`); }
        else results.push(`⚠️ 無法設定「${a.category}」狀態`);
      } else if (t === "set_gantt") {
        const c = findCat(next, a.category);
        if (c) {
          if (a.startWeek != null) c.ganttStart = Math.max(0, Number(a.startWeek) - 1); // 使用者 1-based
          if (a.durationWeeks != null) c.ganttDur = Math.max(1, Number(a.durationWeeks));
          results.push(`📅 「${c.name}」排程：第${(c.ganttStart??0)+1}週起、${c.ganttDur??1}週`);
        } else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "add_item") {
        const c = findCat(next, a.category);
        if (c) {
          const it = { id: genId("i"), name: a.name||"新細項", qty: Number(a.qty)||1, unit: a.unit||"式", unitPrice: Number(a.unitPrice)||0, labor:0, laborDays:0, dailyWage:0, assignee: a.assignee||"", status: normStatus(a.status)||"pending", receipts:[], notes: a.notes||"", chat:[] };
          c.items.push(it);
          results.push(`➕ 「${c.name}」新增細項「${it.name}」（${fmt(it.qty*it.unitPrice)}）`);
        } else results.push(`⚠️ 找不到大項「${a.category}」`);
      } else if (t === "delete_item") {
        const c = findCat(next, a.category); const it = c && findItem(c, a.item);
        if (c && it) { c.items = c.items.filter(x => x.id !== it.id); results.push(`🗑️ 刪除「${c.name}」的「${it.name}」`); }
        else results.push(`⚠️ 找不到細項「${a.item}」`);
      } else if (t === "set_item") {
        const c = findCat(next, a.category); const it = c && findItem(c, a.item);
        if (c && it) {
          const chg = [];
          if (a.qty != null) { it.qty = Number(a.qty); chg.push(`數量${it.qty}`); }
          if (a.unit != null) { it.unit = a.unit; chg.push(`單位${it.unit}`); }
          if (a.unitPrice != null) { it.unitPrice = Number(a.unitPrice); chg.push(`單價${fmt(it.unitPrice)}`); }
          if (a.assignee != null) { it.assignee = a.assignee; chg.push(`負責人${it.assignee}`); }
          if (a.notes != null) { it.notes = a.notes; chg.push("備註"); }
          if (a.status != null) { const s=normStatus(a.status); if (s) { it.status = s; chg.push(`狀態${a.status}`); } }
          it.lastUpdated = new Date().toISOString();
          results.push(`✏️ 「${c.name}/${it.name}」更新：${chg.join("、")||"（無變更）"}`);
        } else results.push(`⚠️ 找不到細項「${a.item}」`);
      } else if (t === "set_setting") {
        if (nextSettings && a.field) { nextSettings[a.field] = a.value; results.push(`⚙️ 設定「${a.field}」已更新`); }
      } else if (t === "add_log") {
        const entry = { id: genId("wl"), date: a.date || new Date().toISOString().slice(0,10), content: a.content || "", author: a.author || "AI", ts: new Date().toISOString() };
        nextWorklog = [entry, ...nextWorklog];
        results.push(`📓 工作日誌新增（${entry.date}）：${(a.content||"").slice(0,30)}`);
      } else {
        results.push(`⚠️ 不支援的指令：${t}`);
      }
    } catch (e) {
      results.push(`⚠️ 執行「${t}」失敗`);
    }
  }
  return { cats: next, settings: nextSettings, worklog: nextWorklog, results };
}

const AGENT_GUIDE = `

你不只是顧問，你還能「直接操作」這個工程管理系統。當使用者要求你執行操作（新增/修改/刪除/清空/排程/設定金額等），請在回覆中附上一段可執行指令，格式為 markdown 的 json 區塊：

\`\`\`json
{"actions":[ ... ]}
\`\`\`

可用指令（type 與參數）：
- {"type":"clear_all"} 清空全部工程資料（含大項）
- {"type":"clear_items"} 清空所有大項的細項但「保留大項結構」（要重新上資料時用這個）
- {"type":"clear_category_items","category":"假設工程"} 只清空某大項的細項
- {"type":"add_category","name":"空調工程","budget":310000}
- {"type":"delete_category","category":"空調工程"}
- {"type":"set_category_budget","category":"空調工程","amount":310000}
- {"type":"set_category_status","category":"拆除工程","status":"進行中"}  // 狀態：待開工/進行中/完工/有問題/暫停
- {"type":"set_gantt","category":"地坪工程","startWeek":4,"durationWeeks":3}  // 第幾週開始(1起算)、持續幾週
- {"type":"add_item","category":"空調工程","name":"大金VRV主機","qty":1,"unit":"式","unitPrice":310000}
- {"type":"set_item","category":"空調工程","item":"主機","qty":2,"unitPrice":150000,"status":"進行中","assignee":"王師傅"}
- {"type":"delete_item","category":"空調工程","item":"主機"}
- {"type":"add_log","content":"今天拆除工程完成80%，廢料清運2車，明天接續隔間","date":"2026-05-31"}  // 工作日誌；date 可省略(預設今天)

規則：
1. category/item 用名稱比對（可部分名稱）。
2. 一次可放多個 action。
3. 先用一兩句白話說明你要做什麼，再附 json 區塊。
4. 只有在使用者「要求執行操作」時才附 json；單純問問題就正常回答、不要附 json。
5. 破壞性操作（清空、刪除）也照樣附指令，系統會再跟使用者確認。
6. 要「清空所有細項重新上資料」時，務必用單一 clear_items 指令，絕對不要產生大量 delete_item 逐筆刪除（會超過長度限制）。`;

const VISION_GUIDE = `

【判讀附件】若使用者提供圖片或檔案（估價單、報價單、收據、規格表、現場照片等），請仔細判讀，擷取工程項目、數量、單位、單價等資訊，並判斷對應到目前專案的哪個工程大項與細項：
- 能確定時 → 直接用 add_item / set_item / set_category_budget 等指令把資料填入，並條列你做了什麼。一張估價單可用多個 add_item 一次擷取多筆。
- 不確定對應哪個大項/細項、或數字不清楚時 → 「主動反問」使用者澄清（例如：這張估價單屬於哪個工程大項？單價是含稅嗎？），不要亂猜或填錯。
- 使用者若已用文字說明屬於哪個工程，請以使用者說明為準。`;

function GlobalAIPanel({ chat, setChat, onClose, cats, setCats, canEdit, confirm, settings, setSettings, worklog, setWorklog }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const endRef = useRef(null);
  const fileRef = useRef(null);

  const addFiles = (files) => {
    Array.from(files || []).slice(0, 5).forEach(f => {
      const isImg = /^image\//.test(f.type);
      const isPdf = f.type === "application/pdf";
      if (!isImg && !isPdf) return;
      const newId = () => Math.random().toString(36).slice(2);
      if (isPdf) {
        if (f.size > 4 * 1024 * 1024) { alert(`${f.name} 超過 4MB，無法上傳`); return; }
        const reader = new FileReader();
        reader.onload = () => { const d = String(reader.result); setAttachments(prev => [...prev, { id: newId(), kind: "pdf", media_type: "application/pdf", data: d.split(",")[1], name: f.name, preview: d }]); };
        reader.readAsDataURL(f);
        return;
      }
      // 圖片：縮放到最長邊 1568px、JPEG 0.85，避免超過上傳上限
      const img = new Image();
      img.onload = () => {
        const max = 1568;
        let { width, height } = img;
        if (width > max || height > max) { const r = Math.min(max / width, max / height); width = Math.round(width * r); height = Math.round(height * r); }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setAttachments(prev => [...prev, { id: newId(), kind: "image", media_type: "image/jpeg", data: dataUrl.split(",")[1], name: f.name, preview: dataUrl }]);
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
  };
  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    const imgs = [];
    for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };

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
      addMsg("assistant", `你好！我是宏匯 GROUN:D 工程AI顧問。\n\n目前專案包含 ${cats.length} 個工程大項，有以下幾點需要特別注意：\n\n🔴 8處「沒詳圖」項目（牆面工程含服務台）需簽約前補齊\n🔴 監督管理費 10% 偏高，建議壓至 7~8%\n🟡 弱電、招牌、家具等業主自理項目預估額外需 135~420萬\n🟡 燈具工程 $22萬為暫估，需確認上限\n\n請問有什麼我可以協助的？`);
    }
  }, []);

  const send = async () => {
    const t = input.trim();
    if (!t && attachments.length === 0) return;
    setInput("");
    const atts = attachments;
    setAttachments([]);
    addMsg("user", (t || "") + (atts.length ? `${t ? "\n" : ""}📎 已附上 ${atts.length} 個附件` : ""));
    setLoading(true);
    try {
      // 把完整專案結構給 AI，方便精準比對名稱與執行操作
      const structure = cats.map(c => `【${c.name}】預算${fmt(c.budget)} 狀態${c.status} 排程第${(c.ganttStart??0)+1}週起${c.ganttDur?` ${c.ganttDur}週`:""}；細項：${c.items.map(i=>`${i.name}(${i.qty}${i.unit}×${fmt(i.unitPrice)})`).join("、")||"無"}`).join("\n");
      const textBlock = `目前專案結構：\n${structure}\n\n使用者訊息：${t || "（請判讀附件內容）"}`;
      const history = chat.slice(-12).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      let content;
      if (atts.length) {
        content = [{ type: "text", text: textBlock }];
        atts.forEach(a => {
          if (a.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } });
          else content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
        });
      } else {
        content = textBlock;
      }
      history.push({ role: "user", content });
      const reply = await callAI(history, SYSTEM_GLOBAL + (canEdit ? (AGENT_GUIDE + VISION_GUIDE) : ""));

      // 顯示去掉 json 指令區塊後的乾淨文字
      const cleanText = reply.replace(/```json[\s\S]*?```/gi, "").trim();
      addMsg("assistant", cleanText || reply);

      // 解析並執行操作（僅管理員）
      const actions = parseActions(reply);
      if (actions.length > 0 && !canEdit) {
        addMsg("assistant", "🔒 需以管理員登入才能執行操作（目前為唯讀）。");
      } else if (actions.length > 0 && canEdit) {
        const destructive = actions.some(a => ["clear_all","clear_items","clear_category_items","delete_category","delete_item"].includes(a.type));
        let ok = true;
        if (destructive && confirm) ok = await confirm("AI 將執行包含「清空 / 刪除」的操作，確定執行嗎？");
        if (ok) {
          const { cats: newCats, settings: newSettings, worklog: newWorklog, results } = applyActions(actions, cats, settings, worklog);
          if (actions.some(a => ["clear_all","clear_items","clear_category_items","add_category","delete_category","set_category_budget","set_category_status","set_gantt","add_item","set_item","delete_item"].includes(a.type))) setCats(newCats);
          if (newSettings && setSettings && actions.some(a => a.type === "set_setting")) setSettings(newSettings);
          if (setWorklog && actions.some(a => a.type === "add_log")) setWorklog(newWorklog);
          addMsg("assistant", "✅ 已執行：\n" + results.map(r => "・" + r).join("\n"));
        } else {
          addMsg("assistant", "已取消操作。");
        }
      }
    } catch (_) {
      addMsg("assistant", "⚠️ AI連線失敗，請稍後再試。");
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 500, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "min(480px,100vw)", height: "min(680px,90vh)", background: "#ffffff", borderRadius: "16px 0 0 16px", display: "flex", flexDirection: "column", border: "1px solid #D8CFBB", borderRight: "none" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #D8CFBB", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F3E4DE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, border: `1px solid ${ACCENT}44` }}>🤖</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#211C15" }}>工程AI顧問</div>
            <div style={{ fontSize: 11, color: "#6F6656" }}>GROUN:D 專案</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4A4234", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, display: "flex", gap: 8, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: m.role === "user" ? "#3E72A8" : "#F3E4DE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {m.role === "user" ? "👤" : "🤖"}
              </div>
              <div style={{ background: m.role === "user" ? ACCENT : "#EFE7D6", border: "none", borderRadius: 12, padding: "10px 13px", maxWidth: "85%", fontSize: 13, lineHeight: 1.7, color: m.role === "user" ? "#ffffff" : "#211C15", whiteSpace: "pre-wrap" }}>
                {m.text}
                <div style={{ fontSize: 10, color: "#6F6656", marginTop: 4 }}>{m.ts}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#F3E4DE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
              <div style={{ fontSize: 13, color: ACCENT, padding: "9px 12px" }}>顧問分析中…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {/* quick prompts */}
        <div style={{ padding: "0 14px 8px", display: "flex", gap: 6, overflowX: "auto" }}>
          {["⚠️ 當前風險摘要","📋 未完成待辦","💰 預算差異分析","📅 建議工序安排"].map(q => (
            <button key={q} onClick={() => { setInput(q); setTimeout(() => document.getElementById("global-input")?.focus(),0); }} style={{ whiteSpace: "nowrap", background: "#EFE7D6", border: "1px solid #D8CFBB", color: "#6F6656", borderRadius: 20, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>{q}</button>
          ))}
        </div>
        <div style={{ padding: "0 14px 14px" }}>
          {attachments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {attachments.map(a => (
                <div key={a.id} style={{ position: "relative", width: 54, height: 54, borderRadius: 8, overflow: "hidden", border: "1px solid #D8CFBB", background: "#ECE6D7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {a.kind === "image"
                    ? <img src={a.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 10, color: "#6F6656", textAlign: "center" }}>📄<br/>PDF</span>}
                  <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#211C15", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
            <button onClick={() => fileRef.current?.click()} title="上傳圖片 / 估價單 / PDF" style={{ background: "#EFE7D6", border: "1px solid #D8CFBB", borderRadius: 8, padding: "0 12px", height: 40, cursor: "pointer", fontSize: 16, color: "#4A4234", flexShrink: 0 }}>📎</button>
            <textarea id="global-input" value={input} onChange={e => setInput(e.target.value)} onPaste={onPaste} rows={2} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} placeholder="輸入、貼上截圖，或上傳估價單…（Enter 送出 · Shift+Enter 換行）" style={{ ...inputStyle, flex: 1, margin: 0, resize: "vertical", height: "auto", maxHeight: 160, overflowY: "auto", lineHeight: 1.5, fontFamily: "inherit" }} />
            <button onClick={send} disabled={loading || (!input.trim() && attachments.length === 0)} style={{ background: ACCENT, border: "none", borderRadius: 8, padding: "0 16px", height: 40, color: "#ffffff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontSize: 14, opacity: loading ? 0.6 : 1, flexShrink: 0 }}>送</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SIDE PANEL ─────────────────────────────────────────────────────────────────
function SidePanel({ onClose, children, wide }) {
  const isMobile = useIsMobile();
  const [dragY, setDragY] = useState(0);
  const startY = useRef(null);

  // 手機：從底部彈出的 bottom sheet（拖曳柄可下拉關閉）
  if (isMobile) {
    const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
    const onTouchMove = (e) => { if (startY.current != null) { const dy = e.touches[0].clientY - startY.current; if (dy > 0) setDragY(dy); } };
    const onTouchEnd = () => { if (dragY > 90) onClose(); else setDragY(0); startY.current = null; };
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 400, display: "flex", alignItems: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={{ width: "100%", maxHeight: "90vh", background: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflowY: "auto", display: "flex", flexDirection: "column", animation: "sheetUp .22s ease", transform: dragY ? `translateY(${dragY}px)` : "none", transition: dragY ? "none" : "transform .2s", paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -8px 30px rgba(0,0,0,0.25)" }}>
          <div onClick={onClose} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} title="下拉或點此關閉" style={{ padding: "11px 0 7px", display: "flex", justifyContent: "center", cursor: "pointer", position: "sticky", top: 0, background: "#fff", zIndex: 10, touchAction: "none", borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
            <div style={{ width: 42, height: 5, borderRadius: 3, background: "#D8CFBB" }} />
          </div>
          <div style={{ padding: "2px 16px 20px", flex: 1 }}>{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 400, display: "flex", justifyContent: "flex-end" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: wide ? "min(600px,100vw)" : "min(440px,100vw)", background: "#ffffff", height: "100vh", overflowY: "auto", borderLeft: "1px solid #D8CFBB", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #D8CFBB", display: "flex", alignItems: "center", justifyContent: "flex-end", position: "sticky", top: 0, background: "#ffffff", zIndex: 10 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#4A4234", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
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
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 4 }}>{label}</div>
      {readOnly ? (
        <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: accent ? ACCENT : "#211C15", padding: "6px 0" }}>{value}</div>
      ) : multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, height: 72, resize: "vertical" }} />
      ) : isNum ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6F6656" }}>{prefix}</span>}
          <input
            type="text"
            inputMode="decimal"
            value={local}
            onChange={e => { if (/^-?\d*\.?\d*$/.test(e.target.value) || e.target.value === "") setLocal(e.target.value); }}
            onBlur={() => { const n = parseFloat(local); const v = isNaN(n) ? 0 : n; committed.current = v; setLocal(String(v)); onChange(v); }}
            onFocus={e => e.target.select()}
            style={{ ...inputStyle, flex: 1 }}
          />
          {suffix && <span style={{ fontSize: 11, color: "#6F6656" }}>{suffix}</span>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {prefix && <span style={{ fontSize: 11, color: "#6F6656" }}>{prefix}</span>}
          <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          {suffix && <span style={{ fontSize: 11, color: "#6F6656" }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: "#EFE7D6",
  border: "1px solid #D8CFBB",
  borderRadius: 8,
  color: "#211C15",
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
  outline: "none",
  fontFamily: "'Noto Sans TC', sans-serif",
};
