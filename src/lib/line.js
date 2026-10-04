// ── LINE 推播通知（由 App.jsx 原樣搬出，2026-07-18 拆檔第二刀；行為零改變）──────
// App（事件通知）與設定頁（群組管理/通知設定/額度）共用同一套。
import { K } from "./runtime.js";
import { getToken } from "../supa.js";

export const LINE_PUSH_URL = "/api/push"; // 本專案後端代理（原本誤指向已刪除的 ground-pm-webhook）
// v4.44.0 金鑰洞修補（2026-10-04：repo 公開後寫死金鑰曝光,實測任何人可冒 DD 推播）：
// 死金鑰作廢,改帶「登入權杖」由後端向 Supabase 驗證——沒登入就不能推播
export const lineAuthHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` });
export const DEFAULT_LINE_GROUP = "Cf7940efc6517b0c084ad2ad496b45f30";
// 通知開關清單（key 同時供 webhook server 排程使用）
export const LINE_EVENTS = [
  ["daily",   "每日工地速報（早上 8:00 推送）"],
  ["issue",   "細項狀態變為「有問題」時通知"],
  ["done",    "細項狀態變為「完工」時通知"],
  ["stalled", "卡關超過 3 天提醒"],
  ["weekly",  "AI 週報每週五自動推送"],
  ["due",     "排程任務截止日提醒"],
  ["journal", "新工作日誌建立時通知"],
];
export async function _lineSettings() {
  try { const r = await window.storage.get(K("pm_settings"), true); return r && r.value ? JSON.parse(r.value) : {}; } catch { return {}; }
}
async function _linePush(body) {
  try {
    const res = await fetch(LINE_PUSH_URL, { method: "POST", headers: lineAuthHeaders(), body: JSON.stringify(body) });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) { return { ok: false, error: String(e) }; }
}
// 共用：直接推送一段文字（讀 storage 群組 ID；無設定則用預設群組）
export async function sendLineNotify(text) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, text });
}
// 共用：推送 LINE Flex 訊息（push.js 收 messages 陣列）
export async function sendLineFlex(flex) {
  const s = await _lineSettings();
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, messages: [flex] });
}
// 事件型通知：先看「暫停所有通知」總開關，再看該事件的個別開關
export async function notifyLineEvent(type, text) {
  const s = await _lineSettings();
  const notify = s.lineNotify || {};
  if (notify.pauseAll) return { ok: false, reason: "paused-all" };
  if (!notify[type]) return { ok: false, reason: "disabled" };
  const to = s.lineGroupId || DEFAULT_LINE_GROUP;
  if (!to) return { ok: false, reason: "no-group" };
  return _linePush({ to, text });
}