// ── 全站 runtime 共用層（由 App.jsx 原樣搬出，2026-07-18 拆檔第一刀；行為零改變）──
// 空間 key 前綴、目前空間/登入者、模組級操作紀錄、金額顯示開關。
import { SPACES, SPACE_CONF } from "./spaces.js";

// ── 工作空間（多空間隔離）──────────────────────────────────────────────────
// 預設空間＝construction，沿用原本的 key（零遷移）；其他空間一律加前綴 sp_<id>_
// 全域 key（跨空間共用）：使用者身分、空間設定本身
export const GLOBAL_KEYS = new Set(["pm_role", "pm_known_users", "pm_current_space", "pm_roles", "pm_guest_perms"]);
export let CURRENT_SPACE = "construction";
try { CURRENT_SPACE = localStorage.getItem("pm_current_space") || "construction"; } catch (_) {}
if (!SPACES.some(s => s.id === CURRENT_SPACE)) CURRENT_SPACE = "construction";
// 邏輯 key → 實體 key（依目前空間）
export const K = (key) => (CURRENT_SPACE === "construction" || GLOBAL_KEYS.has(key)) ? key : `sp_${CURRENT_SPACE}_${key}`;
export const switchSpace = (id) => { try { localStorage.setItem("pm_current_space", id); } catch (_) {} window.location.reload(); };

export const conf = () => SPACE_CONF[CURRENT_SPACE] || SPACE_CONF.construction;
// 金額顯示開關：依登入者 profile 的「看金額」設定（未登入訪客＝可看，維持原行為）。
// 由 App 在每次 render 同步（見 App 內 setCanViewMoney 呼叫）。
export let CAN_VIEW_MONEY = true;
export const setCanViewMoney = (v) => { CAN_VIEW_MONEY = v; };
export const showMoney = () => conf().showCost && CAN_VIEW_MONEY;

// 目前登入者（由 App 同步），給 App 元件外的模組（如夥伴中心 crew 元件）寫操作紀錄用
export let CURRENT_USER = "";
export const setCurrentUser = (u) => { CURRENT_USER = u; };
// 模組級操作紀錄：直接讀改寫目前空間的 pm_activity（給 App 元件作用域外的地方用）
export async function auditLog(action, detail) {
  try {
    const r = await window.storage.get(K("pm_activity"), true);
    const prev = r && r.value ? JSON.parse(r.value) : [];
    const user = CURRENT_USER || "系統";
    const ts = new Date().toISOString();
    // 同人＋同動作＋同內容、3 分鐘內連續 → 合併成一筆只更新時間（跟 logActivity 同規則；治 360/夥伴中心每鍵記一條）
    const last = prev[0];
    const next = (last && last.user === user && last.action === action && last.detail === detail && Date.parse(ts) - Date.parse(last.ts) < 180000)
      ? [{ ...last, ts }, ...prev.slice(1)]
      : [{ ts, user, action, detail }, ...prev].slice(0, 200);
    await window.storage.set(K("pm_activity"), JSON.stringify(next), true);
  } catch (_) {}
}
