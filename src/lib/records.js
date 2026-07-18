// ── 逐筆存共用層（2026-07-18）────────────────────────────────────────────────
// 以前：整個清單（所有交易/所有任務）擠在一份 JSON──兩人同時改，後存的整包蓋掉先存的。
// 現在：一筆＝一份文件（prefix+id），只寫「有變動的那幾筆」→ 兩人同時各記各的不再互蓋。
// 舊整包資料第一次載入時自動遷移（寫入 marker 後改走逐筆）。
import { getSharedPrefix, setSharedMany, onSharedChange, announceShared } from "../supa.js";

// 載入（防丟資料設計）：marker 只是「已遷移完」的加速器——
// 有 marker → 只掃逐筆檔；沒 marker → 「舊整包 + 逐筆檔」合併（同 id 以逐筆檔為準）。
// 就算某次讀取短暫失敗（回空），合併結果也只會少不會錯，且不會寫下錯誤的 marker
// （2026-07-18 遷移實測抓到：API 短暫回空 → 差點把「0 筆」當已遷移，記號會蓋住真資料）。
// sortBy：載入後排序（例：(a,b)=>a.ord-b.ord）。回傳陣列。
export async function loadRecords({ markerKey, prefix, legacyKey, withOrd, sortBy }) {
  try {
    const [mark, r, m] = await Promise.all([
      window.storage.get(markerKey, true),
      window.storage.get(legacyKey, true),
      getSharedPrefix(prefix),
    ]);
    const recs = Object.values(m).map(v => { try { return JSON.parse(v) } catch (_) { return null } }).filter(t => t && t.id);
    const srt = (l) => (sortBy ? [...l].sort(sortBy) : l);
    if (mark && mark.value) return srt(recs); // 已遷移完 → 逐筆檔就是全部
    let legacy = []; try { const a = r && r.value ? JSON.parse(r.value) : []; legacy = Array.isArray(a) ? a.filter(t => t && t.id) : []; } catch (_) {}
    if (!legacy.length) return srt(recs);
    // 合併：逐筆檔優先蓋掉舊整包同 id（遷移到一半也不漏、不重複）
    const byId = new Map(legacy.map(t => [t.id, t]));
    recs.forEach(t => byId.set(t.id, t));
    const list = srt([...byId.values()]);
    // 就地遷移（只在「真的有資料」時寫 marker；未登入被 RLS 擋下＝維持合併讀，下次再試）
    migrateRecords({ markerKey, prefix, list, withOrd }).catch(() => {});
    return list;
  } catch (_) { return []; }
}

export async function migrateRecords({ markerKey, prefix, list, withOrd }) {
  const pairs = list.filter(t => t && t.id).map((t, i) => [prefix + t.id, JSON.stringify(withOrd ? { ...t, ord: i } : t)]);
  if (!pairs.length) return; // 空清單絕不寫 marker（防「短暫讀失敗→記號蓋住真資料」）
  const ok = await setSharedMany(pairs);
  if (!ok) return; // 沒寫成（未登入/斷線）→ 不做記號，維持舊制，下次再試
  await window.storage.set(markerKey, JSON.stringify({ migratedAt: new Date().toISOString(), n: pairs.length }), true);
}

// 差異寫入：跟「上次已存清單」比對，只寫有變動的、刪被移除的。回傳新的已存清單（下次比對用）。
// withOrd：陣列順序有意義（手動拖曳排序）→ 把位置寫進 ord 欄位；順序變的那幾筆才會重寫。
export function diffPersist({ prefix, prevList, nextList, withOrd }) {
  const snap = (t, i) => JSON.stringify(withOrd ? { ...t, ord: i } : t);
  const prevMap = new Map((prevList || []).map((t, i) => [t.id, snap(t, i)]));
  const puts = [];
  const alive = new Set();
  (nextList || []).forEach((t, i) => {
    if (!t || !t.id) return;
    alive.add(t.id);
    const s = snap(t, i);
    if (prevMap.get(t.id) !== s) puts.push([prefix + t.id, s]);
  });
  const dels = (prevList || []).filter(t => t && t.id && !alive.has(t.id));
  // 一兩筆走一般 set（有防抖與廣播）；大量（批量匯入/拖曳重排）走批次＋補廣播
  if (puts.length > 3) setSharedMany(puts).then(ok => { if (ok) announceShared(puts.map(([k]) => k)); }).catch(() => {});
  else puts.forEach(([k, v]) => window.storage.set(k, v, true).catch(() => {}));
  dels.forEach(t => window.storage.delete(prefix + t.id, true).catch(() => {}));
  return nextList;
}

// 訂閱整個逐筆集合：別台改了某筆 → 回呼收到 (id, 該筆物件|null=刪除)，自行併入畫面 state。
export function subscribeRecords(prefix, cb) {
  return onSharedChange(prefix + "*", (key, v) => {
    const id = key.slice(prefix.length);
    if (v == null) { cb(id, null); return; }
    try { cb(id, JSON.parse(v)); } catch (_) {}
  });
}
