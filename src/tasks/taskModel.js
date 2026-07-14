// ── Task Object v2 資料模型（Sprint 1: Task Foundation）─────────────────────
// 前端 TaskCenter 與 D哥 webhook「共用」這一份，保證兩邊 Task shape 一致。
// 純 JS、無 JSX、無相依 → api/ serverless 也能 import。
//
// Task 欄位（v2，新欄位全部 optional、舊資料不回填）：
//   id, title, note, status(todo|doing|done), catId, start, due, priority,
//   tags: string[], createdAt, updatedAt,
//   owner?: string            // 負責人（自由文字，單人）
//   waitingFor?: string       // 正在等的人/物/決策（自由文字）
//   dependsOn?: string[]      // 依賴的任務 —— 永遠存 Task ID，UI 顯示 title
//   estimatedMinutes?: number|null // 預估分鐘；未估算 = null（不要 0）
//
// Derived state（即時計算、絕不落地存檔）：waiting / blocked / quickWin。

export const QUICK_WIN_MAX_MINUTES = 15; // Quick Win 門檻，集中管理、不要散落硬編碼

// waiting = waitingFor 有非空白內容
export const isWaiting = (t) => Boolean(String(t?.waitingFor ?? "").trim());

// quick win = 有估算 且 0 < 分鐘 <= 門檻（null 不算）
export const isQuickWin = (t) =>
  t?.estimatedMinutes != null && t.estimatedMinutes > 0 && t.estimatedMinutes <= QUICK_WIN_MAX_MINUTES;

// blocked = dependsOn 中存在「有效（找得到）且 status != done」的前置任務。
// 失效引用（找不到的 id）不計 blocked —— 避免死 id 造成永久卡住。
export const isBlocked = (t, tasks) =>
  (t?.dependsOn || []).some((id) => {
    const d = (tasks || []).find((x) => x.id === id);
    return d && d.status !== "done";
  });

// 失效依賴（引用了不存在的任務 id）→ UI 顯示 ⚠，讀取流程不修改資料
export const missingDeps = (t, tasks) =>
  (t?.dependsOn || []).filter((id) => !(tasks || []).some((x) => x.id === id));

// 從 start 沿 dependsOn 走訪，偵測是否走得回 start（循環）
function hasCycleFrom(startId, tasks) {
  const seen = new Set();
  const first = (tasks || []).find((x) => x.id === startId);
  const stack = [...((first && first.dependsOn) || [])];
  while (stack.length) {
    const id = stack.pop();
    if (id === startId) return true; // 走回自己 = 循環
    if (seen.has(id)) continue;
    seen.add(id);
    const t = (tasks || []).find((x) => x.id === id);
    ((t && t.dependsOn) || []).forEach((d) => stack.push(d));
  }
  return false;
}

// 「如果把 depId 加進 taskId 的依賴」會不會形成循環（含 A→A、A→B→A、A→B→C→A）
export function wouldCycle(taskId, depId, tasks) {
  if (!taskId || !depId) return false;
  if (taskId === depId) return true; // 禁止依賴自己
  const others = (tasks || []).filter((x) => x.id !== taskId);
  const cur = (tasks || []).find((x) => x.id === taskId);
  const hypo = [...others, { id: taskId, dependsOn: [...(((cur && cur.dependsOn) || [])), depId] }];
  return hasCycleFrom(taskId, hypo);
}

// 逐一保留不會成環的依賴（成環的丟掉）——儲存前的最後防線
export function stripCycles(taskId, arr, tasks) {
  const others = (tasks || []).filter((x) => x.id !== taskId);
  const ok = [];
  for (const id of arr) {
    const hypo = [...others, { id: taskId, dependsOn: [...ok, id] }];
    if (!hasCycleFrom(taskId, hypo)) ok.push(id);
  }
  return ok;
}

// ── 儲存前正規化 ─────────────────────────────────────────────────────────────
// 重要（Merge Rule）：只整理「patch 有出現的 key」；沒出現的 key 完全不碰，
// 讓 {...existing, ...patch} 自然保留舊值。陣列欄位：patch 沒 key=保留、給 []=明確清空。
export function normalizePatch(patch, taskId, tasks) {
  const p = { ...(patch || {}) };
  if ("owner" in p) {
    const v = String(p.owner ?? "").trim();
    p.owner = v || undefined; // 空字串 → undefined（JSON 存檔時整個 key 消失）
  }
  if ("waitingFor" in p) {
    const v = String(p.waitingFor ?? "").trim();
    p.waitingFor = v || undefined;
  }
  if ("dependsOn" in p) {
    let arr = Array.isArray(p.dependsOn) ? p.dependsOn : [];
    arr = [...new Set(arr.map((s) => String(s || "").trim()).filter(Boolean))]; // 去空、去重
    arr = arr.filter((id) => id !== taskId); // 去掉自己
    p.dependsOn = stripCycles(taskId, arr, tasks); // 循環防線
  }
  if ("estimatedMinutes" in p) {
    const v = p.estimatedMinutes;
    if (v === null || v === undefined || v === "") p.estimatedMinutes = null; // 空白 → null
    else {
      const n = Number(v);
      p.estimatedMinutes = Number.isInteger(n) && n > 0 ? n : null; // 拒絕 負數/NaN/小數 → null
    }
  }
  if ("tags" in p) {
    const arr = Array.isArray(p.tags) ? p.tags : [];
    p.tags = [...new Set(arr.map((s) => String(s || "").trim()).filter(Boolean))];
  }
  return p;
}

// 合併更新（唯一正確寫法）：絕不重建 task，一律展開舊物件再蓋 patch
export function mergeTask(existing, patch, tasks) {
  return { ...existing, ...normalizePatch(patch, existing.id, tasks), updatedAt: new Date().toISOString() };
}

// 刪除任務：同一次寫回完成「刪除 + 清掉所有人對它的 dependsOn 引用」（不留中間態）
export function removeTaskAndRefs(tasks, id) {
  return (tasks || [])
    .filter((x) => x.id !== id)
    .map((x) =>
      (x.dependsOn || []).includes(id)
        ? { ...x, dependsOn: x.dependsOn.filter((d) => d !== id) }
        : x
    );
}
