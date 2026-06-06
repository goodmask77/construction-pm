import { useState, useEffect, useRef, useCallback, Fragment } from "react";
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
  // 折% 套在未稅層；固定折讓＝直接從含稅原報價扣（省＝你輸入的金額），上限為含稅原報價
  const sub = catRawEst(cat); // 折讓上限／百分比換算的基準改用含稅原報價
  const mode = cat?.discountMode === "amt" ? "amt" : "pct";
  const v = Number(cat?.discountValue) || 0;
  if (v <= 0 || sub <= 0) return { hasDiscount: false, factor: 1, pct: 0, amt: 0, mode, value: v, sub };
  let factor = 1, pct = 0, amt = 0;
  if (mode === "amt") { amt = Math.min(Math.max(v, 0), sub); factor = (sub - amt) / sub; pct = amt / sub * 100; }
  else { pct = Math.min(Math.max(v, 0), 100); factor = 1 - pct / 100; amt = sub * pct / 100; }
  return { hasDiscount: factor < 1, factor, pct, amt, mode, value: v, sub };
};
// 議價後含稅＝原報價含稅 × factor（百分比折扣與未稅層折扣在數學上等價，直接乘可避免逐筆進位誤差，
// 讓「省 = 原報價 × 折%」跟計算機一致；factor 已含固定折讓換算）
const catEstAfter = (cat) => {
  const { factor } = catDiscount(cat);
  if (factor === 1) return catRawEst(cat);
  return Math.round(catRawEst(cat) * factor);
};
const catSaved = (cat) => catRawEst(cat) - catEstAfter(cat);
// 逐筆「議價後預估金額」：各細項按 factor 打折，進位殘差塞給最後一筆 → Σ 細項 = 大項議價後
const catItemEstAfter = (cat) => {
  const map = {};
  const d = catDiscount(cat);
  const items = cat?.items || [];
  if (!d.hasDiscount) { items.forEach(it => { map[it.id] = estAmount(it); }); return map; }
  const target = catEstAfter(cat);
  let acc = 0;
  items.forEach(it => { const v = Math.round(estAmount(it) * d.factor); map[it.id] = v; acc += v; });
  const last = items[items.length - 1];
  if (last) map[last.id] += (target - acc);
  return map;
};
// ── 大項（廠商）層級付款紀錄：已付＝該大項所有付款紀錄金額加總 ──────────────────
const PAY_CATEGORIES = ["訂金", "期中款", "尾款", "其他"];
const catPaid = (cat) => (cat?.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
const catUnpaidAfter = (cat) => catEstAfter(cat) - catPaid(cat);
// 一次性遷移：
// 1) 沒有 payments 的大項，把舊的逐項已付總和轉成一筆「既有付款」紀錄（已付總額不變）
// 2) 清掉第一版殘留的 cat.budget（App 已改用議價後即時值，此欄不再使用，留著會讓 AI/bot 報出空殼金額）
function migratePayments(cats) {
  if (!Array.isArray(cats)) return cats;
  let changed = false;
  const out = cats.map(c => {
    let next = c;
    if (!Array.isArray(c.payments)) {
      const sumPaid = (c.items || []).reduce((s, it) => s + (Number(it.paid ?? it.cust?.paid) || 0), 0);
      const payments = sumPaid > 0
        ? [{ id: "pay-legacy-" + c.id, date: "", amount: sumPaid, category: "其他", note: "既有付款（系統轉入）", receipts: [] }]
        : [];
      next = { ...next, payments };
      changed = true;
    }
    if (next.budget) { // 非 0 的舊 budget → 清成 0
      next = { ...next, budget: 0 };
      changed = true;
    }
    return next;
  });
  return changed ? out : cats;
}

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
  ["daily",   "每日工地速報（早上 8:00 推送）"],
  ["issue",   "細項狀態變為「有問題」時通知"],
  ["done",    "細項狀態變為「完工」時通知"],
  ["stalled", "卡關超過 3 天提醒"],
  ["weekly",  "AI 週報每週五自動推送"],
  ["due",     "排程任務截止日提醒"],
  ["journal", "新工作日誌建立時通知"],
];
async function _lineSettings() {
  try { const r = await window.storage.get(K("pm_settings"), true); return r && r.value ? JSON.parse(r.value) : {}; } catch { return {}; }
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
// ── 工作空間（多空間隔離）──────────────────────────────────────────────────
// 預設空間＝construction，沿用原本的 key（零遷移）；其他空間一律加前綴 sp_<id>_
// 全域 key（跨空間共用）：使用者身分、空間設定本身
const SPACES = [
  { id: "construction", name: "工程專案", icon: "🏗" },
  { id: "team",         name: "團隊工作", icon: "👥" },
  { id: "crew",         name: "夥伴中心", icon: "🤝" },
];
// 每個空間的外觀客製（顯示成本與否、隱藏分頁、名詞、AI 角色、專屬分頁）
const SPACE_CONF = {
  construction: {
    showCost: true,
    hideTabs: [],
    labels: { cat: "工程大項", item: "細項", overview: "總覽", gantt: "工序", subtitle: "成本費用明細" },
    aiRole: null, // 用原本的工程顧問提示
  },
  team: {
    showCost: false,
    hideTabs: ["compare"], // 團隊不需要比價
    labels: { cat: "專案/群組", item: "任務", overview: "任務板", gantt: "進度", subtitle: "團隊任務追蹤" },
    aiRole: "你是團隊專案協作助理，協助追蹤每個人的任務進度、彙整待辦與提醒、整理會議與決策。請用繁體中文、簡潔專業，必要時條列重點。",
  },
  crew: {
    showCost: false,
    hideTabs: [],
    tabs: [["kb", "資料庫", "📚"], ["r360", "360評鑑", "⭐"], ["fb", "回饋", "💬"], ["quest", "闖關", "🎮"], ["poll", "投票", "🗳"], ["shop", "商城", "🎁"], ["rank", "排行榜", "🏆"]], // 夥伴中心專屬分頁
    defaultView: "kb",
    hideKpi: true, // 夥伴中心頂部不顯示工程 KPI
    labels: { cat: "項目", item: "項目", overview: "資料庫", gantt: "進度", subtitle: "夥伴中心" },
    aiRole: "你是餐飲團隊的夥伴中心助理，協助夥伴查找內外場 SOP/手冊/教學等資料、解答工作問題。請用繁體中文、親切清楚。",
  },
};
const conf = () => SPACE_CONF[CURRENT_SPACE] || SPACE_CONF.construction;
const L = (key) => conf().labels[key] || SPACE_CONF.construction.labels[key];
const COST_COL_IDS = new Set(["estQty", "unit", "estUnitPrice", "taxType", "taxAmount", "estTotal", "payAccount", "payDate"]);
const GLOBAL_KEYS = new Set(["pm_role", "pm_known_users", "pm_current_space"]);
let CURRENT_SPACE = "construction";
try { CURRENT_SPACE = localStorage.getItem("pm_current_space") || "construction"; } catch (_) {}
if (!SPACES.some(s => s.id === CURRENT_SPACE)) CURRENT_SPACE = "construction";
// 邏輯 key → 實體 key（依目前空間）
const K = (key) => (CURRENT_SPACE === "construction" || GLOBAL_KEYS.has(key)) ? key : `sp_${CURRENT_SPACE}_${key}`;
const switchSpace = (id) => { try { localStorage.setItem("pm_current_space", id); } catch (_) {} window.location.reload(); };

async function loadData() {
  try {
    const r = await window.storage.get(K("pm_data"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveData(cats) {
  try {
    await window.storage.set(K("pm_data"), JSON.stringify(cats), true);
  } catch (_) {}
}
async function loadGlobalChat() {
  try {
    const r = await window.storage.get(K("pm_global_chat"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveGlobalChat(msgs) {
  try {
    await window.storage.set(K("pm_global_chat"), JSON.stringify(msgs), true);
  } catch (_) {}
}

async function loadSettings() {
  try {
    const r = await window.storage.get(K("pm_settings"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return null;
}
async function saveSettings(s) {
  try { await window.storage.set(K("pm_settings"), JSON.stringify(s), true); } catch (_) {}
}
async function loadRole() {
  try { const r = await window.storage.get(K("pm_role"), false); if (r&&r.value) return r.value; } catch(_){}
  return null;
}
async function saveRole(role) {
  try { await window.storage.set(K("pm_role"), role, false); } catch(_){}
}
async function loadActivityLog() {
  try { const r = await window.storage.get(K("pm_activity"), true); if (r&&r.value) return JSON.parse(r.value); } catch(_){}
  return [];
}
async function saveActivityLog(log) {
  try { await window.storage.set(K("pm_activity"), JSON.stringify(log.slice(-200)), true); } catch(_){}
}
async function loadAILog() {
  try {
    const r = await window.storage.get(K("pm_ai_log"), true);
    if (r && r.value) return JSON.parse(r.value);
  } catch (_) {}
  return [];
}
async function saveAILog(log) {
  try { await window.storage.set(K("pm_ai_log"), JSON.stringify(log), true); } catch (_) {}
}

// ── AI CALL ───────────────────────────────────────────────────────────────────
// ── AI 用量／估算花費 ───────────────────────────────────────────────────────
// 模型單價（USD / 每百萬 tokens，[輸入, 輸出]）；找不到對應就用 default。可日後微調。
const MODEL_PRICES = [
  [/opus/i,            [15, 75]],
  [/haiku/i,           [1, 5]],
  [/sonnet/i,          [3, 15]],
  [/claude-3-5-sonnet/i, [3, 15]],
];
const PRICE_DEFAULT = [3, 15];
const USD_TWD = 32.5; // 估算匯率（USD→TWD，可日後調整）
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

async function callAI(messages, systemPrompt, kind = "chat") {
  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system: systemPrompt }),
    });
    const data = await res.json();
    if (!res.ok) return data.error || "（AI 顧問尚未設定，請於 Vercel 加入 ANTHROPIC_API_KEY）";
    if (data.usage) recordAIUsage(data.model, data.usage, kind); // 記錄用量＋用途（不阻塞回覆）
    return data.content?.map(b => b.text || "").join("") || "（AI無回應）";
  } catch (e) {
    return "（AI 連線失敗，請稍後再試）";
  }
}
const KIND_LABEL = { chat: "AI 顧問對話", import: "PDF/估價單匯入", weekly: "AI 週報", compare: "估價單比價", tidy: "日誌整理" };

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
  const totalAct = cats.reduce((s,c) => s+catPaid(c),0); // 已付總額（大項付款紀錄）
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

const SYSTEM_ITEM = (catName, itemName) => `你是一位專業餐廳裝修工程顧問。目前討論的工程項目是：【${catName}】中的【${itemName}】。請針對此具體項目提供專業建議，包括施工要點、常見問題、驗收標準、市場行情等。用繁體中文回答。`;

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [cats, setCats] = useState(null);
  const [view, setView] = useState(conf().defaultView || "gantt"); // 預設工序頁（夥伴中心預設資料庫）
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
    window.storage.set(K("pm_worklog"), JSON.stringify(list), true).catch(()=>{});
  };
  // 檔案庫照片：metadata 存共享後端（圖片本體在 Supabase Storage）
  const commitPhotos = (list) => {
    setPhotos(list);
    window.storage.set(K("pm_photos"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitAccounts = (list) => {
    setAccounts(list);
    window.storage.set(K("pm_accounts"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitCustomCols = (list) => {
    setCustomCols(list);
    window.storage.set(K("pm_columns"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitColOrder = (list) => {
    setColOrder(list);
    window.storage.set(K("pm_colorder"), JSON.stringify(list), true).catch(()=>{});
  };
  const commitSeqLogs = (list) => {
    setSeqLogs(list);
    window.storage.set(K("pm_seqlogs"), JSON.stringify(list), true).catch(()=>{});
  };

  // load — 全部 key 平行載入（不再一個一個排隊），大幅縮短開啟時間
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const getV = (k) => window.storage.get(K(k), true).then(r => (r && r.value) ? r.value : null).catch(() => null);
      const parse = (v, def) => { if (!v) return def; try { return JSON.parse(v); } catch (_) { return def; } };
      const [d, gc, sv, log, savedName, kuV, alog, wlV, phV, acV, slV, ccV, evV, jnV, plV] = await Promise.all([
        loadData(), loadGlobalChat(), loadSettings(), loadAILog(), loadRole(),
        getV("pm_known_users"), loadActivityLog(),
        getV("pm_worklog"), getV("pm_photos"), getV("pm_accounts"), getV("pm_seqlogs"),
        getV("pm_columns"), getV("pm_events"), getV("pm_journal"), getV("pm_plans"),
      ]);
      if (cancelled) return;

      const seed = CURRENT_SPACE === "construction" ? INITIAL_CATEGORIES : [];
      const migrated = migratePayments(d || seed);
      setCats(migrated);
      if (migrated !== (d || seed)) saveData(migrated);

      setGlobalChat(gc);
      const defSettings = CURRENT_SPACE === "construction"
        ? { projectName:"宏匯 GROUN:D", projectAddress:"台北市內湖區瑞光路337號", ownerName:"", contractorName:"碩藝室內裝修有限公司", targetDate:"", notes:"", priorities:[], dailyCheckEnabled:false, lineGroupId: DEFAULT_LINE_GROUP, lineNotify: {} }
        : { projectName: SPACES.find(s=>s.id===CURRENT_SPACE)?.name || "工作空間", projectAddress:"", ownerName:"", contractorName:"", targetDate:"", notes:"", priorities:[], dailyCheckEnabled:false, lineGroupId:"", lineNotify: {} };
      setSettings(sv && Object.keys(sv).length ? sv : defSettings);
      setAiLog(log);
      if (savedName) setUserName(savedName);

      // 未登入 → 訪客唯讀瀏覽（不強制登入）
      const kuArr = parse(kuV, null);
      if (Array.isArray(kuArr)) { const arr = kuArr.filter(u => u !== ADMIN_USER); setKnownUsers(arr); window.storage.set(K("pm_known_users"), JSON.stringify(arr), true).catch(()=>{}); }
      else setKnownUsers([]);

      setActivityLog(alog);
      if (wlV) setWorklog(parse(wlV, []));
      if (phV) setPhotos(parse(phV, []));
      if (acV) setAccounts(parse(acV, []));
      if (slV) setSeqLogs(parse(slV, []));
      if (evV) setEvents(parse(evV, []));
      if (jnV) setJournal(parse(jnV, []));
      if (plV) setPlans(parse(plV, []));

      // 統一欄位：以新版內建欄重建 + 保留真正的自訂欄
      try {
        const builtins = COLS.map(c => ({ id:c.id, label:c.label, builtin:true, fixed: !!c.fixed, w:c.w }));
        const builtinIds = new Set(COLS.map(c => c.id));
        const customs = parse(ccV, []).filter(c => c.builtin === false && !builtinIds.has(c.id) && c.label !== "稅金");
        const merged = [...builtins, ...customs];
        setCustomCols(merged);
        window.storage.set(K("pm_columns"), JSON.stringify(merged), true).catch(()=>{});
      } catch(_){}
    })();
    return () => { cancelled = true; };
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
      window.storage.set(K("pm_events"), JSON.stringify(next), true).catch(()=>{});
      return next;
    });
  };
  const setJournalLogged = (updater) => {
    setJournal(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set(K("pm_journal"), JSON.stringify(next.slice(0,500)), true).catch(()=>{});
      return next;
    });
  };
  const setPlansLogged = (updater) => {
    setPlans(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      window.storage.set(K("pm_plans"), JSON.stringify(next), true).catch(()=>{});
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
  const totalPaid = cats ? cats.reduce((s, c) => s + catPaid(c), 0) : 0; // 已付總額（大項付款紀錄）
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
    if (l.id) commitSeqLogs(seqLogs.map(x => x.id===l.id ? { ...l, updated_at:new Date().toISOString(), updated_by: userName||"—" } : x));
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
  const seqUploadPhotos = async (files) => { const out=[]; for (const f of files) { try { const { url } = await uploadPhoto(f); out.push({ url, name: f.name || "檔案", isImage: !!(f.type || "").startsWith("image/") }); } catch(_){} } return out; };
  const seqAiTidy = async (f) => {
    const draft = [f.done && `已完成：${f.done}`, f.issue && `問題：${f.issue}`, f.next && `明日：${f.next}`].filter(Boolean).join("\n") || "（無草稿）";
    const reply = await callAI([{ role:"user", content:`請把以下工地日誌草稿整理成一段精簡通順的施工紀錄（繁體中文、一段話、不要條列、不要開場白）：\n${draft}` }], "你是工程現場記錄助理。", "tidy");
    return (reply||"").replace(/```[\s\S]*?```/g,"").trim();
  };
  const seqAiWeekly = async (weekLogs) => {
    const lines = weekLogs.map(l => `${l.date} ${seqItems.find(i=>i.id===l.itemId)?.name||""}：${l.done||l.next||""}${l.issue?`（問題：${l.issue}）`:""}`).join("\n") || "（本週無紀錄）";
    return await callAI([{ role:"user", content:`以下是本週各工序施工日誌，請產生給業主看的本週進度週報（繁體中文，淺顯，含：本週完成、進行中、問題/待決、下週預計、整體評估🟢/🟡/🔴）：\n${lines}` }], "你是餐廳裝修工程顧問，為業主寫週報。", "weekly");
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
        {view === "kb" && (
          <KnowledgeBaseView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} userName={userName} />
        )}
        {view === "r360" && (
          <Review360View canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "fb" && (
          <FeedbackView canEdit={canEditData} requireLogin={denyEdit} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "quest" && (
          <QuestView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "poll" && (
          <PollView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "shop" && (
          <ShopView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} isAdmin={isAdmin} userName={userName} />
        )}
        {view === "rank" && (
          <CrewRankView />
        )}
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
        {view === "issues" && (
          <IssuesView canEdit={canEditData} requireLogin={denyEdit} confirm={confirm} />
        )}
        {view === "compare" && (
          <CompareView canEdit={canEditFiles} requireLogin={denyEdit} />
        )}
        {view === "accounts" && isAdmin && (
          <AccountManager accounts={accounts} setAccounts={commitAccounts} confirm={confirm} />
        )}
        {view === "groups" && isAdmin && (
          <GroupsView cats={cats} canEdit={canEditData} requireLogin={denyEdit} settings={settings} setSettings={guardedSetSettings} journal={journal} events={events} plans={plans} />
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
              await window.storage.set(K("pm_known_users"), JSON.stringify(updated), true);
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
      {isMobile && <BottomNav view={view} setView={setView} isAdmin={isAdmin} />}
    </div>
  );
}

// ── 夥伴中心：資料庫 / 知識庫（內外場 SOP、手冊、教學…）─────────────────────────
const KB_DEFAULT_CATS = ["內場", "外場", "通用", "教育訓練"];
const kbIcon = (d) => d.kind === "link" ? "🔗" : d.kind === "text" ? "📝" : (d.isImage ? "🖼️" : (/\.pdf$/i.test(d.name || "") ? "📕" : /\.(xls|xlsx|csv)$/i.test(d.name || "") ? "📊" : "📄"));
function KnowledgeBaseView({ canEdit, requireLogin, confirm, userName }) {
  const [docs, setDocs] = useState(null);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("全部");
  const [edit, setEdit] = useState(null); // 正在編輯/新增的 doc
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const safety = setTimeout(() => setDocs(prev => prev === null ? [] : prev), 8000);
    (async () => {
      try { const r = await window.storage.get(K("kb_docs"), true); setDocs(r && r.value ? JSON.parse(r.value) : []); }
      catch (_) { setDocs([]); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const persist = async (list) => { setDocs(list); try { await window.storage.set(K("kb_docs"), JSON.stringify(list), true); } catch (_) {} };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const cats = [...new Set([...KB_DEFAULT_CATS, ...(docs || []).map(d => d.category).filter(Boolean)])];

  const blank = () => ({ id: "", category: KB_DEFAULT_CATS[0], title: "", kind: "link", url: "", name: "", content: "", tags: "", pinned: false });
  const openNew = () => { if (!guard()) return; setEdit(blank()); };
  const openEdit = (d) => { if (!guard()) return; setEdit({ ...d, tags: (d.tags || []).join(", ") }); };
  const saveDoc = () => {
    const e = edit; if (!e.title.trim()) { alert("請填標題"); return; }
    const doc = { id: e.id || "kb-" + Math.random().toString(36).slice(2, 8), category: e.category, title: e.title.trim(), kind: e.kind, url: e.url || "", name: e.name || "", isImage: !!e.isImage, content: e.content || "", tags: (e.tags || "").split(/[,，]/).map(t => t.trim()).filter(Boolean), pinned: !!e.pinned, updatedBy: userName || "—", updatedAt: new Date().toISOString() };
    const list = e.id ? (docs || []).map(d => d.id === e.id ? doc : d) : [doc, ...(docs || [])];
    persist(list); setEdit(null);
  };
  const delDoc = async (d) => { if (!guard()) return; if (await confirm(`刪除「${d.title}」？`)) persist((docs || []).filter(x => x.id !== d.id)); };
  const togglePin = (d) => { if (!guard()) return; persist((docs || []).map(x => x.id === d.id ? { ...x, pinned: !x.pinned } : x)); };
  const uploadFile = async (files) => {
    const f = (files || [])[0]; if (!f) return;
    setBusy(true);
    try { const { url } = await uploadPhoto(f); setEdit(e => ({ ...e, kind: "file", url, name: f.name, isImage: !!(f.type || "").startsWith("image/") })); }
    catch (er) { alert("上傳失敗：" + (er?.message || er)); }
    setBusy(false);
  };

  const filtered = (docs || [])
    .filter(d => catFilter === "全部" || d.category === catFilter)
    .filter(d => { if (!q.trim()) return true; const s = (d.title + " " + (d.tags || []).join(" ") + " " + (d.content || "")).toLowerCase(); return s.includes(q.trim().toLowerCase()); })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (docs === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const inputS = { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, outline: "none", background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>📚 資料庫</div>
        <div style={{ fontSize: 12.5, color: SUB }}>內外場 SOP・手冊・教學（{docs.length}）</div>
        <div style={{ flex: 1 }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 搜尋標題／標籤…" style={{ ...inputS, width: 220, maxWidth: "50vw" }} />
        {canEdit && <button onClick={openNew} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ 新增</button>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {["全部", ...cats].map(c => (
          <button key={c} onClick={() => setCatFilter(c)} style={{ border: `1px solid ${catFilter === c ? PRIMARY : BORDER}`, background: catFilter === c ? PRIMARY : "transparent", color: catFilter === c ? "#fff" : TEXT, borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>{c}</button>
        ))}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: "center", color: "#A99F88", padding: "50px 0", fontSize: 14 }}>{docs.length === 0 ? "還沒有資料，點「＋ 新增」開始建立。" : "沒有符合的資料。"}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {filtered.map(d => (
          <div key={d.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 6, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>{kbIcon(d)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: TEXT, wordBreak: "break-word" }}>{d.pinned && "📌 "}{d.title}</div>
                <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}><span style={{ background: "#F3E4DE", color: "#92400e", borderRadius: 8, padding: "1px 7px" }}>{d.category}</span>{d.tags?.length > 0 && <span style={{ marginLeft: 6 }}>{d.tags.map(t => "#" + t).join(" ")}</span>}</div>
              </div>
            </div>
            {d.kind === "text" && d.content && <div style={{ fontSize: 13, color: "#4A4234", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflowY: "auto", background: "#FBF7EE", borderRadius: 8, padding: "8px 10px" }}>{d.content}</div>}
            {(d.kind === "link" || d.kind === "file") && d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#2E6FB0", textDecoration: "none", wordBreak: "break-all" }}>{d.kind === "file" ? `📎 ${d.name || "開啟檔案"}` : "🔗 開啟連結"}</a>}
            {canEdit && <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 12 }}>
              <button onClick={() => togglePin(d)} style={{ border: "none", background: "none", color: d.pinned ? ACCENT : SUB, cursor: "pointer", padding: 0 }}>{d.pinned ? "取消置頂" : "置頂"}</button>
              <button onClick={() => openEdit(d)} style={{ border: "none", background: "none", color: SUB, cursor: "pointer", padding: 0 }}>編輯</button>
              <button onClick={() => delDoc(d)} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", padding: 0 }}>刪除</button>
              <div style={{ flex: 1 }} /><span style={{ color: "#C8BCA0" }}>{d.updatedBy}</span>
            </div>}
          </div>
        ))}
      </div>

      {edit && (
        <div onClick={e => e.target === e.currentTarget && setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 14 }}>{edit.id ? "編輯資料" : "新增資料"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>標題</div><input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} style={inputS} placeholder="例：外場點餐 SOP" /></div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>分類</div>
                  <input list="kb-cats" value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} style={inputS} />
                  <datalist id="kb-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
                </div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>類型</div>
                  <select value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })} style={inputS}>
                    <option value="link">🔗 連結</option><option value="file">📎 檔案</option><option value="text">📝 純文字</option>
                  </select>
                </div>
              </div>
              {edit.kind === "link" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>連結網址</div><input value={edit.url} onChange={e => setEdit({ ...edit, url: e.target.value })} style={inputS} placeholder="https://…" /></div>}
              {edit.kind === "file" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>檔案</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>{busy ? "上傳中…" : "選擇檔案"}</button>
                  {edit.name && <span style={{ fontSize: 12, color: TEXT }}>📎 {edit.name}</span>}
                  <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => { uploadFile(e.target.files); e.target.value = ""; }} />
                </div></div>}
              {edit.kind === "text" && <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>內容</div><textarea value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} style={{ ...inputS, height: 140, resize: "vertical", fontFamily: "inherit" }} placeholder="直接輸入內容…" /></div>}
              <div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>標籤（逗號分隔）</div><input value={edit.tags} onChange={e => setEdit({ ...edit, tags: e.target.value })} style={inputS} placeholder="例：點餐, 新人必讀" /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={edit.pinned} onChange={e => setEdit({ ...edit, pinned: e.target.checked })} />📌 置頂</label>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEdit(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={saveDoc} disabled={busy} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 夥伴中心：360 評鑑（設計原型；正式版接 Auth+正規表+權限/匿名）─────────────────
const R360_DEFAULT_DIMS = ["工作態度", "團隊合作", "專業技能", "服務品質", "責任感", "學習成長"];
function Review360View({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [data, setData] = useState(null); // {dimensions, people, reviews}
  const [tab, setTab] = useState("fill"); // fill | result | setup
  const [me, setMe] = useState("");
  const [rate, setRate] = useState(null); // 正在評的對象 {revieweeId, scores, comment}
  const [resultId, setResultId] = useState("");

  useEffect(() => {
    const safety = setTimeout(() => setData(prev => prev || emptyR360()), 8000);
    (async () => {
      try { const r = await window.storage.get(K("kb_360"), true); const d = r && r.value ? JSON.parse(r.value) : null; const nd = normR360(d); setData(nd); setMe(meFromRoster(nd.people, userName)); }
      catch (_) { setData(emptyR360()); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  function emptyR360() { return { dimensions: R360_DEFAULT_DIMS.map((l, i) => ({ id: "d" + i, label: l })), people: [], reviews: [] }; }
  function normR360(d) { if (!d) return emptyR360(); return { dimensions: d.dimensions?.length ? d.dimensions : emptyR360().dimensions, people: d.people || [], reviews: d.reviews || [] }; }
  const persist = async (next) => { setData(next); try { await window.storage.set(K("kb_360"), JSON.stringify(next), true); } catch (_) {} };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };

  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const { dimensions, people, reviews } = data;
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";

  // 儲存一筆評鑑（同一人評同一人＝覆蓋）
  const submitRate = () => {
    if (!me) { alert("請先在上方選「我是誰」"); return; }
    const r = rate;
    const review = { id: "rv-" + me + "-" + r.revieweeId, reviewerId: me, revieweeId: r.revieweeId, scores: r.scores, comment: (r.comment || "").trim(), ts: new Date().toISOString() };
    const others = reviews.filter(x => !(x.reviewerId === me && x.revieweeId === r.revieweeId));
    persist({ ...data, reviews: [...others, review] });
    setRate(null);
  };
  const myReviewOf = (revId) => reviews.find(x => x.reviewerId === me && x.revieweeId === revId);

  // 結果彙整
  const agg = (revieweeId) => {
    const others = reviews.filter(x => x.revieweeId === revieweeId && x.reviewerId !== revieweeId);
    const self = reviews.find(x => x.reviewerId === revieweeId && x.revieweeId === revieweeId);
    const perDim = dimensions.map(dim => {
      const vals = others.map(r => Number(r.scores?.[dim.id])).filter(v => v > 0);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      return { dim, avg, selfV: self ? Number(self.scores?.[dim.id]) || null : null, n: vals.length };
    });
    const allVals = others.flatMap(r => dimensions.map(d => Number(r.scores?.[d.id])).filter(v => v > 0));
    const overall = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : null;
    const comments = others.map(r => r.comment).filter(Boolean);
    return { perDim, overall, comments, count: others.length, hasSelf: !!self };
  };

  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, label) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>⭐ 360 評鑑</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>這是預覽版：用下方「我是誰」模擬身分、資料先存本機。正式版會接真帳號＋權限＋匿名保護。</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {subTab("fill", "📝 我要評")}{subTab("result", "📊 看結果")}{isAdmin && subTab("setup", "⚙ 設定")}
      </div>

      {tab === "fill" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <CrewMe people={people} me={me} />
          {people.length === 0 && <span style={{ fontSize: 12, color: "#C2872E" }}>請先到「設定」加入夥伴名單</span>}
        </div>
        {me && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {people.map(p => { const done = !!myReviewOf(p.id); const isSelf = p.id === me; return (
            <button key={p.id} onClick={() => setRate({ revieweeId: p.id, scores: myReviewOf(p.id)?.scores || {}, comment: myReviewOf(p.id)?.comment || "" })}
              style={{ textAlign: "left", background: "#fff", border: `1px solid ${done ? "#3C8C3C" : BORDER}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#F3E4DE", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{p.name?.[0] || "?"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{p.name}{isSelf && <span style={{ fontSize: 11, color: SUB }}> · 自評</span>}</div>
                <div style={{ fontSize: 11, color: SUB }}>{p.dept || "—"}</div>
              </div>
              <span style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C8BCA0", fontWeight: 600 }}>{done ? "✓ 已評" : "待評"}</span>
            </button>
          ); })}
        </div>}
      </>)}

      {tab === "result" && (<>
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: SUB }}>看誰的結果：</span>
          <select value={resultId} onChange={e => setResultId(e.target.value)} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "7px 10px", fontSize: 14, background: "#fff", color: TEXT, minWidth: 140 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {resultId && (() => { const a = agg(resultId); return (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{nameOf(resultId)}</div>
              <div style={{ fontSize: 13, color: SUB }}>他評 {a.count} 人{a.hasSelf ? " · 含自評" : ""}</div>
              <div style={{ flex: 1 }} />
              {a.overall != null && <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{a.overall.toFixed(1)}<span style={{ fontSize: 12, color: SUB, fontWeight: 400 }}> /5</span></div>}
            </div>
            {a.count === 0 && <div style={{ fontSize: 13, color: "#A99F88", padding: "10px 0" }}>還沒有人評過這位夥伴。</div>}
            {a.perDim.map(({ dim, avg, selfV, n }) => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", fontSize: 13, marginBottom: 4 }}><span style={{ color: TEXT, fontWeight: 600 }}>{dim.label}</span><div style={{ flex: 1 }} /><span style={{ color: ACCENT, fontFamily: "monospace", fontWeight: 700 }}>{avg != null ? avg.toFixed(1) : "—"}</span>{selfV != null && <span style={{ color: "#2E6FB0", marginLeft: 8, fontSize: 12 }}>自評 {selfV}</span>}</div>
                <div style={{ position: "relative", height: 8, background: "#EFE7D6", borderRadius: 4 }}>
                  <div style={{ width: `${(avg || 0) / 5 * 100}%`, height: "100%", background: ACCENT, borderRadius: 4, transition: "width .2s" }} />
                  {selfV != null && <div title="自評" style={{ position: "absolute", top: -2, left: `calc(${selfV / 5 * 100}% - 1px)`, width: 2, height: 12, background: "#2E6FB0" }} />}
                </div>
              </div>
            ))}
            {a.comments.length > 0 && <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 8 }}>💬 匿名評語</div>
              {a.comments.map((c, i) => <div key={i} style={{ fontSize: 13, color: "#4A4234", background: "#FBF7EE", borderRadius: 8, padding: "8px 12px", marginBottom: 6, whiteSpace: "pre-wrap" }}>{c}</div>)}
            </div>}
            <div style={{ fontSize: 11, color: "#A99F88", marginTop: 12 }}>※ 正式版：評語匿名、評鑑者身分隱藏；少於設定人數不顯示結果以保護匿名。</div>
          </div>
        ); })()}
      </>)}

      {tab === "setup" && isAdmin && (<>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>評分面向</div>
          {dimensions.map(d => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input value={d.label} onChange={e => persist({ ...data, dimensions: dimensions.map(x => x.id === d.id ? { ...x, label: e.target.value } : x) })} style={{ flex: 1, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: dimensions.filter(x => x.id !== d.id) }); }} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ))}
          <button onClick={() => { if (!guard()) return; persist({ ...data, dimensions: [...dimensions, { id: "d" + Date.now(), label: "新面向" }] }); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增面向</button>
        </div>
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 10 }}>夥伴名單（{people.length}）</div>
          <div style={{ display: "flex", gap: 8, fontSize: 10, color: SUB, marginBottom: 4, padding: "0 2px" }}><span style={{ flex: 1 }}>姓名</span><span style={{ width: 80 }}>部門</span><span style={{ width: 90 }}>層級</span><span style={{ width: 110 }}>登入帳號</span><span style={{ width: 20 }} /></div>
          {people.map(p => { const up = (k, v) => persist({ ...data, people: people.map(x => x.id === p.id ? { ...x, [k]: v } : x) }); return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <input value={p.name} onChange={e => up("name", e.target.value)} placeholder="姓名" style={{ flex: 1, minWidth: 90, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "#fff", color: TEXT }} />
              <input value={p.dept || ""} onChange={e => up("dept", e.target.value)} placeholder="部門" style={{ width: 80, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <select value={p.role || "staff"} onChange={e => up("role", e.target.value)} title="層級＝權限：主管/管理員可管理" style={{ width: 90, border: `1px solid ${canManageRole(p.role) ? "#C2872E" : BORDER}`, borderRadius: 8, padding: "6px 6px", fontSize: 13, background: "#fff", color: TEXT }}>{CREW_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input value={p.account || ""} onChange={e => up("account", e.target.value)} placeholder="登入帳號" title="對應登入身分（例：goodmask77）" style={{ width: 110, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 13, background: "#fff", color: TEXT }} />
              <button onClick={() => { if (!guard()) return; confirm(`移除「${p.name}」？`).then(ok => ok && persist({ ...data, people: people.filter(x => x.id !== p.id) })); }} style={{ border: "none", background: "none", color: "#DC2626", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ); })}
          <button onClick={() => { if (!guard()) return; persist({ ...data, people: [...people, { id: "p" + Date.now(), name: "", dept: "", role: "staff", account: "" }] }); }} style={{ border: `1px dashed ${BORDER}`, background: SURFACE, color: SUB, borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer", marginTop: 4 }}>＋ 新增夥伴</button>
          <div style={{ fontSize: 11, color: "#A99F88", marginTop: 8 }}>※ 層級＝權限：主管/管理員可新增關卡、發起投票、上架獎勵。登入帳號＝這個人登入後自動對應的身分（正式版接 Auth 後就不用選身分了）。</div>
        </div>
      </>)}

      {/* 評分彈窗 */}
      {rate && (() => { const p = people.find(x => x.id === rate.revieweeId); return (
        <div onClick={e => e.target === e.currentTarget && setRate(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 2 }}>評鑑：{p?.name}{p?.id === me ? "（自評）" : ""}</div>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>每個面向給 1–5 分</div>
            {dimensions.map(dim => (
              <div key={dim.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>{dim.label}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => { const on = rate.scores[dim.id] === n; return (
                    <button key={n} onClick={() => setRate({ ...rate, scores: { ...rate.scores, [dim.id]: n } })} style={{ flex: 1, height: 38, borderRadius: 8, border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{n}</button>
                  ); })}
                </div>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>評語（可留空）</div>
              <textarea value={rate.comment} onChange={e => setRate({ ...rate, comment: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 80, resize: "vertical", outline: "none", fontFamily: "inherit" }} placeholder="具體的觀察與建議…" />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setRate(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button onClick={submitRate} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 22px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>送出評鑑</button>
            </div>
          </div>
        </div>
      ); })()}
    </div>
  );
}

// ── 夥伴中心：回饋制度 + 積分 + 排行榜（設計原型）─────────────────────────────
const FB_POS_TAGS = ["服務暖心", "救火英雄", "執行力強", "細心可靠", "思慮周全", "帶人有耐心", "正能量", "神隊友", "出餐快又準", "臨危不亂"];
const FB_CON_TAGS = ["可多主動溝通", "記得多確認細節", "建議提早備料", "開會多分享想法"];
// 積分：給回饋+2、收到回饋+1、你給的回饋被按「幫到我」+5
function crewPointStats(items, people) {
  const m = {};
  people.forEach(p => { m[p.id] = { id: p.id, name: p.name, dept: p.dept, given: 0, received: 0, helpfulGot: 0, points: 0 }; });
  items.forEach(it => {
    if (m[it.fromId]) { m[it.fromId].given++; m[it.fromId].helpfulGot += (it.helpful?.length || 0); }
    if (m[it.toId]) m[it.toId].received++;
  });
  Object.values(m).forEach(s => { s.points = s.given * 2 + s.received * 1 + s.helpfulGot * 5; });
  return m;
}
async function loadCrewRoster() {
  try { const r = await window.storage.get(K("kb_360"), true); const d = r && r.value ? JSON.parse(r.value) : null; return d?.people || []; } catch (_) { return []; }
}

function FeedbackView({ canEdit, requireLogin, isAdmin, userName }) {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [me, setMe] = useState("");
  const [tab, setTab] = useState("give");
  const [draft, setDraft] = useState({ toId: "", tags: [], text: "", anon: false });
  const [wallFilter, setWallFilter] = useState("all"); // all | tome | byme

  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName));
      try { const rr = await window.storage.get(K("kb_feedback"), true); setItems(rr && rr.value ? JSON.parse(rr.value).items || [] : []); } catch (_) { setItems([]); }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  const persist = async (list) => { setItems(list); try { await window.storage.set(K("kb_feedback"), JSON.stringify({ items: list }), true); } catch (_) {} };
  const nameOf = (id) => people.find(p => p.id === id)?.name || "—";
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  const toggleTag = (t) => setDraft(d => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t] }));
  const submit = () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    if (!me) { alert("請先選「我是誰」"); return; }
    if (!draft.toId) { alert("請選回饋對象"); return; }
    if (!draft.tags.length && !draft.text.trim()) { alert("至少選一個標籤或寫幾個字"); return; }
    const it = { id: "fb-" + Math.random().toString(36).slice(2, 8), fromId: me, toId: draft.toId, tags: draft.tags, text: draft.text.trim(), anon: draft.anon, ts: new Date().toISOString(), helpful: [] };
    persist([it, ...items]);
    setDraft({ toId: "", tags: [], text: "", anon: false });
    setTab("wall");
  };
  const toggleHelpful = (it) => {
    if (!me) { alert("請先選「我是誰」才能標記"); return; }
    const has = (it.helpful || []).includes(me);
    persist(items.map(x => x.id === it.id ? { ...x, helpful: has ? x.helpful.filter(h => h !== me) : [...(x.helpful || []), me] } : x));
  };

  const meSelect = <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />;
  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
  const subTab = (t, l) => <button key={t} onClick={() => setTab(t)} style={{ border: `1px solid ${tab === t ? PRIMARY : BORDER}`, background: tab === t ? PRIMARY : "transparent", color: tab === t ? "#fff" : TEXT, borderRadius: 8, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>{l}</button>;
  const tagChip = (t, on, onClick) => <button key={t} onClick={onClick} style={{ border: `1px solid ${on ? ACCENT : BORDER}`, background: on ? ACCENT : "#fff", color: on ? "#fff" : TEXT, borderRadius: 16, padding: "5px 12px", fontSize: 12.5, cursor: "pointer" }}>{t}</button>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>💬 回饋</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>讓正向、有建設性的回饋變習慣——給回饋得分、被按「幫到我」更高分，累積成回饋王。</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>{subTab("give", "✍ 給回饋")}{subTab("wall", "🧱 回饋牆")}</div>

      {tab === "give" && (
        <div style={card}>
          <div style={{ marginBottom: 12 }}>{meSelect}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 4 }}>給誰</div>
          <select value={draft.toId} onChange={e => setDraft({ ...draft, toId: e.target.value })} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "#fff", color: TEXT, marginBottom: 12 }}>
            <option value="">— 選擇夥伴 —</option>
            {people.filter(p => p.id !== me).map(p => <option key={p.id} value={p.id}>{p.name}{p.dept ? `（${p.dept}）` : ""}</option>)}
          </select>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>👍 正向標籤</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_POS_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 6 }}>💡 建設性建議</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{FB_CON_TAGS.map(t => tagChip(t, draft.tags.includes(t), () => toggleTag(t)))}</div>
          <textarea value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder="具體說說（可留空，例：那天尖峰你主動幫忙收尾，真的很救火）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 9, fontSize: 14, height: 70, resize: "vertical", outline: "none", fontFamily: "inherit", marginBottom: 10 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: TEXT, cursor: "pointer" }}><input type="checkbox" checked={draft.anon} onChange={e => setDraft({ ...draft, anon: e.target.checked })} />匿名給</label>
            <div style={{ flex: 1 }} />
            <button onClick={submit} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "9px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>送出回饋 ＋2分</button>
          </div>
        </div>
      )}

      {tab === "wall" && (<>
        <div style={{ ...card, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {meSelect}
          {me && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "全部"], ["tome", `給我的${items.filter(x => x.toId === me).length ? "·" + items.filter(x => x.toId === me).length : ""}`], ["byme", "我給的"]].map(([k, l]) =>
              <button key={k} onClick={() => setWallFilter(k)} style={{ border: `1px solid ${wallFilter === k ? PRIMARY : BORDER}`, background: wallFilter === k ? PRIMARY : "transparent", color: wallFilter === k ? "#fff" : TEXT, borderRadius: 14, padding: "4px 12px", fontSize: 12.5, cursor: "pointer" }}>{l}</button>)}
          </div>}
        </div>
        {me && wallFilter === "tome" && <div style={{ fontSize: 12, color: SUB, margin: "-4px 2px 10px" }}>👇 別人給你的回饋，覺得有幫助就按「幫到我」，給予者會加分。</div>}
        {(() => { const list = items.filter(it => wallFilter === "all" || !me ? true : wallFilter === "tome" ? it.toId === me : it.fromId === me); return (<>
        {list.length === 0 && <div style={{ textAlign: "center", color: "#A99F88", padding: "40px 0", fontSize: 14 }}>{items.length === 0 ? "還沒有回饋，去「給回饋」開始吧。" : "這個篩選沒有回饋。"}</div>}
        {list.map(it => { const helped = (it.helpful || []).includes(me); const mine = it.toId === me; return (
          <div key={it.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: TEXT }}>{it.anon ? "匿名夥伴" : nameOf(it.fromId)}</span>
              <span style={{ color: SUB }}>→</span>
              <span style={{ fontWeight: 600, color: ACCENT }}>{nameOf(it.toId)}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "#C8BCA0" }}>{new Date(it.ts).toLocaleDateString("zh-TW")}</span>
            </div>
            {it.tags?.length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: it.text ? 8 : 0 }}>{it.tags.map(t => <span key={t} style={{ fontSize: 12, background: FB_CON_TAGS.includes(t) ? "#FFF7ED" : "#F0FDF4", color: FB_CON_TAGS.includes(t) ? "#9A5B12" : "#2E7D32", border: `1px solid ${FB_CON_TAGS.includes(t) ? "#FDE6C8" : "#C8E6C9"}`, borderRadius: 12, padding: "2px 9px" }}>{t}</span>)}</div>}
            {it.text && <div style={{ fontSize: 14, color: "#4A4234", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{it.text}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <button onClick={() => toggleHelpful(it)} disabled={!mine} title={mine ? "" : "只有收到回饋的本人能標記（選對應的『我是誰』）"} style={{ border: `1px solid ${helped ? "#3C8C3C" : BORDER}`, background: helped ? "#F0FDF4" : "#fff", color: helped ? "#3C8C3C" : (mine ? TEXT : "#C8BCA0"), borderRadius: 16, padding: "4px 12px", fontSize: 12.5, fontWeight: 600, cursor: mine ? "pointer" : "default" }}>👍 幫到我{(it.helpful?.length || 0) > 0 ? ` · ${it.helpful.length}` : ""}</button>
              {(it.helpful?.length || 0) > 0 && <span style={{ fontSize: 11, color: "#3C8C3C" }}>給予者 +{it.helpful.length * 5} 分</span>}
            </div>
          </div>
        ); })}
        </>); })()}
      </>)}
    </div>
  );
}

// 夥伴中心共用：讀寫 + 完整積分餘額（回饋 + 闖關 − 兌換）
const loadCrewJSON = async (key, def) => { try { const r = await window.storage.get(K(key), true); return r && r.value ? JSON.parse(r.value) : def; } catch (_) { return def; } };
const saveCrewJSON = async (key, val) => { try { await window.storage.set(K(key), JSON.stringify(val), true); } catch (_) {} };
function crewFullBalance(people, fbItems, questsData, shopData) {
  const fb = crewPointStats(fbItems, people); const m = {};
  people.forEach(p => { m[p.id] = fb[p.id]?.points || 0; });
  (questsData?.progress || []).forEach(pr => { if (pr.status === "completed") { const q = (questsData.quests || []).find(x => x.id === pr.questId); if (q && m[pr.userId] != null) m[pr.userId] += (q.points || 0); } });
  (shopData?.redemptions || []).forEach(rd => { if (rd.status !== "rejected" && m[rd.userId] != null) m[rd.userId] -= (rd.cost || 0); });
  return m;
}
// 夥伴中心層級／權限
const CREW_ROLES = [["staff", "基層"], ["lead", "組長"], ["manager", "主管"], ["admin", "管理員"]];
const roleLabel = (r) => (CREW_ROLES.find(x => x[0] === r) || ["staff", "基層"])[1];
const canManageRole = (r) => r === "manager" || r === "admin";
const meFromRoster = (people, userName) => (people.find(p => p.account && p.account === userName) || {}).id || "";
// 目前身分＝登入帳號對應的人（固定、不可切換，避免冒名頂替）
const CrewMe = ({ people, me }) => {
  const cur = people.find(p => p.id === me);
  if (!cur) return <div style={{ fontSize: 12.5, color: "#C2872E" }}>⚠ 你的登入帳號尚未綁定夥伴身分（到 360評鑑 → 設定，把你的「登入帳號」填到對應的人）。</div>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: SUB }}>身分</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>{cur.name}{cur.dept ? `（${cur.dept}）` : ""}</span>
      <span style={{ fontSize: 11, background: canManageRole(cur.role) ? "#FEF3C7" : "#EFE7D6", color: canManageRole(cur.role) ? "#92400e" : SUB, borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>{roleLabel(cur.role)}</span>
    </div>
  );
};
const crewCard = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const crewProtoTitle = (emoji, t, sub) => (<><div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}><div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>{emoji} {t}</div><span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span></div>{sub && <div style={{ fontSize: 12, color: SUB, marginBottom: 12 }}>{sub}</div>}</>);

// ── 闖關任務 ─────────────────────────────────────────────────────────────────
function QuestView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { quests: [], progress: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_quests", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const done = (qid) => (data.progress || []).some(p => p.questId === qid && p.userId === me && p.status === "completed");
  const countDone = (qid) => (data.progress || []).filter(p => p.questId === qid && p.status === "completed").length;
  const complete = (q) => { if (!me) { alert("尚未對應到名單身分"); return; } if (done(q.id)) return; persist({ ...data, progress: [...(data.progress || []), { questId: q.id, userId: me, status: "completed", ts: new Date().toISOString() }] }); };
  const saveQuest = () => { if (!ed.title.trim()) { alert("請填關卡名稱"); return; } const q = { id: ed.id || "q-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), desc: ed.desc || "", points: Number(ed.points) || 0, active: ed.active !== false }; persist({ ...data, quests: ed.id ? data.quests.map(x => x.id === ed.id ? q : x) : [...data.quests, q] }); setEd(null); };
  return (
    <div>
      {crewProtoTitle("🎮", "闖關任務", "完成關卡得積分（正式版完成需組長核可、防自核）。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", desc: "", points: 50, active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增關卡</button>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {data.quests.filter(q => q.active !== false || canManage).map(q => { const d = done(q.id); return (
          <div key={q.id} style={{ ...crewCard, marginBottom: 0, opacity: q.active === false ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><span style={{ fontSize: 22 }}>{d ? "✅" : "🎯"}</span><div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{q.title}</div><div style={{ fontSize: 12.5, color: SUB, marginTop: 2 }}>{q.desc}</div></div><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT, whiteSpace: "nowrap" }}>+{q.points}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
              <span style={{ fontSize: 11, color: SUB }}>已完成 {countDone(q.id)} 人</span><div style={{ flex: 1 }} />
              {canManage && <button onClick={() => guard() && setEd({ ...q })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}
              <button onClick={() => complete(q)} disabled={d} style={{ border: `1px solid ${d ? "#3C8C3C" : ACCENT}`, background: d ? "#F0FDF4" : ACCENT, color: d ? "#3C8C3C" : "#fff", borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: d ? "default" : "pointer" }}>{d ? "✓ 已完成" : "完成挑戰"}</button>
            </div>
          </div>); })}
        {data.quests.length === 0 && <div style={{ color: "#A99F88", fontSize: 14, padding: "30px 0" }}>還沒有關卡{isAdmin ? "，點「＋ 新增關卡」" : ""}。</div>}
      </div>
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯關卡" : "新增關卡"}</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="關卡名稱（例：完成新人訓練）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <textarea value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, height: 60, resize: "vertical", marginBottom: 8, fontFamily: "inherit" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><span style={{ fontSize: 13, color: SUB }}>積分</span><input type="number" value={ed.points} onChange={e => setEd({ ...ed, points: e.target.value })} style={{ width: 90, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /><label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={ed.active !== false} onChange={e => setEd({ ...ed, active: e.target.checked })} />啟用</label></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveQuest} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 投票（含各項投票王）──────────────────────────────────────────────────────
function PollView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [data, setData] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  useEffect(() => { const s = setTimeout(() => setData(p => p || { polls: [], votes: [] }), 8000);
    (async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); setData(await loadCrewJSON("kb_polls", { polls: [], votes: [] })); })().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setData(n); saveCrewJSON("kb_polls", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (data === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const nameOf = (id) => people.find(p => p.id === id)?.name || id;
  const myVote = (pid) => (data.votes || []).find(v => v.pollId === pid && v.voterId === me);
  const vote = (poll, optId) => { if (!me) { alert("尚未對應到名單身分"); return; } if (myVote(poll.id)) return; persist({ ...data, votes: [...(data.votes || []), { pollId: poll.id, voterId: me, choiceId: optId, ts: new Date().toISOString() }] }); };
  const tally = (poll) => { const c = {}; poll.options.forEach(o => c[o.id] = 0); (data.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; }); const total = Object.values(c).reduce((a, b) => a + b, 0); const win = poll.options.slice().sort((a, b) => c[b.id] - c[a.id])[0]; return { c, total, win: total > 0 ? win : null }; };
  const savePoll = () => { if (!ed.title.trim()) { alert("請填主題"); return; } let opts = ed.usePeople ? people.map(p => ({ id: p.id, label: p.name })) : (ed.optText || "").split("\n").map(s => s.trim()).filter(Boolean).map((l, i) => ({ id: "o" + i, label: l })); if (opts.length < 2) { alert("至少要 2 個選項"); return; } const poll = { id: ed.id || "poll-" + Math.random().toString(36).slice(2, 7), title: ed.title.trim(), options: opts, anon: !!ed.anon, peoplePoll: !!ed.usePeople }; persist({ ...data, polls: ed.id ? data.polls.map(x => x.id === ed.id ? poll : x) : [...data.polls, poll] }); setEd(null); };
  const optLabel = (poll, oid) => poll.peoplePoll ? nameOf(oid) : (poll.options.find(o => o.id === oid)?.label || oid);
  return (
    <div>
      {crewProtoTitle("🗳", "投票", "一人一票（防灌票）；人物類投票會選出「投票王」。")}
      <div style={{ ...crewCard, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} /><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ title: "", optText: "", usePeople: false, anon: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 發起投票</button>}</div>
      {data.polls.length === 0 && <div style={{ color: "#A99F88", fontSize: 14, padding: "30px 0" }}>還沒有投票{isAdmin ? "，點「＋ 發起投票」" : ""}。</div>}
      {data.polls.map(poll => { const t = tally(poll); const voted = myVote(poll.id); return (
        <div key={poll.id} style={crewCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{poll.title}</div><div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: SUB }}>{t.total} 票</span></div>
          {poll.peoplePoll && t.win && <div style={{ fontSize: 13, color: "#B8860B", fontWeight: 700, marginBottom: 8 }}>👑 目前投票王：{optLabel(poll, t.win.id)}（{t.c[t.win.id]} 票）</div>}
          {poll.options.map(o => { const n = t.c[o.id] || 0; const pct = t.total ? Math.round(n / t.total * 100) : 0; const mine = voted?.choiceId === o.id; return (
            <div key={o.id} onClick={() => !voted && vote(poll, o.id)} style={{ position: "relative", border: `1px solid ${mine ? ACCENT : BORDER}`, borderRadius: 8, padding: "8px 12px", marginBottom: 6, cursor: voted ? "default" : "pointer", overflow: "hidden" }}>
              {voted && <div style={{ position: "absolute", inset: 0, width: pct + "%", background: mine ? "#F3E4DE" : "#F4EFE3", zIndex: 0 }} />}
              <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}><span style={{ fontSize: 14, color: TEXT, fontWeight: mine ? 700 : 500 }}>{optLabel(poll, o.id)}{mine && " ✓"}</span><div style={{ flex: 1 }} />{voted && <span style={{ fontSize: 13, color: SUB, fontVariantNumeric: "tabular-nums" }}>{n}（{pct}%）</span>}</div>
            </div>); })}
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>{!voted && <span style={{ fontSize: 12, color: ACCENT }}>點選項投票</span>}{voted && <span style={{ fontSize: 12, color: "#3C8C3C" }}>✓ 已投</span>}<div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && confirm("刪除這個投票？").then(ok => ok && persist({ ...data, polls: data.polls.filter(x => x.id !== poll.id), votes: (data.votes || []).filter(v => v.pollId !== poll.id) }))} style={{ border: "none", background: "none", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>刪除</button>}</div>
        </div>); })}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 440, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>發起投票</div>
            <input value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="主題（例：本月最佳服務）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 10 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, cursor: "pointer" }}><input type="checkbox" checked={ed.usePeople} onChange={e => setEd({ ...ed, usePeople: e.target.checked })} />選項用「夥伴名單」（選出投票王）</label>
            {!ed.usePeople && <textarea value={ed.optText} onChange={e => setEd({ ...ed, optText: e.target.value })} placeholder={"每行一個選項\n例：\n加開週會\n改善排班"} style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, height: 90, resize: "vertical", marginBottom: 10, fontFamily: "inherit" }} />}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14, cursor: "pointer" }}><input type="checkbox" checked={ed.anon} onChange={e => setEd({ ...ed, anon: e.target.checked })} />匿名投票</label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={savePoll} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>發布</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 兌換商城 + 錢包 ───────────────────────────────────────────────────────────
function ShopView({ canEdit, requireLogin, confirm, isAdmin, userName }) {
  const [people, setPeople] = useState([]); const [fb, setFb] = useState([]); const [quests, setQuests] = useState({ quests: [], progress: [] }); const [shop, setShop] = useState(null); const [me, setMe] = useState(""); const [ed, setEd] = useState(null);
  const reload = async () => { const r = await loadCrewRoster(); setPeople(r); setMe(meFromRoster(r, userName)); const f = await loadCrewJSON("kb_feedback", { items: [] }); setFb(f.items || []); setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] })); setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] })); };
  useEffect(() => { const s = setTimeout(() => setShop(p => p || { rewards: [], redemptions: [] }), 8000); reload().finally(() => clearTimeout(s)); return () => clearTimeout(s); }, []);
  const persist = (n) => { setShop(n); saveCrewJSON("kb_shop", n); };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  if (shop === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const canManage = canManageRole((people.find(p => p.id === me) || {}).role);
  const balances = crewFullBalance(people, fb, quests, shop);
  const myBal = me ? (balances[me] || 0) : null;
  const redeem = (r) => { if (!me) { alert("尚未對應到名單身分"); return; } if ((balances[me] || 0) < r.cost) { alert("積分不足"); return; } if ((r.stock ?? 99) <= 0) { alert("已兌完"); return; } confirm(`用 ${r.cost} 分兌換「${r.name}」？`).then(ok => { if (!ok) return; persist({ ...shop, rewards: shop.rewards.map(x => x.id === r.id ? { ...x, stock: (x.stock ?? 99) - 1 } : x), redemptions: [...(shop.redemptions || []), { id: "rd-" + Math.random().toString(36).slice(2, 7), userId: me, rewardId: r.id, cost: r.cost, name: r.name, status: "requested", ts: new Date().toISOString() }] }); }); };
  const saveReward = () => { if (!ed.name.trim()) { alert("請填名稱"); return; } const r = { id: ed.id || "rw-" + Math.random().toString(36).slice(2, 7), name: ed.name.trim(), desc: ed.desc || "", cost: Number(ed.cost) || 0, stock: ed.stock === "" ? 99 : Number(ed.stock), active: ed.active !== false }; persist({ ...shop, rewards: ed.id ? shop.rewards.map(x => x.id === ed.id ? r : x) : [...shop.rewards, r] }); setEd(null); };
  const myRedemptions = (shop.redemptions || []).filter(r => r.userId === me);
  return (
    <div>
      {crewProtoTitle("🎁", "獎勵商城", "用累積的積分兌換獎勵（正式版兌換＝原子扣點、可稽核）。")}
      <div style={{ ...crewCard, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <CrewMe people={people} me={me} setMe={setMe} isAdmin={isAdmin} />
        {me && <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 13, color: SUB }}>我的積分</span><span style={{ fontSize: 24, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{myBal}</span><span style={{ fontSize: 12, color: SUB }}>分</span></div>}
        <div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ name: "", desc: "", cost: 100, stock: "", active: true })} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>＋ 新增獎勵</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {shop.rewards.filter(r => r.active !== false || canManage).map(r => { const afford = me && (balances[me] || 0) >= r.cost; const out = (r.stock ?? 99) <= 0; return (
          <div key={r.id} style={{ ...crewCard, marginBottom: 0, opacity: r.active === false ? 0.55 : 1 }}>
            <div style={{ fontSize: 30, marginBottom: 4 }}>🎁</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{r.name}</div>
            <div style={{ fontSize: 12.5, color: SUB, marginBottom: 8, minHeight: 18 }}>{r.desc}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16, fontWeight: 800, color: ACCENT }}>{r.cost}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 分</span></span><span style={{ fontSize: 11, color: SUB }}>{(r.stock ?? 99) >= 99 ? "" : `剩 ${r.stock}`}</span><div style={{ flex: 1 }} />{canManage && <button onClick={() => guard() && setEd({ ...r, stock: r.stock ?? "" })} style={{ border: "none", background: "none", color: SUB, fontSize: 12, cursor: "pointer" }}>編輯</button>}</div>
            <button onClick={() => redeem(r)} disabled={!afford || out} style={{ marginTop: 10, width: "100%", border: "none", background: out ? "#C8BCA0" : afford ? "#3C8C3C" : "#C8BCA0", color: "#fff", borderRadius: 8, padding: "8px", fontSize: 13.5, fontWeight: 600, cursor: afford && !out ? "pointer" : "default" }}>{out ? "已兌完" : afford ? "兌換" : "積分不足"}</button>
          </div>); })}
        {shop.rewards.length === 0 && <div style={{ color: "#A99F88", fontSize: 14, padding: "30px 0" }}>還沒有獎勵{isAdmin ? "，點「＋ 新增獎勵」" : ""}。</div>}
      </div>
      {me && myRedemptions.length > 0 && <div style={{ ...crewCard, marginTop: 14 }}><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>我的兌換紀錄</div>{myRedemptions.map(r => <div key={r.id} style={{ display: "flex", fontSize: 13, padding: "5px 0", borderTop: "1px solid #F4EFE3" }}><span>{r.name}</span><div style={{ flex: 1 }} /><span style={{ color: SUB }}>-{r.cost} 分 · {r.status === "requested" ? "處理中" : r.status}</span></div>)}</div>}
      {ed && (
        <div onClick={e => e.target === e.currentTarget && setEd(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: 420, maxWidth: "100%" }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>{ed.id ? "編輯獎勵" : "新增獎勵"}</div>
            <input value={ed.name} onChange={e => setEd({ ...ed, name: e.target.value })} placeholder="獎勵名稱（例：星巴克咖啡券）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, marginBottom: 8 }} />
            <input value={ed.desc} onChange={e => setEd({ ...ed, desc: e.target.value })} placeholder="說明（選填）" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>所需積分</div><input type="number" value={ed.cost} onChange={e => setEd({ ...ed, cost: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div><div><div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>庫存（空=不限）</div><input type="number" value={ed.stock} onChange={e => setEd({ ...ed, stock: e.target.value })} style={{ width: 100, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 8px", fontSize: 14 }} /></div></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={() => setEd(null)} style={{ border: `1px solid ${BORDER}`, background: "#fff", color: SUB, borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button><button onClick={saveReward} style={{ border: "none", background: ACCENT, color: "#fff", borderRadius: 8, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>儲存</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function CrewRankView() {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState(null);
  const [quests, setQuests] = useState({ quests: [], progress: [] });
  const [shop, setShop] = useState({ rewards: [], redemptions: [] });
  const [polls, setPolls] = useState({ polls: [], votes: [] });
  useEffect(() => {
    const safety = setTimeout(() => setItems(prev => prev || []), 8000);
    (async () => {
      setPeople(await loadCrewRoster());
      const f = await loadCrewJSON("kb_feedback", { items: [] }); setItems(f.items || []);
      setQuests(await loadCrewJSON("kb_quests", { quests: [], progress: [] }));
      setShop(await loadCrewJSON("kb_shop", { rewards: [], redemptions: [] }));
      setPolls(await loadCrewJSON("kb_polls", { polls: [], votes: [] }));
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);
  if (items === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const bal = crewFullBalance(people, items, quests, shop);
  const stats = Object.values(crewPointStats(items, people)).map(s => ({ ...s, balance: bal[s.id] || 0 }));
  const board = (title, sub, key, unit, color) => {
    const sorted = [...stats].sort((a, b) => b[key] - a[key]).filter(s => s[key] > 0).slice(0, 8);
    const medal = ["🥇", "🥈", "🥉"];
    return (
      <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{title}</div>
        <div style={{ fontSize: 11.5, color: SUB, marginBottom: 10 }}>{sub}</div>
        {sorted.length === 0 && <div style={{ fontSize: 13, color: "#A99F88", padding: "8px 0" }}>尚無資料</div>}
        {sorted.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #F4EFE3" : "none" }}>
            <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#F3E4DE", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
            <span style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{s[key]}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> {unit}</span></span>
          </div>
        ))}
      </div>
    );
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: TEXT }}>🏆 排行榜</div>
        <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400e", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>設計原型</span>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>積分＝給回饋×2 ＋ 收到×1 ＋ 你的回饋被按「幫到我」×5。</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {board("🏅 積分王", "總積分（回饋＋闖關－兌換）", "balance", "分", ACCENT)}
        {board("💬 回饋王", "給出最多被肯定（幫到我）的回饋", "helpfulGot", "讚", "#3C8C3C")}
        {board("🌟 人氣王", "收到最多回饋", "received", "則", "#2E6FB0")}
      </div>
      {/* 各項投票王（人物類投票同步進排行榜）*/}
      {(() => {
        const pp = (polls.polls || []).filter(p => p.peoplePoll);
        if (!pp.length) return null;
        const medal = ["🥇", "🥈", "🥉"];
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>👑 各項投票王</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {pp.map(poll => {
                const c = {}; poll.options.forEach(o => c[o.id] = 0);
                (polls.votes || []).filter(v => v.pollId === poll.id).forEach(v => { if (c[v.choiceId] != null) c[v.choiceId]++; });
                const ranked = poll.options.map(o => ({ id: o.id, name: people.find(p => p.id === o.id)?.name || o.label, dept: people.find(p => p.id === o.id)?.dept || "", votes: c[o.id] })).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 6);
                return (
                  <div key={poll.id} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 10 }}>{poll.title}</div>
                    {ranked.length === 0 && <div style={{ fontSize: 13, color: "#A99F88" }}>尚無投票</div>}
                    {ranked.map((s, i) => (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid #F4EFE3" : "none" }}>
                        <span style={{ width: 24, textAlign: "center", fontSize: i < 3 ? 16 : 13, color: SUB, fontWeight: 700 }}>{medal[i] || i + 1}</span>
                        <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#F3E4DE", color: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.name?.[0] || "?"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600, color: TEXT }}>{s.name}</div><div style={{ fontSize: 11, color: SUB }}>{s.dept}</div></div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: "#B8860B", fontVariantNumeric: "tabular-nums" }}>{s.votes}<span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}> 票</span></span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── 問題集 / 待辦（資料來自 LINE Bot 寫入的 pm_issues）────────────────────────
const DEFAULT_TODO_CATS = ["工地問題", "採購交期", "待定案", "其他"];
const CAT_PALETTE = ["#C2872E", "#2E6FB0", "#8B5CF6", "#0E9F6E", "#DC2626", "#D97706", "#0891B2", "#6F6656"];
const colorForCat = (name, cats = []) => {
  const i = cats.indexOf(name);
  if (i >= 0) return CAT_PALETTE[i % CAT_PALETTE.length];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
};
const catOf = (it) => it.category || (it.source === "todo" ? "其他" : "工地問題");
const FREQ_PRESETS = [["自動", 0], ["每天1次", 24], ["一天2次", 12], ["每2天", 48], ["每3天", 72]];
// ToDo 分頁的暖光閃動樣式（注入一次）
if (typeof document !== "undefined" && !document.getElementById("todo-glow-style")) {
  const s = document.createElement("style");
  s.id = "todo-glow-style";
  s.textContent = "@keyframes todoGlow{0%,100%{box-shadow:0 0 2px rgba(245,158,11,.35)}50%{box-shadow:0 0 14px 2px rgba(245,158,11,.85)}}.todo-glow{animation:todoGlow 1.5s ease-in-out infinite;border-color:#F59E0B !important;}";
  document.head.appendChild(s);
}
const freqLabel = (h) => { if (!h) return "自動（越近越密）"; const p = FREQ_PRESETS.find(([, v]) => v === h); if (p) return p[0]; if (h % 24 === 0) return `每${h / 24}天1次`; return `每${h}小時`; };
const twDateStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const dueInfo = (due) => {
  if (!due) return null;
  const today = twDateStr();
  const d = Math.round((Date.parse(due + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (d < 0) return { txt: `逾期 ${-d} 天`, color: "#DC2626", bold: true };
  if (d === 0) return { txt: "今天到期", color: "#DC2626", bold: true };
  if (d <= 3) return { txt: `剩 ${d} 天`, color: "#C2872E", bold: true };
  return { txt: `${due}`, color: SUB, bold: false };
};

function IssuesView({ canEdit, requireLogin, confirm }) {
  const [issues, setIssues] = useState(null);
  const [cats, setCats] = useState(DEFAULT_TODO_CATS);
  const [filter, setFilter] = useState("open");
  const [catFilter, setCatFilter] = useState("全部");
  const [lightbox, setLightbox] = useState(null);
  const [editId, setEditId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [cfd, setCfd] = useState(1); // 自訂頻率：每 cfd 天
  const [cft, setCft] = useState(1); // …提醒 cft 次
  const [nd, setNd] = useState({ desc: "", category: "其他", due: "", track: true });

  useEffect(() => {
    // 保險：避免 Supabase 讀取卡住造成永久「載入中…」，最多 8 秒就先顯示空清單
    const safety = setTimeout(() => setIssues(prev => prev === null ? [] : prev), 8000);
    const withTimeout = (p, ms = 7000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    (async () => {
      let iss = [];
      try { const r = await withTimeout(window.storage.get(K("pm_issues"), true)); iss = r && r.value ? JSON.parse(r.value) : []; } catch (_) {}
      setIssues(iss);
      let list = null;
      try { const c = await withTimeout(window.storage.get(K("pm_todo_cats"), true)); const arr = c && c.value ? JSON.parse(c.value) : null; if (Array.isArray(arr) && arr.length) list = arr; } catch (_) {}
      const base = list || DEFAULT_TODO_CATS;
      // 自我修復：項目用到、但分類清單沒有的分類（例如 D哥 從 LINE 新增的「未來想法」）→ 自動補進清單
      const orphans = [...new Set(iss.map(i => i.category).filter(c => c && !base.includes(c)))];
      const merged = orphans.length ? [...base, ...orphans] : base;
      setCats(merged);
      if (orphans.length) { try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(merged), true); } catch (_) {} }
    })().finally(() => clearTimeout(safety));
    return () => clearTimeout(safety);
  }, []);

  const save = async (list) => {
    setIssues(list);
    try { await window.storage.set(K("pm_issues"), JSON.stringify(list), true); } catch (_) {}
  };
  const saveCats = async (list) => {
    setCats(list);
    try { await window.storage.set(K("pm_todo_cats"), JSON.stringify(list), true); } catch (_) {}
  };
  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const patch = (id, fields) => { if (!guard()) return; save(issues.map(i => i.id === id ? { ...i, ...fields } : i)); };
  const toggleDone = async (it) => {
    if (!guard()) return;
    if (it.status === "done") { patch(it.id, { status: "open" }); return; }
    const ans = window.prompt("這件的結論／答案是？（可留空，直接標完成；按取消則不完成）", it.answer || "");
    if (ans === null) return; // 取消 → 不標完成
    patch(it.id, { status: "done", track: false, answer: ans.trim() || it.answer || "" });
  };
  const del = async (id) => { if (!guard()) return; if (await confirm("刪除這筆事項？")) save(issues.filter(i => i.id !== id)); };
  const addNew = () => {
    if (!guard()) return;
    const desc = nd.desc.trim(); if (!desc) return;
    const entry = { id: "is-" + Math.random().toString(36).slice(2, 8), desc, category: nd.category, due: nd.due, remindEnd: "", track: !!nd.track, remindEvery: 0, status: "open", source: "todo", by: "App", ts: new Date().toISOString(), nudges: 0, answer: "", catName: "", catId: "", photoUrl: "" };
    save([entry, ...issues]);
    setNd({ desc: "", category: cats[0] || "其他", due: "", track: true }); setShowAdd(false);
  };
  // 分類管理
  const addCat = () => { if (!guard()) return; const n = newCat.trim(); if (!n || cats.includes(n)) { setNewCat(""); return; } saveCats([...cats, n]); setNewCat(""); };
  const renameCat = (old, val) => { const n = val.trim(); if (!n || (cats.includes(n) && n !== old)) return; saveCats(cats.map(c => c === old ? n : c)); save(issues.map(i => catOf(i) === old ? { ...i, category: n } : i)); };
  const delCat = async (c) => { if (!guard()) return; const used = issues.filter(i => catOf(i) === c).length; if (used && !(await confirm(`「${c}」還有 ${used} 筆事項，刪除分類後它們會歸到「其他」。確定刪除？`))) return; saveCats(cats.filter(x => x !== c)); if (used) save(issues.map(i => catOf(i) === c ? { ...i, category: "其他" } : i)); if (catFilter === c) setCatFilter("全部"); };

  if (issues === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const open = issues.filter(i => i.status !== "done");
  let shown = filter === "open" ? open : issues;
  if (catFilter !== "全部") shown = shown.filter(i => catOf(i) === catFilter);
  // 待處理：依交期排序（有交期且早的在前）
  shown = [...shown].sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    const ad = a.due || "9999", bd = b.due || "9999";
    return ad.localeCompare(bd);
  });
  const inp = { padding: "6px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, fontSize: 13, background: "#fff", color: TEXT };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>⚠️ 事項 / 待辦 / 問題</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{open.length} 項待處理</div>
        <button onClick={() => setShowAdd(s => !s)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${ACCENT}`, fontSize: 12.5, cursor: "pointer", background: showAdd ? ACCENT : "transparent", color: showAdd ? "#fff" : ACCENT, fontWeight: 600 }}>＋ 新增事項</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["open", "待處理"], ["all", "全部"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: "5px 14px", borderRadius: 20, border: `1px solid ${BORDER}`, fontSize: 12.5, cursor: "pointer", background: filter === k ? ACCENT : "transparent", color: filter === k ? "#fff" : SUB, fontWeight: filter === k ? 700 : 500 }}>{l}</button>
          ))}
        </div>
      </div>

      {/* 分類篩選 */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {["全部", ...cats].map(c => {
          const on = catFilter === c; const col = c === "全部" ? TEXT : colorForCat(c, cats);
          return <button key={c} onClick={() => setCatFilter(c)} style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${on ? col : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? col : "transparent", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{c}</button>;
        })}
        <button onClick={() => setShowCatMgr(s => !s)} title="編輯分類" style={{ padding: "4px 10px", borderRadius: 20, border: `1px dashed ${BORDER}`, fontSize: 12, cursor: "pointer", background: showCatMgr ? SURFACE : "transparent", color: SUB }}>✎ 分類</button>
      </div>

      {/* 分類管理 */}
      {showCatMgr && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 10 }}>編輯分類：改名直接打字、按 🗑 刪除（底下可新增）。改名/刪除會同步更新已記事項。</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {cats.map(c => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorForCat(c, cats), flexShrink: 0 }} />
                <input defaultValue={c} onBlur={e => renameCat(c, e.target.value)} style={{ ...inp, flex: "0 1 220px" }} />
                <span style={{ fontSize: 11.5, color: SUB }}>{issues.filter(i => catOf(i) === c).length} 筆</span>
                <button onClick={() => delCat(c)} style={{ padding: "4px 9px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>🗑</button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <input value={newCat} onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === "Enter" && addCat()} placeholder="新增分類名稱…" style={{ ...inp, flex: "0 1 220px" }} />
              <button onClick={addCat} style={{ padding: "5px 14px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>＋ 新增分類</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增表單 */}
      {showAdd && (
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={nd.desc} onChange={e => setNd({ ...nd, desc: e.target.value })} placeholder="要記什麼？例：訂製家具交期確認" style={{ ...inp, flex: "1 1 260px" }} />
          <select value={nd.category} onChange={e => setNd({ ...nd, category: e.target.value })} style={inp}>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <label style={{ fontSize: 12.5, color: SUB }}>交期 <input type="date" value={nd.due} onChange={e => setNd({ ...nd, due: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={nd.track} onChange={e => setNd({ ...nd, track: e.target.checked })} />🔔 盯到我回</label>
          <button onClick={addNew} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>記下</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          {filter === "open" ? "🎉 目前沒有待處理的事項" : "尚無記錄"}
          <div style={{ fontSize: 12, marginTop: 8 }}>在 LINE 跟 D哥 說「幫我記…」「追一下…」，或按上面「＋ 新增事項」</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["事項", "分類", "交期", "狀態", "操作"].map((h, i) => (
                  <th key={h} style={{ textAlign: i >= 3 ? "center" : "left", padding: "8px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1.5px solid ${BORDER}`, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(it => {
                const cat = catOf(it); const di = it.status !== "done" ? dueInfo(it.due) : null; const editing = editId === it.id;
                const tdS = { padding: "9px 10px", fontSize: 13, color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: "top" };
                const done = it.status === "done";
                return (
                  <Fragment key={it.id}>
                    <tr style={{ opacity: done ? 0.55 : 1 }}>
                      <td style={tdS}>
                        <div style={{ display: "flex", gap: 8 }}>
                          {it.photoUrl && <img src={it.photoUrl} alt="" onClick={() => setLightbox(it.photoUrl)} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", flexShrink: 0 }} />}
                          <div>
                            <div style={{ fontWeight: 500, lineHeight: 1.45, textDecoration: done ? "line-through" : "none" }}>{it.desc}</div>
                            {it.answer && <div style={{ fontSize: 12, color: "#3C8C3C", marginTop: 3 }}>✔ {it.answer}</div>}
                            {it.catName && <span style={{ fontSize: 10.5, background: ACCENT_SOFT, color: ACCENT, borderRadius: 5, padding: "1px 6px", fontWeight: 600, display: "inline-block", marginTop: 4 }}>{it.catName}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={tdS}>{(() => { const col = colorForCat(cat, cats); return <span style={{ fontSize: 11.5, background: col + "22", color: col, borderRadius: 6, padding: "2px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{cat}</span>; })()}</td>
                      <td style={tdS}>{it.due ? <span style={{ fontSize: 12.5, color: di ? di.color : SUB, fontWeight: di && di.bold ? 700 : 500, whiteSpace: "nowrap" }}>{it.due}{di && di.txt !== it.due ? ` · ${di.txt}` : ""}</span> : <span style={{ color: SUB }}>—</span>}</td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 12, color: done ? "#3C8C3C" : "#C2872E", fontWeight: 600 }}>{done ? "✅ 已解決" : "🔴 待處理"}</div>
                        {!done && it.track && <div style={{ fontSize: 11, color: "#C2872E", marginTop: 2 }}>🔔{it.nudges ? `已提醒${it.nudges}次` : "追蹤中"}</div>}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", gap: 5 }}>
                          <button onClick={() => toggleDone(it)} title={done ? "重開" : "完成/給答案"} style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, background: done ? "transparent" : "#EAF6EA", color: done ? SUB : "#3C8C3C", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{done ? "↩" : "✅"}</button>
                          <button onClick={() => setEditId(editing ? null : it.id)} title="編輯" style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${editing ? ACCENT : BORDER}`, background: editing ? ACCENT : "transparent", color: editing ? "#fff" : SUB, fontSize: 12, cursor: "pointer" }}>⚙️</button>
                          <button onClick={() => del(it.id)} title="刪除" style={{ padding: "5px 8px", borderRadius: 7, border: `1px solid ${BORDER}`, background: "transparent", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                    {editing && (
                      <tr>
                        <td colSpan={5} style={{ padding: "12px 14px", background: SURFACE, borderBottom: `1px solid ${BORDER}` }}>
                          {/* 內容可編輯 */}
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 4 }}>內容</div>
                            <textarea defaultValue={it.desc} onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.desc) patch(it.id, { desc: v }); }} rows={2} style={{ ...inp, width: "100%", resize: "vertical", lineHeight: 1.5 }} />
                          </div>
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>分類 <select value={cats.includes(cat) ? cat : ""} onChange={e => patch(it.id, { category: e.target.value })} style={inp}>{!cats.includes(cat) && <option value="">{cat}</option>}{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>交期 <input type="date" value={it.due || ""} onChange={e => patch(it.id, { due: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6 }}>提醒終止日 <input type="date" value={it.remindEnd || ""} onChange={e => patch(it.id, { remindEnd: e.target.value })} style={inp} /></label>
                            <label style={{ fontSize: 12.5, color: SUB, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={it.track !== false} onChange={e => patch(it.id, { track: e.target.checked })} />🔔 主動追蹤</label>
                          </div>
                          {/* 提醒頻率視覺化 */}
                          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${BORDER}` }}>
                            <div style={{ fontSize: 11.5, color: SUB, marginBottom: 6 }}>提醒頻率　<span style={{ color: TEXT, fontWeight: 600 }}>目前：{freqLabel(it.remindEvery || 0)}</span></div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {FREQ_PRESETS.map(([label, h]) => {
                                const on = (it.remindEvery || 0) === h;
                                return <button key={label} onClick={() => patch(it.id, { remindEvery: h })} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${on ? ACCENT : BORDER}`, fontSize: 12, cursor: "pointer", background: on ? ACCENT : "#fff", color: on ? "#fff" : SUB, fontWeight: on ? 700 : 500 }}>{label}</button>;
                              })}
                              <span style={{ width: 1, height: 18, background: BORDER, margin: "0 2px" }} />
                              <span style={{ fontSize: 12, color: SUB }}>自訂：每</span>
                              <input type="number" min={1} value={cfd} onChange={e => setCfd(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>天</span>
                              <input type="number" min={1} value={cft} onChange={e => setCft(Math.max(1, +e.target.value || 1))} style={{ ...inp, width: 52 }} />
                              <span style={{ fontSize: 12, color: SUB }}>次</span>
                              <button onClick={() => patch(it.id, { remindEvery: Math.max(1, Math.round((cfd * 24) / cft)) })} style={{ padding: "5px 12px", borderRadius: 7, border: "none", background: TEXT, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>套用</button>
                            </div>
                            <div style={{ fontSize: 11, color: SUB, marginTop: 6 }}>「自動」＝越接近交期提醒越密集、時間不固定（不易被忽略）；自訂則照你設定的頻率準時提醒。需開啟「🔔 主動追蹤」或設定交期才會提醒。</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <img src={lightbox} alt="" style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

// ── LINE 群組管理（D哥所在的所有群：設權限 + 每日彙報開關）────────────────────
// pm_group_seen：D哥自動登記的群清單（名稱/最近活躍/則數，由 bot 寫）
// pm_bot_groups：每個群的設定（mode/綁定工程/彙報開關，由這頁寫）
function GroupsView({ cats, canEdit, requireLogin, settings, setSettings, journal, events, plans }) {
  const [seen, setSeen] = useState(null);
  const [cfg, setCfg] = useState({});
  const [saving, setSaving] = useState(false);
  const updSettings = (k, v) => setSettings && setSettings({ ...(settings || {}), [k]: v });

  useEffect(() => {
    (async () => {
      try {
        const s = await window.storage.get(K("pm_group_seen"), true);
        const c = await window.storage.get(K("pm_bot_groups"), true);
        setSeen(s && s.value ? JSON.parse(s.value) : {});
        setCfg(c && c.value ? JSON.parse(c.value) : {});
      } catch { setSeen({}); setCfg({}); }
    })();
  }, []);

  const guard = () => { if (!canEdit) { requireLogin && requireLogin(); return false; } return true; };
  const persist = async (next) => {
    setCfg(next); setSaving(true);
    try { await window.storage.set(K("pm_bot_groups"), JSON.stringify(next), true); } catch (_) {}
    setSaving(false);
  };
  const effMode = (gid) => { const c = cfg[gid] || {}; return c.mode || (gid === DEFAULT_LINE_GROUP ? "internal" : (c.catId ? "vendor" : "locked")); };
  const effDigest = (gid) => (cfg[gid]?.digest !== false);
  const setMode = (gid, mode) => { if (!guard()) return; const c = { ...(cfg[gid] || {}) }; c.mode = mode; if (mode !== "vendor") { delete c.catId; delete c.catName; } persist({ ...cfg, [gid]: c }); };
  const setVendorCat = (gid, catId) => { if (!guard()) return; const cat = (cats || []).find(x => x.id === catId); persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), mode: "vendor", catId, catName: cat ? cat.name : "" } }); };
  const toggleDigest = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), digest: !effDigest(gid) } }); };
  const effMonitor = (gid) => (cfg[gid]?.monitor === true);
  const toggleMonitor = (gid) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), monitor: !effMonitor(gid) } }); };
  const effChat = (gid) => cfg[gid]?.chat || (effMode(gid) === "internal" ? "normal" : "quiet");
  const setChat = (gid, val) => { if (!guard()) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), chat: val } }); };
  const renameGroup = (gid, cur) => { if (!guard()) return; const n = window.prompt("這個群的顯示名稱（D哥抓不到名字時可手動命名）", cur || ""); if (n === null) return; persist({ ...cfg, [gid]: { ...(cfg[gid] || {}), name: n.trim() || undefined } }); };
  const removeGroup = (gid) => {
    if (!guard()) return;
    if (!window.confirm("從清單移除這個群？\n（若 D哥 還在群裡，下次有人講話會再自動出現；只有「已被移出/解散」的死群才會真正消失）")) return;
    const ns = { ...seen }; delete ns[gid]; setSeen(ns);
    try { window.storage.set(K("pm_group_seen"), JSON.stringify(ns), true); } catch (_) {}
    const nc = { ...cfg }; delete nc[gid]; persist(nc);
  };

  if (seen === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;

  // 永遠把內部群放進清單（即使還沒有新訊息）
  const ids = Array.from(new Set([DEFAULT_LINE_GROUP, ...Object.keys(seen), ...Object.keys(cfg)]));
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
        <div style={{ fontSize: 12.5, color: SUB }}>D哥所在 {ids.length} 個群{saving ? " · 儲存中…" : ""}</div>
      </div>
      <div style={{ fontSize: 12, color: SUB, marginBottom: 14, lineHeight: 1.6 }}>
        <b style={{ color: ACCENT }}>內部群</b>＝自己人，可查預算金額全部工程；<b style={{ color: "#2E6FB0" }}>廠商群</b>＝只回它那項工程進度，<b style={{ color: ACCENT }}>絕不洩漏金額</b>（要選綁定工程）；<b style={{ color: SUB }}>鎖定</b>＝只閒聊。外群一律「叫名字才回話」。<br />
        <b style={{ color: "#B45309" }}>每日彙報</b>＝每晚 8:00 把重點整理私訊你（一天一次）；<b style={{ color: "#DC2626" }}>即時監控</b>＝有重要訊息（變更／缺失／金額／交期／安全…）<b>當下就私訊你</b>。名字抓不到時，點群名旁 ✎ 可手動命名。
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
                      <span style={{ fontWeight: 600, color: isRawId ? SUB : TEXT, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={isRawId ? "D哥抓不到群名，點 ✎ 手動命名" : name}>{isRawId ? "（未命名群）" : name}</span>
                      <button onClick={() => renameGroup(gid, isRawId ? "" : name)} title="改顯示名稱" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? ACCENT : SUB, fontSize: 12, padding: 0 }}>✎</button>
                      {!isDefault && <button onClick={() => removeGroup(gid)} title="從清單移除（死群清理）" style={{ border: "none", background: "none", cursor: "pointer", color: isRawId ? "#DC2626" : SUB, fontSize: 12, padding: 0 }}>🗑</button>}
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
                          {(cats || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {!cfg[gid]?.catId && <span style={{ color: ACCENT, fontSize: 11, marginLeft: 6 }}>⚠️未綁</span>}
                      </span>
                    ) : <span style={{ color: SUB }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleDigest(gid)} title="每晚 8:00 整理重點私訊給你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${dg ? "#3C8C3C" : BORDER}`, cursor: "pointer", background: dg ? "#3C8C3C" : "transparent", color: "#fff", fontSize: 14, lineHeight: 1, fontWeight: 700 }}>{dg ? "✓" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => toggleMonitor(gid)} title="有重要訊息(變更/缺失/金額/交期/安全…)當下就私訊你" style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${mon ? "#DC2626" : BORDER}`, cursor: "pointer", background: mon ? "#DC2626" : "transparent", color: "#fff", fontSize: 13, lineHeight: 1, fontWeight: 700 }}>{mon ? "🔔" : ""}</button>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: SUB, fontSize: 12, whiteSpace: "nowrap" }}>{fmtWhen(s.lastSeen)} · {s.count || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: SUB, marginTop: 10, lineHeight: 1.6 }}>
        新群只要 D哥 在裡面、有人講話或貼圖，就會自動列進來。設定即時生效。
      </div>
      {/* LINE 通知設定（從 AI設定 整合過來）*/}
      {settings && (
        <div style={{ marginTop: 22 }}>
          <LineNotifySettings settings={settings} upd={updSettings} cats={cats} journal={journal} events={events} plans={plans} />
        </div>
      )}
    </div>
  );
}

// ── 估價單比價（在 App 上傳多份 PDF/圖 → callAI 解析 → 對比表）─────────────────
const _normName = (s) => String(s || "").replace(/[\s（）()【】\[\].·、，,。-]/g, "").toLowerCase();
function _buildCompareRows(ests) {
  const map = new Map(); // 正規化名稱相同才視為同品項（保守，不亂配對）
  ests.forEach(e => (e.items || []).forEach(it => {
    const key = _normName(it.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { label: it.name, prices: {} });
    map.get(key).prices[e.id] = Number(it.unitPrice) || 0;
  }));
  return [...map.values()].filter(r => Object.keys(r.prices).length >= 2);
}
function _fileToB64(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

function CompareView({ canEdit, requireLogin }) {
  const [ests, setEsts] = useState(null);
  const [busy, setBusy] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(K("pm_estimates"), true); setEsts(r && r.value ? JSON.parse(r.value) : []); } catch { setEsts([]); }
      try { const a = await window.storage.get(K("pm_estimates_an"), true); const v = a && a.value ? JSON.parse(a.value) : null; setAnalysis(v && v.rows ? v : null); } catch (_) {}
    })();
  }, []);
  // 估價單一變動就清掉舊分析（避免對不上）
  const save = async (list) => {
    setEsts(list); setAnalysis(null);
    try { await window.storage.set(K("pm_estimates"), JSON.stringify(list), true); await window.storage.set(K("pm_estimates_an"), "null", true); } catch (_) {}
  };

  const runAnalysis = async () => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    setAnalyzing(true);
    try {
      const forAI = ests.map(e => ({ vendor: e.vendor, total: e.total, items: (e.items || []).map(i => ({ name: i.name, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice })) }));
      const prompt = `你是專業的工程採購／標單比價分析師。以下是 ${ests.length} 份估價單的解析結果：\n${JSON.stringify(forAI)}\n\n請做專業比價分析，只回 JSON、不要其他文字：\n{\n "rows":[{"item":"標準化品項名稱","prices":{"<廠商名>":單價數字或null},"note":"差異備註(可空)"}],\n "missing":[{"vendor":"廠商名","items":["這家沒列、但別家有的品項"]}],\n "gapReason":"一句話：總價差的主因（例：晟弘多含結構支架與設備、發霸未含安裝）",\n "summary":"2-4 句：各家範圍／品質／優劣差異與風險",\n "recommend":"建議選哪家＋理由＋簽約前要向廠商確認／追問的重點"\n}\n規則：rows 要把語意相同的品項對齊在同一列（例「戶外P2.5 LED」與「LED螢幕」視為同一項），各家對應單價填入、沒有就 null；prices 的 key 用上面給的廠商名稱原文；金額只放數字。繁體中文，務實精準。`;
      const reply = await callAI([{ role: "user", content: prompt }], "你是專業工程標單比價分析師，只輸出 JSON。", "compare");
      const clean = reply.replace(/```json|```/gi, "").trim();
      let a = null;
      try { a = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
      if (a && a.rows) { setAnalysis(a); try { await window.storage.set(K("pm_estimates_an"), JSON.stringify(a), true); } catch (_) {} }
      else setAnalysis({ rows: [], summary: "（分析失敗，請重試）", recommend: "" });
    } catch (e) { setAnalysis({ rows: [], summary: "（分析失敗：" + (e?.message || e) + "）", recommend: "" }); }
    setAnalyzing(false);
  };
  const getP = (row, vendor) => {
    if (!row.prices) return null;
    if (row.prices[vendor] != null) return row.prices[vendor];
    const k = Object.keys(row.prices).find(k => _normName(k) === _normName(vendor));
    return k ? row.prices[k] : null;
  };

  const onPick = async (files) => {
    if (!canEdit) { requireLogin && requireLogin(); return; }
    const arr = Array.from(files || []); if (!arr.length) return;
    const added = [];
    for (const f of arr) {
      setBusy(`解析中：${f.name}…`);
      try {
        const b64 = await _fileToB64(f);
        const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
        const block = isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
          : { type: "image", source: { type: "base64", media_type: f.type || "image/jpeg", data: b64 } };
        const prompt = `這是一份工程估價單／報價單。抽出資訊，只回 JSON、不要其他文字：{"vendor":"廠商名稱","total":總額數字,"items":[{"name":"品項","qty":數量,"unit":"單位","unitPrice":單價數字}]}。看不到的：文字留空字串、數字留0；金額只放數字。`;
        const reply = await callAI([{ role: "user", content: [block, { type: "text", text: prompt }] }], "你是工程估價單解析助理，只輸出 JSON。", "import");
        const clean = reply.replace(/```json|```/gi, "").trim();
        let parsed = { vendor: "", total: 0, items: [] };
        try { parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)); } catch (_) {}
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: parsed.vendor || f.name, total: Number(parsed.total) || 0, items: Array.isArray(parsed.items) ? parsed.items : [], ts: new Date().toISOString() });
      } catch (e) {
        added.push({ id: "es-" + Math.random().toString(36).slice(2, 8), file: f.name, vendor: f.name, total: 0, items: [], error: String(e?.message || e) });
      }
    }
    setBusy("");
    save([...(ests || []), ...added]);
  };

  const remove = (id) => { if (!canEdit) { requireLogin && requireLogin(); return; } save(ests.filter(e => e.id !== id)); };

  if (ests === null) return <div style={{ padding: 40, color: SUB, fontSize: 14 }}>載入中…</div>;
  const sorted = [...ests].sort((a, b) => (a.total || 0) - (b.total || 0));
  const lowest = sorted.length ? (sorted.find(e => e.total > 0)?.total || 0) : 0;
  const highest = sorted.length ? Math.max(...ests.map(e => e.total || 0)) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT }}>📊 估價單比價</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{ests.length} 份</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={e => { onPick(e.target.files); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ background: ACCENT, border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>{busy ? busy : "＋ 上傳估價單"}</button>
        </div>
      </div>

      {ests.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: SUB, fontSize: 14, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12 }}>
          上傳 2 份以上估價單（PDF／圖片）開始比價
          <div style={{ fontSize: 12, marginTop: 8 }}>D哥 會解析每份的廠商／總額／品項，自動排序並對比</div>
        </div>
      ) : (
        <>
          {/* 總額對比 */}
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>💰 總額對比（低→高）</div>
            {sorted.map((e, idx) => {
              const diff = (e.total || 0) - lowest;
              const pct = lowest > 0 ? Math.round(diff / lowest * 100) : 0;
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: idx < sorted.length - 1 ? `1px solid #F4EFE3` : "none" }}>
                  <span style={{ fontSize: 15 }}>{idx === 0 && e.total > 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "・"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: TEXT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</div>
                    <div style={{ fontSize: 10.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.file}{e.error ? " ⚠️ 解析失敗" : ""}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: idx === 0 && e.total > 0 ? "#3C8C3C" : TEXT }}>{fmt(e.total)}</div>
                    {diff > 0 && <div style={{ fontSize: 10.5, color: "#C2872E" }}>+{fmt(diff)}（+{pct}%）</div>}
                  </div>
                  <button onClick={() => remove(e.id)} title="移除" style={{ border: "none", background: "none", color: SUB, cursor: "pointer", fontSize: 15 }}>✕</button>
                </div>
              );
            })}
            {highest > lowest && lowest > 0 && (
              <div style={{ fontSize: 12.5, color: "#3C8C3C", marginTop: 10, fontWeight: 600 }}>💡 選最低（{sorted[0].vendor}）比最高省 {fmt(highest - lowest)}</div>
            )}
          </div>

          {/* AI 專業比價分析 */}
          {ests.length >= 2 && (
            <div style={{ marginBottom: 14 }}>
              {!analysis ? (
                <button onClick={runAnalysis} disabled={analyzing} style={{ width: "100%", background: PRIMARY, border: "none", color: "#fff", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 700, cursor: analyzing ? "wait" : "pointer" }}>
                  {analyzing ? "🔍 AI 分析中…（對齊品項、解釋價差、給建議）" : "🔍 產生 AI 比價分析"}
                </button>
              ) : (
                <>
                  {analysis.gapReason && (
                    <div style={{ background: "#FFF7ED", border: "1px solid #FDE6C8", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#9A5B12", lineHeight: 1.6 }}>
                      <b>💡 價差主因：</b>{analysis.gapReason}
                    </div>
                  )}
                  {analysis.summary && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: TEXT, lineHeight: 1.7 }}>
                      <b style={{ color: ACCENT }}>📋 分析：</b>{analysis.summary}
                    </div>
                  )}
                  {analysis.recommend && (
                    <div style={{ background: "#EAF6EA", border: "1px solid #BFE3BF", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 13.5, color: "#235C23", lineHeight: 1.7 }}>
                      <b>✅ 建議：</b>{analysis.recommend}
                    </div>
                  )}
                  {Array.isArray(analysis.missing) && analysis.missing.some(m => (m.items || []).length) && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 12.5, color: "#B43838", lineHeight: 1.7 }}>
                      <b>⚠️ 各家未列項目（可能漏報或不含）：</b>
                      {analysis.missing.filter(m => (m.items || []).length).map((m, i) => <div key={i}>・<b>{m.vendor}</b>：{m.items.join("、")}</div>)}
                    </div>
                  )}
                  {Array.isArray(analysis.rows) && analysis.rows.length > 0 && (
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, overflowX: "auto" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: TEXT, marginBottom: 10 }}>📦 逐項單價對比（AI 對齊）</div>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 360 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap" }}>品項</th>
                            {ests.map(e => <th key={e.id} style={{ textAlign: "right", padding: "6px 8px", color: SUB, borderBottom: `1px solid ${BORDER}`, whiteSpace: "nowrap", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>{e.vendor}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.rows.map((r, ri) => {
                            const vals = ests.map(e => getP(r, e.vendor)).filter(v => v > 0);
                            const min = vals.length ? Math.min(...vals) : 0;
                            return (
                              <tr key={ri}>
                                <td style={{ padding: "6px 8px", color: TEXT, borderBottom: `1px solid #F4EFE3` }}>{r.item}{r.note ? <span style={{ color: SUB, fontSize: 11 }}> · {r.note}</span> : ""}</td>
                                {ests.map(e => {
                                  const v = getP(r, e.vendor);
                                  const isMin = v > 0 && v === min && vals.length > 1;
                                  return <td key={e.id} style={{ textAlign: "right", padding: "6px 8px", fontFamily: "monospace", borderBottom: `1px solid #F4EFE3`, color: isMin ? "#3C8C3C" : (v == null ? "#C0392B" : TEXT), fontWeight: isMin ? 700 : 400, background: isMin ? "#EAF6EA" : "transparent" }}>{v != null ? fmt(v) : "未列"}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{ fontSize: 11, color: SUB, marginTop: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                        <span>※ 由 AI 對齊各家品項；金額以原估價單為準，重要數字請再核對。</span>
                        <button onClick={runAnalysis} disabled={analyzing} style={{ border: "none", background: "none", color: ACCENT, cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>{analyzing ? "分析中…" : "↻ 重新分析"}</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── BOTTOM NAV (手機) ───────────────────────────────────────────────────────
function BottomNav({ view, setView, isAdmin }) {
  const tabs = (conf().tabs || [["owner", "儀表板", "📊"], ["overview", L("overview"), "📋"], ["gantt", L("gantt"), "📅"], ["files", "檔案庫", "📁"], ["issues", "ToDo", "📝"], ["compare", "比價", "⚖️"], ["advisor", "AI設定", "🤖"], ...(isAdmin ? [["groups", "群組", "💬"], ["accounts", "帳號", "👤"]] : [])]).filter(([v]) => !conf().hideTabs.includes(v));
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: 60, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderTop: `1px solid ${BORDER}`, boxShadow: "0 -2px 14px rgba(0,0,0,0.08)", display: "flex", zIndex: 350, paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map(([v, l, icon]) => {
        const on = view === v;
        return (
          <button key={v} onClick={() => setView(v)} title={l} className={v === "issues" && !on ? "todo-glow" : undefined} style={{ flex: 1, minHeight: 44, border: "none", borderRadius: v === "issues" ? 10 : 0, background: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer", color: on ? ACCENT : (v === "issues" ? "#D97706" : SUB), fontWeight: on ? 700 : (v === "issues" ? 700 : 500), padding: 0 }}>
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
        {/* 工作空間切換 */}
        <div style={{ flexShrink: 0, order: isMobile ? 1 : 0 }}>
          <select value={CURRENT_SPACE} onChange={(e) => switchSpace(e.target.value)} title="切換工作空間（各空間資料獨立）"
            style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, borderRadius: 8, padding: isMobile ? "5px 8px" : "7px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none" }}>
            {SPACES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </div>
        {/* KPI cards inline（手機改 2×2、整列獨佔一行；夥伴中心等空間隱藏）*/}
        {!conf().hideKpi && (() => {
          const kpis = conf().showCost ? [
            { label: "預估總額", val: fmt(totalEstimated), color: TEXT, tip: "各細項「數量×單價」依稅別換算含稅後加總＝總預算" },
            { label: "已付總額", val: totalPaid > 0 ? fmt(totalPaid) : "尚未付款", color: totalPaid > 0 ? "#3C8C3C" : SUB, tip: `各細項「已付金額」加總。付款進度 ${payPct}%` },
            { label: "未付總額", val: fmt(totalUnpaid), color: totalUnpaid < 0 ? "#DC2626" : "#C2872E", tip: totalUnpaid < 0 ? "已付超過預估（溢付）" : "預估總額 − 已付總額＝尚需支付" },
            { label: "完工項目", val: `${doneCount} / ${catCount}`, color: ACCENT, tip: "狀態標示為「完工」的大項數" },
          ] : [
            { label: `${L("cat")}數`, val: String(catCount), color: TEXT, tip: `目前空間的${L("cat")}數` },
            { label: "完工", val: `${doneCount} / ${catCount}`, color: ACCENT, tip: `狀態為「完工」的${L("cat")}` },
          ];
          return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? `repeat(${Math.min(kpis.length,2)},1fr)` : `repeat(${kpis.length},minmax(110px,1fr))`, gap: 8, flex: isMobile ? "1 1 100%" : (conf().showCost ? 1 : "0 1 auto"), minWidth: isMobile ? 0 : (conf().showCost ? 360 : 0), order: isMobile ? 2 : 0 }}>
            {kpis.map(k => <KPICard key={k.label} label={k.label} val={k.val} color={k.color} tip={k.tip} />)}
          </div>
          );
        })()}
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
        {(conf().tabs || [["owner","儀表板"],["overview",L("overview")],["gantt",L("gantt")],["files","檔案庫"],["issues","📝 ToDo"],["compare","比價"],["advisor","AI設定"],...(isAdmin?[["groups","群組"],["accounts","帳號"]]:[])]).filter(([v]) => !conf().hideTabs.includes(v)).map(([v,l]) => (
          <button key={v} onClick={() => setView(v)} className={v === "issues" && view !== v ? "todo-glow" : undefined} style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${view === v ? PRIMARY : (v === "issues" ? "#F59E0B" : BORDER)}`, cursor: "pointer", fontSize: 14, fontWeight: v === "issues" ? 700 : 500, background: view === v ? PRIMARY : (v === "issues" ? "#FEF3C7" : "transparent"), color: view === v ? "#fff" : (v === "issues" ? "#B45309" : TEXT), transition: "all .12s" }}>{l}</button>
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
  // 付款區（已付/未付改由「大項付款紀錄」管理，移除逐項已付欄避免重複計算）
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
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const [viewMode, setViewMode] = useState(() => (typeof window !== "undefined" && window.innerWidth < MOBILE_BP) ? "card" : "table"); // 手機預設卡片；table | card（卡片＝原看板）
  const [collapsed, setCollapsed] = useState(new Set()); // 收合的大項 id
  const toggleCollapse = (catId) => setCollapsed(s => { const n = new Set(s); n.has(catId) ? n.delete(catId) : n.add(catId); return n; });
  const allCollapsed = cats.length > 0 && cats.every(c => collapsed.has(c.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(cats.map(c => c.id)));
  const [lightbox, setLightbox] = useState(null); // 憑證放大檢視
  const [rcpBusy, setRcpBusy] = useState(null);    // 正在上傳憑證的 itemId
  const [payCatId, setPayCatId] = useState(null);  // 開啟付款紀錄面板的大項 id
  const [groupEditId, setGroupEditId] = useState(null); // 正在編輯費用群組標籤的大項
  const [groupsOpen, setGroupsOpen] = useState(true);   // 費用群組合計面板展開
  const [groupMode, setGroupMode] = useState(false);    // 分類模式：每列顯示群組/非工程編輯
  const allGroups = [...new Set(cats.map(c => c.group).filter(Boolean))];
  const setCatGroup = (catId, g) => setCats(prev => prev.map(c => c.id === catId ? { ...c, group: g || "" } : c));
  const setCatNonProj = (catId, v) => setCats(prev => prev.map(c => c.id === catId ? { ...c, nonProject: v } : c));

  // Flatten all items into rows with cat info
  const allRows = [];
  [...cats].sort((a,b) => a.order - b.order).forEach(cat => {
    cat.items.forEach(item => {
      allRows.push({ catId: cat.id, catName: cat.name, item });
    });
  });

  const matchRow = (r) => { if (!q) return true; const it = r.item; return [it.name, it.assignee, it.notes, r.catName, it.unit].filter(Boolean).join(" ").toLowerCase().includes(q); };
  const rows = allRows.filter(r => (filterStatus === "all" || r.item.status === filterStatus) && matchRow(r));

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
  const relabel = (c) => c.id === "cat" ? { ...c, label: L("cat") } : c.id === "name" ? { ...c, label: L("item") + "名稱" } : c;
  const orderedCols = cols.map(resolve).filter(c => c && c.id).filter(c => conf().showCost || !COST_COL_IDS.has(c.id)).map(relabel);
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
      estTotal: estAfterOf(item),
      paid: paidOf(item),
      unpaid: unpaidAfterOf(item),
    };
    cols.filter(c => c.builtin === false && c.type !== "formula").forEach(c => { ctx[c.id] = c.type === "text" ? (item.cust?.[c.id] || "") : (Number(item.cust?.[c.id]) || 0); });
    cols.filter(c => c.builtin === false && c.type === "formula").forEach(c => { ctx[c.id] = evalFormula(c.formula, ctx); });
    return ctx;
  };
  // 逐筆議價後預估金額（跨所有大項合併成一張對照表）
  const estAfterMap = {};
  for (const c of cats) Object.assign(estAfterMap, catItemEstAfter(c));
  const estAfterOf = (it) => (it.id in estAfterMap) ? estAfterMap[it.id] : estAmount(it);
  const unpaidAfterOf = (it) => estAfterOf(it) - paidOf(it);

  const numVal = (col, item) => {
    if (col.builtin) {
      if (col.id === "estTotal") return estAfterOf(item);
      if (col.id === "taxAmount") return taxOf(item);
      if (col.id === "paid") return paidOf(item);
      if (col.id === "unpaid") return unpaidAfterOf(item);
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
  // 「全部」檢視且未搜尋時，先列出所有大項（含 0 細項的空大項）；搜尋時只顯示有命中細項的大項
  if (filterStatus === "all" && !q) {
    [...cats].sort((a,b) => a.order - b.order).forEach(c => { catGroups[c.id] = { name: c.name, rows: [] }; });
  }
  rows.forEach(r => {
    if (!catGroups[r.catId]) catGroups[r.catId] = { name: r.catName, rows: [] };
    catGroups[r.catId].rows.push(r);
  });

  return (
    <div style={{ paddingTop: 12 }}>
      <datalist id="cat-group-list">{allGroups.map(g => <option key={g} value={g} />)}</datalist>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, letterSpacing: -0.2 }}>總覽</div>
        <div style={{ fontSize: 12.5, color: SUB }}>{viewMode === "card" ? L("cat") + "一覽" : L("subtitle")}</div>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 360 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#A99F88", pointerEvents: "none" }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋細項／負責人／備註…" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${search ? ACCENT : BORDER}`, borderRadius: 8, padding: "6px 28px 6px 30px", fontSize: 13, background: "#fff", color: TEXT, outline: "none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", color: SUB, cursor: "pointer", fontSize: 14 }}>×</button>}
        </div>
        <div style={{ flex: 1 }} />
        {viewMode === "table" && conf().showCost && (
          <button onClick={() => setGroupMode(m => !m)} title="分類模式：設定每個大項的費用群組與是否計入工程" style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${groupMode ? ACCENT : BORDER}`, fontSize: 12.5, cursor: "pointer", background: groupMode ? "#F3E4DE" : SURFACE, color: groupMode ? ACCENT : SUB, fontWeight: 500 }}>🏷 分類{groupMode ? "中" : ""}</button>
        )}
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

      {/* 工程／非工程／全部 三分類合計 */}
      {viewMode === "table" && conf().showCost && (() => {
        let pe = 0, pp = 0, ne = 0, np = 0; // 工程est/paid, 非工程est/paid
        cats.forEach(c => { const e = catEstAfter(c), pd = catPaid(c); if (c.nonProject) { ne += e; np += pd; } else { pe += e; pp += pd; } });
        const card = (label, est, paid, color, bg) => (
          <div style={{ flex: 1, minWidth: 200, background: bg, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 16px" }}>
            <div style={{ fontSize: 12, color: SUB, marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{fmt(est)}</div>
            <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>已付 <b style={{ color: "#3C8C3C" }}>{fmt(paid)}</b> · 未付 <b style={{ color: (est - paid) > 0 ? "#C2872E" : "#3C8C3C" }}>{fmt(est - paid)}</b></div>
          </div>
        );
        return (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {card("🏗 工程費用合計", pe, pp, "#2E7D32", "#EAF3EA")}
            {card("● 非工程（業主自理等）", ne, np, ACCENT, SURFACE)}
            {card("全部合計", pe + ne, pp + np, TEXT, SURFACE)}
          </div>
        );
      })()}

      {/* 費用群組合計（自訂分群，例：廣告機螢幕群）*/}
      {viewMode === "table" && conf().showCost && allGroups.length > 0 && (() => {
        const g = {};
        allGroups.forEach(name => { g[name] = { name, n: 0, pretax: 0, est: 0, paid: 0 }; });
        cats.forEach(c => { if (c.group && g[c.group]) { const gg = g[c.group]; gg.n++; gg.pretax += catPretaxSub(c); gg.est += catEstAfter(c); gg.paid += catPaid(c); } });
        const list = Object.values(g).sort((a, b) => b.est - a.est);
        return (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: groupsOpen ? 10 : 0 }}>
              <button onClick={() => setGroupsOpen(o => !o)} style={{ border: "none", background: "none", cursor: "pointer", color: SUB, fontSize: 11, transform: groupsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</button>
              <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>🏷 費用群組合計</div>
              <span style={{ fontSize: 12, color: SUB }}>{list.length} 群</span>
            </div>
            {groupsOpen && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
              {list.map(x => { const unpaid = x.est - x.paid; return (
                <div key={x.name} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 6 }}>{x.name} <span style={{ fontSize: 11, color: SUB, fontWeight: 400 }}>· {x.n} 項</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: SUB }}>未稅 <b style={{ color: TEXT }}>{fmt(x.pretax)}</b></span>
                    <span style={{ color: SUB }}>含稅 <b style={{ color: ACCENT }}>{fmt(x.est)}</b></span>
                    <span style={{ color: SUB }}>已付 <b style={{ color: "#3C8C3C" }}>{fmt(x.paid)}</b></span>
                    <span style={{ color: SUB }}>未付 <b style={{ color: unpaid > 0 ? "#C2872E" : "#3C8C3C" }}>{fmt(unpaid)}</b></span>
                  </div>
                </div>); })}
            </div>}
          </div>
        );
      })()}

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
            const groupPretax = cat ? catPretaxSub(cat) : 0; // 未稅小計（對應報價單未稅總價）
            const groupSaved = groupRaw - groupEst;
            const groupPaid = cat ? catPaid(cat) : 0; // 已付＝大項付款紀錄加總
            const payCount = cat ? (cat.payments?.length || 0) : 0;
            const groupUnpaid = groupEst - groupPaid;
            const itemCount = cat ? cat.items.length : group.rows.length;
            const doneCount = cat ? cat.items.filter(i => i.status === "done").length : 0;
            const pct = itemCount ? Math.round(doneCount / itemCount * 100) : 0;
            const isCollapsed = !q && collapsed.has(catId); // 搜尋時一律展開
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
                  {conf().showCost && (groupMode || groupEditId === catId ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <input list="cat-group-list" autoFocus={groupEditId === catId} defaultValue={cat?.group || ""} key={cat?.group || ""} onBlur={e => { setCatGroup(catId, e.target.value.trim()); setGroupEditId(null); }} onKeyDown={e => { if (e.key === "Enter") { setCatGroup(catId, e.target.value.trim()); setGroupEditId(null); } if (e.key === "Escape") setGroupEditId(null); }} placeholder="費用群組…" style={{ width: 100, border: `1px solid ${ACCENT}`, borderRadius: 12, padding: "2px 8px", fontSize: 11, background: "#fff", color: TEXT, outline: "none" }} />
                      <button onClick={() => setCatNonProj(catId, !cat?.nonProject)} title="是否計入工程費用" style={{ border: `1px solid ${cat?.nonProject ? "#C2872E" : BORDER}`, background: cat?.nonProject ? "#FFFBEB" : "transparent", color: cat?.nonProject ? "#C2872E" : SUB, borderRadius: 12, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>{cat?.nonProject ? "非工程" : "計入工程"}</button>
                    </div>
                  ) : (<>
                    {cat?.group && <button onClick={() => setGroupEditId(catId)} title="點擊改費用群組" style={{ flexShrink: 0, border: "1px solid #C8BCA0", background: "#F3E4DE", color: "#92400e", borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🏷 {cat.group}</button>}
                    {cat?.nonProject && <span style={{ flexShrink: 0, border: "1px solid #FDE6C8", background: "#FFFBEB", color: "#C2872E", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>非工程</span>}
                  </>))}
                  {itemCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                      <div style={{ width: 64, height: 5, background: "#E3DAC6", borderRadius: 3, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: pct === 100 ? "#3C8C3C" : "#3E72A8" }} /></div>
                      <span style={{ fontSize: 11, color: SUB }}>{doneCount}/{itemCount}</span>
                    </div>
                  )}
                  {!conf().showCost && <div style={{ flex: 1 }} />}
                  {conf().showCost && <>
                  {/* 議價折扣（放在大項名稱旁，不用捲動就看得到；套用在未稅層、稅金重算，細項原報價不動）*/}
                  {itemCount > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0, marginLeft: 4 }} title="大項議價折扣：套用在未稅小計、稅金重算">
                      <span style={{ fontSize: 11, color: SUB, flexShrink: 0 }}>議價</span>
                      <button onClick={() => setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: (disc.mode === "amt" ? "pct" : "amt"), discountValue: 0 } : c))}
                        title={disc.mode === "amt" ? "目前：折讓金額（點擊改為折 %）" : "目前：折 %（點擊改為折讓金額）"}
                        style={{ border: `1px solid ${BORDER}`, background: SURFACE, color: ACCENT, borderRadius: 5, width: 22, height: 20, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0 }}>{disc.mode === "amt" ? "$" : "%"}</button>
                      <input type="number" min={0} max={disc.mode === "amt" ? Math.round(disc.sub) : 100} value={cat?.discountValue || ""} placeholder={disc.mode === "amt" ? "折讓$" : "折%"}
                        onChange={e => { const max = disc.mode === "amt" ? catRawEst(cat) : 100; let v = Math.min(Math.max(Number(e.target.value) || 0, 0), max); setCats(prev => prev.map(c => c.id === catId ? { ...c, discountMode: disc.mode, discountValue: v } : c)); }}
                        style={{ width: 56, height: 20, border: `1px solid ${disc.hasDiscount ? "#C0392B" : BORDER}`, borderRadius: 5, padding: "0 5px", fontSize: 11, fontVariantNumeric: "tabular-nums", background: "#fff", color: TEXT }} />
                    </div>
                  )}
                  <div style={{ width: 18 }} />
                  {(() => {
                    const isEmpty = groupEst === 0 && groupPaid === 0;
                    if (isEmpty) return <span style={{ fontSize: 12, color: "#C8BCA0" }}>尚未建立明細</span>;
                    const pct = groupEst > 0 ? Math.round(groupPaid / groupEst * 100) : 0;
                    const full = groupEst > 0 && groupUnpaid <= 0;
                    const none = groupPaid === 0;
                    return (<>
                      <div style={{ fontSize: 13, color: SUB }} title="未稅小計＝Σ數量×單價，對應報價單的未稅總價">未稅 <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{fmt(groupPretax)}</span></div>
                      {disc.hasDiscount ? (<>
                        <div style={{ fontSize: 12, color: SUB }}>原報價 <span style={{ color: "#A99F88", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmt(groupRaw)}</span></div>
                        <div style={{ fontSize: 12, color: SUB }}>議價後 <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(groupEst)}</span></div>
                        <div style={{ fontSize: 12, color: "#C0392B", fontWeight: 600, fontVariantNumeric: "tabular-nums" }} title={disc.mode === "amt" ? `固定折讓 ${fmt(disc.amt)}（直接從含稅總價扣）` : `折 ${Math.round(disc.pct * 10) / 10}%`}>省 {fmt(groupSaved)}（-{Math.round(disc.pct * 10) / 10}%）</div>
                      </>) : (
                        <div style={{ fontSize: 13, color: SUB }} title="含稅總計">含稅 <span style={{ color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(groupEst)}</span></div>
                      )}
                      {/* 付款狀態（一眼辨識：綠=付清、橘=未付、進度條=部分）*/}
                      <button onClick={() => setPayCatId(catId)} title="檢視／新增付款紀錄" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", border: "none", background: "none", padding: 0 }}>
                        {full ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3C8C3C", background: "#E7F5E7", borderRadius: 12, padding: "3px 10px" }}>✓ 已付清{groupUnpaid < 0 ? `（溢付 ${fmt(-groupUnpaid)}）` : ""}</span>
                          : none ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#C2410C", background: "#FFF1E6", borderRadius: 12, padding: "3px 10px" }}>● 未付 {fmt(groupUnpaid)}</span>
                            : <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 44, height: 6, background: "#EFE7D6", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}><span style={{ display: "block", width: pct + "%", height: "100%", background: "#3C8C3C" }} /></span>
                                <span style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}><span style={{ color: "#3C8C3C", fontWeight: 600 }}>已付 {fmt(groupPaid)}</span> <span style={{ color: "#C2872E" }}>/ 未付 {fmt(groupUnpaid)}</span></span>
                              </span>}
                        {payCount > 0 && <span style={{ fontSize: 10, color: "#3C8C3C" }}>·{payCount}筆</span>}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setPayCatId(catId); }} title="新增付款紀錄" style={{ flexShrink: 0, border: `1px solid #3C8C3C`, background: "#F0FDF4", color: "#3C8C3C", borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>＋ 新增付款</button>
                    </>);
                  })()}
                  <div style={{ flex: 1 }} />
                  </>}
                  <button onClick={() => confirm(`確定刪除${L("cat")}「${group.name}」？\n（含其下 ${itemCount} 筆${L("item")}，無法復原）`).then(ok => { if (ok) setCats(prev => prev.filter(c => c.id !== catId)); })} title={`刪除此${L("cat")}`} style={{ flexShrink: 0, marginLeft: 4, width: 22, height: 22, borderRadius: "50%", background: "transparent", border: "none", color: "#C8BCA0", cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} onMouseEnter={e => { e.currentTarget.style.background = "#F3E4DE"; e.currentTarget.style.color = "#DC2626"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#C8BCA0"; }}>×</button>
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
                          <button onClick={(e) => { e.stopPropagation(); updateItem(catId, item.id, "priority", !item.priority); }} title={item.priority ? "優先追蹤中（點擊取消）" : "標為優先追蹤（AI 會特別關注）"} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, border: "none", background: "transparent", color: item.priority ? "#E8A317" : "#D8CFBB", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{item.priority ? "★" : "☆"}</button>
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
                        if (col.id === "estTotal") {
                          const after = estAfterOf(item), raw = estAmount(item), discd = disc.hasDiscount && after !== raw;
                          return <div key={col.id} style={{ ...cs, color: ACCENT, fontFamily: "monospace", fontWeight: 600, gap: 4 }} title={discd ? `原報價 ${fmt(raw)} → 大項議價後 ${fmt(after)}` : "預估金額（含稅，自動計算）"}>
                            {discd && <span style={{ color: "#A99F88", textDecoration: "line-through", fontWeight: 400, fontSize: 11 }}>{fmt(raw)}</span>}
                            <span>{fmt(after)}</span>
                          </div>;
                        }
                        if (col.id === "paid") {
                          const estA = estAfterOf(item), p = paidOf(item), full = estA > 0 && p >= estA;
                          return <div key={col.id} style={{ ...cs, gap: 6 }}>
                            <input type="checkbox" checked={full} title={full ? "已全額付清（點擊清除）" : "一鍵填入議價後金額"} onChange={() => updateItem(catId, item.id, "paid", full ? 0 : estA)} style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "#3C8C3C" }} />
                            <div style={{ flex: 1, minWidth: 0, color: p > 0 ? "#3C8C3C" : "#CDC3AC" }}><EditableCell catId={catId} itemId={item.id} field="paid" value={item.paid ?? item.cust?.paid ?? 0} type="number" /></div>
                          </div>;
                        }
                        if (col.id === "unpaid") { const u = unpaidAfterOf(item); return <div key={col.id} style={{ ...cs, color: u < 0 ? "#DC2626" : u > 0 ? "#C2872E" : "#3C8C3C", fontFamily: "monospace", fontWeight: 600 }} title={u < 0 ? "溢付（已付超過議價後金額）" : "未付金額（議價後 − 已付，自動）"}>{u < 0 ? `溢付 ${fmt(-u)}` : fmt(u)}</div>; }
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
                  <span style={{ fontSize: 16, color: ACCENT }}>+</span> 新增{L("item")}至「{group.name}」
                </div>
                )}
                {/* 新增工程大項（最後一組之後不顯示在這） */}
              </div>
            );
          })}
          {/* 新增工程大項 */}
          <div onClick={() => {
            const id = "cat-" + Date.now();
            setCats(prev => [...prev, { id, order: prev.length, name: "新"+L("cat"), budget: 0, status: "pending", items: [] }]);
          }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", color: ACCENT, fontSize: 13, fontWeight: 500, cursor: "pointer", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}
            onMouseEnter={e => e.currentTarget.style.background="#F4EFE3"}
            onMouseLeave={e => e.currentTarget.style.background=SURFACE}
          >
            <span style={{ fontSize: 16 }}>＋</span> 新增{L("cat")}
          </div>
          {/* 總計列：數字欄位自動加總 */}
          <div style={{ display: "flex", borderTop: `2px solid ${BORDER}`, background: "#ECE6D7", position: "sticky", bottom: 0, zIndex: 5, fontWeight: 600 }}>
            <div style={{ width: 24, flexShrink: 0, borderRight: "1px solid #D8CFBB" }} />
            {(() => { const anyDisc = cats.some(c => catDiscount(c).hasDiscount); return
            orderedCols.map(col => {
              const cs = { ...cellStyle(col) };
              if (col.id === "name") { const preSum = rows.reduce((s, r) => s + pretaxOf(r.item), 0); return <div key={col.id} style={{ ...cs, fontWeight: 600, color: "#211C15", gap: 8, flexWrap: "wrap" }}>總計（{rows.length} 筆）<span style={{ fontWeight: 500, color: SUB, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>未稅小計 {fmt(preSum)}</span>{anyDisc && <span style={{ fontWeight: 400, color: SUB, fontSize: 11 }}>· 已含議價折扣</span>}</div>; }
              if (col.id === "estTotal" && anyDisc) {
                const rawSum = rows.reduce((s, r) => s + estAmount(r.item), 0);
                const afterSum = rows.reduce((s, r) => s + estAfterOf(r.item), 0);
                return <div key={col.id} style={{ ...cs, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 0, lineHeight: 1.2 }} title="上：原報價總計　下：議價後總計"><span style={{ fontFamily: "monospace", color: "#A99F88", textDecoration: "line-through", fontSize: 11 }}>{fmt(rawSum)}</span><span style={{ fontFamily: "monospace", color: ACCENT, fontWeight: 700 }}>{fmt(afterSum)}</span></div>;
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
      {payCatId && (() => { const c = cats.find(x => x.id === payCatId); return c ? (
        <PaymentsPanel cat={c} setCats={setCats} onClose={() => setPayCatId(null)} confirm={confirm} />
      ) : null; })()}
    </div>
  );
}


// ── 大項（廠商）付款紀錄面板 ─────────────────────────────────────────────────
function PaymentsPanel({ cat, setCats, onClose, confirm }) {
  const payments = cat.payments || [];
  const est = catEstAfter(cat), paid = catPaid(cat), unpaid = est - paid;
  const items = cat.items || [];
  const itemEstMap = catItemEstAfter(cat); // 各品項議價後金額
  const itemPaidOf = (id) => payments.filter(p => p.itemId === id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const [lightbox, setLightbox] = useState(null);
  const [busy, setBusy] = useState(false);
  const blankDraft = () => ({ date: new Date().toISOString().slice(0, 10), amount: "", category: "訂金", note: "", itemId: "", receipts: [] });
  const [draft, setDraft] = useState(blankDraft);

  const update = (next) => setCats(prev => prev.map(c => c.id === cat.id ? { ...c, payments: next } : c));
  const editPay = (id, field, val) => update(payments.map(p => p.id === id ? { ...p, [field]: val } : p));
  const nameOfItem = (id) => items.find(i => i.id === id)?.name || "";
  // 對某品項快速付款：ratio=0.5 訂金一半；full=true 補到付清
  const quickPayItem = (item, { ratio, full, label }) => {
    const target = itemEstMap[item.id] ?? estAmount(item);
    const already = itemPaidOf(item.id);
    const amt = full ? Math.max(0, target - already) : Math.round(target * (ratio || 0));
    if (amt <= 0) return;
    update([...payments, { id: "pay-" + Math.random().toString(36).slice(2, 8), date: new Date().toISOString().slice(0, 10), amount: amt, category: full ? (already > 0 ? "尾款" : "其他") : "訂金", note: label || "", itemId: item.id, receipts: [] }]);
  };

  const uploadRcp = async (files) => {
    if (!files || !files.length) return [];
    setBusy(true);
    const out = [];
    for (const f of files) { try { const { url, path } = await uploadPhoto(f); out.push({ id: "rc-" + Math.random().toString(36).slice(2, 8), url, path, name: f.name || "憑證", isImage: /^image\//.test(f.type) }); } catch (_) {} }
    setBusy(false);
    return out;
  };

  const addPayment = () => {
    const amt = Number(draft.amount) || 0;
    if (amt <= 0) return;
    update([...payments, { id: "pay-" + Math.random().toString(36).slice(2, 8), date: draft.date, amount: amt, category: draft.category, note: draft.note, itemId: draft.itemId || null, receipts: draft.receipts }]);
    setDraft(blankDraft());
  };
  const delPayment = async (id) => {
    if (confirm && !(await confirm("刪除這筆付款紀錄？"))) return;
    const p = payments.find(x => x.id === id);
    for (const r of (p?.receipts || [])) { if (r.path) { try { await deletePhotoFile(r.path); } catch (_) {} } }
    update(payments.filter(x => x.id !== id));
  };
  const removeRcp = async (payId, ri) => {
    const p = payments.find(x => x.id === payId); const r = p?.receipts?.[ri];
    if (r?.path) { try { await deletePhotoFile(r.path); } catch (_) {} }
    editPay(payId, "receipts", (p.receipts || []).filter((_, i) => i !== ri));
  };

  const thumbs = (recs, onDel) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {(recs || []).map((r, ri) => (
        <div key={ri} style={{ position: "relative", width: 44, height: 44 }}>
          {r.isImage !== false
            ? <img src={r.url} alt={r.name} title={r.name} onClick={() => setLightbox(r)} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #D8CFBB", cursor: "zoom-in" }} />
            : <a href={r.url} target="_blank" rel="noreferrer" title={r.name} style={{ width: 44, height: 44, borderRadius: 6, border: "1px solid #D8CFBB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, textDecoration: "none", background: "#F3E4DE" }}>📄</a>}
          {onDel && <button onClick={() => onDel(ri)} style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: "50%", background: "#DC2626", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer" }}>×</button>}
        </div>
      ))}
    </div>
  );

  return (
    <SidePanel onClose={onClose} wide>
      <div style={{ fontSize: 11, color: "#6F6656", marginBottom: 2 }}>付款紀錄</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#211C15", marginBottom: 12 }}>{cat.name}</div>

      {/* 三個數字 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>議價後</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: ACCENT }}>{fmt(est)}</div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid rgba(60,140,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>已付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: "#3C8C3C" }}>{fmt(paid)}</div>
        </div>
        <div style={{ background: "#FFFBEB", border: "1px solid rgba(194,135,46,0.3)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 10, color: "#6F6656" }}>未付</div>
          <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: unpaid < 0 ? "#DC2626" : "#C2872E" }}>{unpaid < 0 ? `溢付 ${fmt(-unpaid)}` : fmt(unpaid)}</div>
        </div>
      </div>

      {/* 新增付款表單 */}
      <div style={{ border: "1px solid #D8CFBB", borderRadius: 10, padding: 12, marginBottom: 16, background: "#FBF7EE" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#211C15", marginBottom: 8 }}>＋ 新增付款</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>日期</div><input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} style={inputStyle} /></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>類別</div><select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} style={inputStyle}>{PAY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>金額 NT$</div><input type="number" min={0} value={draft.amount} placeholder="0" onChange={e => setDraft({ ...draft, amount: e.target.value })} style={{ ...inputStyle, fontVariantNumeric: "tabular-nums" }} /></div>
          <div><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>備註</div><input value={draft.note} placeholder="選填" onChange={e => setDraft({ ...draft, note: e.target.value })} style={inputStyle} /></div>
        </div>
        {items.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#6F6656", marginBottom: 2 }}>對應品項／廠商（選填，多廠商整合用）</div><select value={draft.itemId} onChange={e => setDraft({ ...draft, itemId: e.target.value })} style={inputStyle}><option value="">整批／不指定</option>{items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}</select></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {thumbs(draft.receipts, (ri) => setDraft({ ...draft, receipts: draft.receipts.filter((_, i) => i !== ri) }))}
          <label style={{ fontSize: 12, border: "1px dashed #D8CFBB", borderRadius: 6, padding: "6px 12px", cursor: "pointer", color: "#6F6656" }}>
            {busy ? "上傳中…" : "📎 上傳憑證"}
            <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={async e => { const f = e.target.files; e.target.value = ""; const up = await uploadRcp(f); if (up.length) setDraft(d => ({ ...d, receipts: [...d.receipts, ...up] })); }} />
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={addPayment} disabled={!(Number(draft.amount) > 0)} style={{ background: Number(draft.amount) > 0 ? "#3C8C3C" : "#C8BCA0", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: Number(draft.amount) > 0 ? "pointer" : "default" }}>新增</button>
        </div>
      </div>

      {/* 各品項付款進度（同大項整合多廠商，每個品項各自付清/訂金%）*/}
      {items.length > 0 && (() => {
        const withTarget = items.filter(it => (itemEstMap[it.id] ?? estAmount(it)) > 0);
        if (!withTarget.length) return null;
        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>各品項付款進度（多廠商整合）</div>
            {withTarget.map(it => {
              const target = itemEstMap[it.id] ?? estAmount(it);
              const ip = itemPaidOf(it.id);
              const pct = target > 0 ? Math.min(100, Math.round(ip / target * 100)) : 0;
              const full = ip >= target;
              return (
                <div key={it.id} style={{ border: "1px solid #E3DAC6", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#211C15", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div><div style={{ fontSize: 11, color: "#6F6656", fontVariantNumeric: "tabular-nums" }}>{fmt(target)}</div></div>
                    {full ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3C8C3C", background: "#E7F5E7", borderRadius: 12, padding: "3px 10px" }}>✓ 已付清</span>
                      : <span style={{ fontSize: 11.5, color: ip > 0 ? "#C2872E" : "#A99F88", fontVariantNumeric: "tabular-nums" }}>{ip > 0 ? `已付 ${fmt(ip)}（${pct}%）` : "未付"}</span>}
                  </div>
                  <div style={{ height: 6, background: "#EFE7D6", borderRadius: 3, overflow: "hidden", margin: "6px 0" }}><div style={{ width: pct + "%", height: "100%", background: "#3C8C3C" }} /></div>
                  {!full && <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => quickPayItem(it, { ratio: 0.5, label: "訂金50%" })} style={{ fontSize: 11.5, border: "1px solid #C2872E", background: "#FFFBEB", color: "#C2872E", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>訂金 50%</button>
                    <button onClick={() => quickPayItem(it, { full: true, label: ip > 0 ? "補尾款" : "全額付清" })} style={{ fontSize: 11.5, border: "1px solid #3C8C3C", background: "#F0FDF4", color: "#3C8C3C", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>{ip > 0 ? "補尾款付清" : "全額付清"}</button>
                  </div>}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 付款紀錄列表 */}
      <div style={{ fontSize: 12, color: "#6F6656", marginBottom: 6 }}>已付紀錄（{payments.length} 筆）</div>
      {payments.length === 0 && <div style={{ fontSize: 12, color: "#A99F88", padding: "12px 0" }}>尚無付款紀錄</div>}
      {payments.map(p => (
        <div key={p.id} style={{ border: "1px solid #E3DAC6", borderRadius: 8, padding: 10, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, background: "#F3E4DE", color: "#92400e", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0 }}>{p.category || "其他"}</span>
            {p.itemId && <span style={{ fontSize: 10, background: "#E8F0FB", color: "#2E6FB0", borderRadius: 10, padding: "1px 8px", fontWeight: 600, flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nameOfItem(p.itemId)}>{nameOfItem(p.itemId)}</span>}
            <input type="date" value={p.date || ""} onChange={e => editPay(p.id, "date", e.target.value)} style={{ ...inputStyle, width: 140, padding: "4px 8px", fontSize: 12 }} />
            <input type="number" min={0} value={p.amount} onChange={e => editPay(p.id, "amount", Number(e.target.value) || 0)} style={{ ...inputStyle, width: 120, padding: "4px 8px", fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "#3C8C3C" }} />
            <div style={{ flex: 1 }} />
            <button onClick={() => delPayment(p.id)} title="刪除這筆" style={{ width: 24, height: 24, borderRadius: "50%", background: "#F3E4DE", border: "1px solid rgba(193,58,34,0.25)", color: "#DC2626", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>×</button>
          </div>
          <input value={p.note || ""} placeholder="備註" onChange={e => editPay(p.id, "note", e.target.value)} style={{ ...inputStyle, padding: "4px 8px", fontSize: 12, marginBottom: (p.receipts?.length || 0) ? 8 : 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {thumbs(p.receipts, (ri) => removeRcp(p.id, ri))}
            <label style={{ fontSize: 11, border: "1px dashed #D8CFBB", borderRadius: 6, padding: "4px 10px", cursor: "pointer", color: "#6F6656" }}>
              {busy ? "上傳中…" : "📎 加憑證"}
              <input type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={async e => { const f = e.target.files; e.target.value = ""; const up = await uploadRcp(f); if (up.length) editPay(p.id, "receipts", [...(p.receipts || []), ...up]); }} />
            </label>
          </div>
        </div>
      ))}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
          <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: "95%", maxHeight: "95%", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </SidePanel>
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
  const totalAct = cats.reduce((s,c)=>s+catPaid(c),0); // 已付總額（大項付款紀錄）
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

      {/* D哥(LINE bot) 用量 — 主要花費在這 */}
      <div style={{ marginTop: 16 }}><BotUsagePanel /></div>
      {/* AI 用量 / 估算花費（App 自己的，較小）*/}
      <div style={{ marginTop: 16 }}><AIUsagePanel /></div>

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
            const newCat = { id, order: cats.length, name: "新"+L("cat"), budget: 0, status: "pending", items: [] };
            setCats(prev => [...prev, newCat]);
          }}
          style={{ background: "#FCFAF4", border: "1px dashed rgba(193,58,34,0.3)", borderRadius: 12, padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 120, gap: 8, transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor=ACCENT}
          onMouseLeave={e => e.currentTarget.style.borderColor="rgba(193,58,34,0.3)"}
        >
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff8e6", border: "1px solid rgba(193,58,34,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: ACCENT }}>+</div>
          <div style={{ fontSize: 13, color: "#6F6656" }}>新增{L("cat")}</div>
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
      const text = await callAI([{ role: "user", content: "請為業主產生一份精簡的本週工程進度週報（約 300 字內，含：整體狀況一句話、各大項進度、本週重點、待決問題、下週預計、整體評估🟢/🟡/🔴）。用業主能懂的口吻，純文字、適合在 LINE 閱讀。" }], system, "weekly");
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
// ── D哥(LINE bot) 用量 / 估算花費 ────────────────────────────────────────────
const BOT_MODEL_PRICE = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-sonnet-4-5": [3, 15], "claude-haiku-4-5": [1, 5] };
const botPriceFor = (m) => { const k = String(m || "").replace(/-\d{6,}$/, ""); for (const key in BOT_MODEL_PRICE) if (k.startsWith(key)) return BOT_MODEL_PRICE[key]; return [3, 15]; };
const botUsdOf = (m, inTok, outTok) => { const [pi, po] = botPriceFor(m); return (Number(inTok) || 0) / 1e6 * pi + (Number(outTok) || 0) / 1e6 * po; };
function BotUsagePanel() {
  const [data, setData] = useState(null);
  const load = async () => { try { const r = await window.storage.get(K("pm_bot_aiusage"), true); setData(r && r.value ? JSON.parse(r.value) : {}); } catch (_) { setData({}); } };
  useEffect(() => { load(); }, []);
  if (data === null) return null;
  const total = data.total || { calls: 0, inTok: 0, outTok: 0 };
  const rows = Object.entries(data.byModel || {}).map(([m, v]) => ({ m: m.replace(/-\d{6,}$/, ""), calls: v.calls || 0, inTok: v.inTok || 0, outTok: v.outTok || 0, usd: botUsdOf(m, v.inTok, v.outTok) })).sort((a, b) => b.usd - a.usd);
  const totUsd = rows.reduce((s, r) => s + r.usd, 0);
  const twd = totUsd * USD_TWD;
  const card = (label, val, sub) => (
    <div style={{ flex: 1, minWidth: 130, background: "#FBF0EC", border: "1px solid #E6C9BE", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#211C15", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>{val}</div>
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#A99F88" }}> {sub}</span>}</div>
    </div>
  );
  return (
    <div style={{ background: "#ffffff", border: `1px solid ${ACCENT}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: "#1A1A1A", color: "#fff", fontSize: 12, fontWeight: 800, borderRadius: 6, padding: "3px 8px" }}>:D</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>D哥（LINE bot）用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #D8CFBB", background: "#ECE6D7", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#FBF0EC", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
        D哥 在 LINE（守門 + 思考 + 彙報 + 監控）累計呼叫 Anthropic API 的<b style={{ color: ACCENT }}>估算</b>花費。<b>這是主要花費。</b>精確帳以 platform.claude.com → Usage（篩 ground-bot key）為準。
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {card("估算總花費（USD）", "$" + totUsd.toFixed(3))}
        {card("估算總花費（TWD）", "NT$" + Math.round(twd).toLocaleString(), `@${USD_TWD}`)}
        {card("AI 呼叫次數", (total.calls || 0).toLocaleString())}
        {card("總 tokens（in+out）", ((total.inTok || 0) + (total.outTok || 0)).toLocaleString())}
      </div>
      {rows.length > 0 ? (
        <div style={{ border: "1px solid #E3DAC6", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "flex", background: "#F4EFE3", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型（錢花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {rows.map((r) => (
            <div key={r.m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #EFE7D6", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.m}{/haiku/.test(r.m) ? "（守門/監控）" : /sonnet/.test(r.m) ? "（主力思考）" : ""}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{r.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(r.inTok + r.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${r.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(r.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#A99F88", textAlign: "center", padding: "12px 0" }}>尚無紀錄（從 v7.5 起累計；D哥 之後每次在 LINE 動作就會記）</div>
      )}
      <div style={{ fontSize: 11, color: "#A99F88", marginTop: 10 }}>{data.since ? `自 ${String(data.since).slice(0, 10)} 起累計` : ""}　⚠ 估算值，精確帳以 Console（ground-bot key）為準。</div>
    </div>
  );
}

// ── AI 用量 / 估算花費面板 ───────────────────────────────────────────────────
function AIUsagePanel() {
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try { const r = await window.storage.get(K("pm_ai_usage"), true); setLog(r && r.value ? JSON.parse(r.value) : []); }
    catch (_) { setLog([]); }
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
      <div style={{ fontSize: 11, color: "#6F6656", marginTop: 2 }}>{label}{sub && <span style={{ color: "#A99F88" }}> {sub}</span>}</div>
    </div>
  );

  return (
    <div style={{ background: "#ffffff", border: "1px solid #D8CFBB", borderRadius: 12, padding: 20, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 7px" }}>AI</span>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#211C15" }}>AI 用量 / 估算花費</div>
        <div style={{ flex: 1 }} />
        <button onClick={load} style={{ fontSize: 12, border: "1px solid #D8CFBB", background: "#ECE6D7", color: "#6F6656", borderRadius: 7, padding: "5px 12px", cursor: "pointer" }}>↻ 重新整理</button>
      </div>
      <div style={{ background: "#F4EFE3", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#6F6656", marginBottom: 14 }}>
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
          <div style={{ display: "flex", background: "#F4EFE3", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>用途（錢主要花在哪）</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div><div style={{ flex: 1, textAlign: "right" }}>占比</div>
          </div>
          {kinds.map(([k, v]) => (
            <div key={k} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #EFE7D6", fontVariantNumeric: "tabular-nums" }}>
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
          <div style={{ display: "flex", background: "#F4EFE3", fontSize: 11, color: "#6F6656", fontWeight: 600, padding: "6px 12px" }}>
            <div style={{ flex: 2 }}>模型</div><div style={{ flex: 1, textAlign: "right" }}>次數</div><div style={{ flex: 1.4, textAlign: "right" }}>tokens</div><div style={{ flex: 1.2, textAlign: "right" }}>USD</div><div style={{ flex: 1.2, textAlign: "right" }}>TWD</div>
          </div>
          {models.map(([m, v]) => (
            <div key={m} style={{ display: "flex", fontSize: 12, color: "#211C15", padding: "6px 12px", borderTop: "1px solid #EFE7D6", fontVariantNumeric: "tabular-nums" }}>
              <div style={{ flex: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m}</div>
              <div style={{ flex: 1, textAlign: "right" }}>{v.calls}</div>
              <div style={{ flex: 1.4, textAlign: "right" }}>{(v.inTok + v.outTok).toLocaleString()}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace" }}>${v.usd.toFixed(3)}</div>
              <div style={{ flex: 1.2, textAlign: "right", fontFamily: "monospace", color: ACCENT }}>{Math.round(v.usd * USD_TWD).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {!loading && calls === 0 && <div style={{ fontSize: 12, color: "#A99F88", textAlign: "center", padding: "12px 0" }}>尚無 AI 呼叫紀錄（用過 AI 顧問或匯入後會自動累計）</div>}
      <div style={{ fontSize: 11, color: "#A99F88", marginTop: 10 }}>⚠ 為前端估算值，精確帳務請以 platform.claude.com → Usage 為準。</div>
    </div>
  );
}

function AdvisorSettingsView({ settings, setSettings, cats, aiLog, setAiLog, activityLog, logActivity, userName, journal, events, plans }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const upd = (field, val) => setSettings({ ...settings, [field]: val });
  const fieldStyle = { width:"100%", padding:"9px 12px", border:"1px solid #D8CFBB", borderRadius:8, fontSize:13, color:"#211C15", outline:"none", fontFamily:"'Noto Sans TC',sans-serif", boxSizing:"border-box", background:"#f9fafb" };
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
  const card = { background:"#ffffff", border:"1px solid #D8CFBB", borderRadius:12, padding:20, marginBottom:14 };
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
                ? <img src={d.url} alt={d.name} title={d.name} onClick={()=>window.open(d.url,"_blank")} style={{ width:80,height:80,objectFit:"cover",borderRadius:8,border:"1px solid #D8CFBB",cursor:"pointer" }} />
                : <div onClick={()=>window.open(d.url,"_blank")} title={d.name+"（點擊開啟）"} style={{ width:80,height:80,borderRadius:8,border:"1px solid #D8CFBB",background:"#F3E4DE",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,padding:4,boxSizing:"border-box" }}><span style={{ fontSize:26 }}>📄</span><span style={{ fontSize:8,color:"#6F6656",width:"100%",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{d.name}</span></div>}
              <button onClick={()=>delDoc(i)} style={{ position:"absolute",top:-7,right:-7,width:18,height:18,borderRadius:"50%",background:"#DC2626",color:"#fff",border:"none",fontSize:11,cursor:"pointer" }}>×</button>
            </div>
          ))}
          <label style={{ width:80,height:80,borderRadius:8,border:"1px dashed #D8CFBB",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",color:"#A99F88",fontSize:12 }}>
            <span style={{ fontSize:22 }}>{busy?"…":"＋"}</span>{busy?"上傳中":"上傳"}
            <input ref={fileRef} type="file" multiple style={{ display:"none" }} onChange={e=>{ addDocs(e.target.files); e.target.value=""; }} />
          </label>
        </div>
        <div style={{ fontSize:11, color:"#A99F88", marginTop:8 }}>※ 目前 AI 會知道有哪些參考檔；「自動解析檔案內容做工種提醒」為進階功能，將逐步開放。</div>
      </div>
      <div style={{ ...card, marginBottom:0, background:"#FBF7EE" }}>
        <div style={{ fontSize:13, color:"#6F6656", lineHeight:1.8 }}>💡 <b>AI 用量 / 估算花費</b> 已移到「儀表板」。｜ AI 顧問對話請點右上角「AI 顧問」。｜ LINE 通知設定已整合到「群組」分頁。｜ 優先追蹤改在項目上點 ☆。</div>
      </div>
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
          const dur = cat.ganttDur ?? Math.max(1, Math.round(catEstAfter(cat) / 200000));
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
      {(() => { const e = catEstAfter(cat), p = catPaid(cat), u = e - p; return (
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

  const didScrollItem = useRef(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: didScrollItem.current ? "smooth" : "auto" }); didScrollItem.current = true; }, [item.chat]);

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

  const didScroll = useRef(false);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: didScroll.current ? "smooth" : "auto" }); didScroll.current = true; }, [chat]);

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
      const structure = cats.map(c => `【${c.name}】議價後${fmt(catEstAfter(c))} 已付${fmt(catPaid(c))} 狀態${c.status} 排程第${(c.ganttStart??0)+1}週起${c.ganttDur?` ${c.ganttDur}週`:""}；細項：${c.items.map(i=>`${i.name}(${i.qty}${i.unit}×${fmt(i.unitPrice)})`).join("、")||"無"}`).join("\n");
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
      const reply = await callAI(history, (conf().aiRole || SYSTEM_GLOBAL) + (canEdit ? (AGENT_GUIDE + VISION_GUIDE) : ""));

      // 顯示去掉 json 指令區塊後的乾淨文字
      const cleanText = reply.replace(/```json[\s\S]*?```/gi, "").trim();
      addMsg("assistant", cleanText || reply);

      // 解析並執行操作（僅管理員）
      const actions = parseActions(reply);
      if (actions.length > 0 && !canEdit) {
        addMsg("assistant", "🔒 需以管理員登入才能執行操作（目前為唯讀）。");
      } else if (actions.length > 0 && canEdit) {
        // 任何「會改資料」的動作都先算出結果、跳確認讓你核對（避免建錯大項／清錯東西）
        const { cats: newCats, settings: newSettings, worklog: newWorklog, results } = applyActions(actions, cats, settings, worklog);
        const WRITE = ["clear_all","clear_items","clear_category_items","add_category","delete_category","set_category_budget","set_category_status","set_gantt","add_item","set_item","delete_item","set_setting","add_log"];
        const willWrite = actions.some(a => WRITE.includes(a.type));
        let ok = true;
        if (willWrite && confirm) ok = await confirm(`AI 要做這些變更，請先核對是不是對的：\n\n${results.map(r => "・" + r).join("\n")}\n\n確定執行嗎？`);
        if (ok) {
          if (actions.some(a => ["clear_all","clear_items","clear_category_items","add_category","delete_category","set_category_budget","set_category_status","set_gantt","add_item","set_item","delete_item"].includes(a.type))) setCats(newCats);
          if (newSettings && setSettings && actions.some(a => a.type === "set_setting")) setSettings(newSettings);
          if (setWorklog && actions.some(a => a.type === "add_log")) setWorklog(newWorklog);
          addMsg("assistant", "✅ 已執行：\n" + results.map(r => "・" + r).join("\n"));
        } else {
          addMsg("assistant", "好，已取消，沒有改動任何資料。");
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
