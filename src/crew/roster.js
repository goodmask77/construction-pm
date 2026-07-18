// ── 名冊（人員主檔）獨立儲存（2026-07-18 名冊/360 分家）────────────────────
// 以前：名冊 people/fields 與 360 評鑑 dimensions/reviews 擠同一份 kb_360──
// 改名冊會整包重寫 360、填評鑑會整包重寫名冊，兩邊互蓋。
// 現在：名冊獨立存 kb_roster（people+fields），kb_360 只留評鑑資料。
// 舊資料第一次載入自動遷移；名冊仍是全站「人員唯一真相」（排班/回饋/闖關都讀這份）。
import { K, auditLog } from "../lib/runtime.js";

export const ROSTER_KEY = "kb_roster";

export async function loadRosterDoc() {
  try {
    const r = await window.storage.get(K(ROSTER_KEY), true);
    if (r && r.value) { const d = JSON.parse(r.value); return { people: d.people || [], fields: d.fields || [] }; }
  } catch (_) {}
  // 舊制遷移：從 kb_360 把 people/fields 搬出來（kb_360 內舊欄位保留不動、不再讀寫）
  try {
    const r = await window.storage.get(K("kb_360"), true);
    const d = r && r.value ? JSON.parse(r.value) : null;
    if (d && ((d.people || []).length || (d.fields || []).length)) {
      const roster = { people: d.people || [], fields: d.fields || [] };
      window.storage.set(K(ROSTER_KEY), JSON.stringify(roster), true).catch(() => {});
      return roster;
    }
  } catch (_) {}
  return { people: [], fields: [] };
}

export async function saveRosterDoc(next) {
  try { auditLog("編輯", "夥伴中心・名冊"); } catch (_) {}
  try { await window.storage.set(K(ROSTER_KEY), JSON.stringify({ people: next.people || [], fields: next.fields || [] }), true); } catch (_) {}
}

// 局部更新（例：360 設定頁只改 people）：先讀現況再合併，避免把另一半（fields）洗掉
export async function saveRosterPatch(patch) {
  const cur = await loadRosterDoc();
  await saveRosterDoc({ people: patch.people ?? cur.people, fields: patch.fields ?? cur.fields });
}
