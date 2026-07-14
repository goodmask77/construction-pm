// Sprint 1 驗收：Task Object v2 模型層測試（node scripts/test-task-model.mjs）
import { isWaiting, isBlocked, isQuickWin, missingDeps, wouldCycle, stripCycles, normalizePatch, mergeTask, removeTaskAndRefs, QUICK_WIN_MAX_MINUTES } from "../src/tasks/taskModel.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✅", name); } else { fail++; console.log("  ❌", name); } };

console.log("── 舊資料相容 ──");
const oldTask = { id: "a", title: "舊任務", status: "todo", tags: [] }; // 沒有四個新欄位
ok("舊 task 沒四欄：waiting=false", isWaiting(oldTask) === false);
ok("舊 task 沒四欄：blocked=false", isBlocked(oldTask, [oldTask]) === false);
ok("舊 task 沒四欄：quickWin=false", isQuickWin(oldTask) === false);
ok("舊 task 沒四欄：missingDeps=[]", missingDeps(oldTask, [oldTask]).length === 0);

console.log("── Merge Rule ──");
const t1 = { id: "a", title: "A", status: "todo", owner: "張良", waitingFor: "等木工", dependsOn: ["b"], estimatedMinutes: 30, tags: ["採購"] };
const all = [t1, { id: "b", title: "B", status: "todo" }];
const m1 = mergeTask(t1, { status: "doing" }, all);
ok("改 status 後 owner 保留", m1.owner === "張良");
ok("改 status 後 waitingFor 保留", m1.waitingFor === "等木工");
ok("改 status 後 dependsOn 保留", m1.dependsOn.length === 1 && m1.dependsOn[0] === "b");
ok("改 status 後 estimatedMinutes 保留", m1.estimatedMinutes === 30);
ok("改 status 後 tags 保留", m1.tags.length === 1);
const m2 = mergeTask(t1, { dependsOn: [] }, all);
ok("patch 給 [] = 明確清空 dependsOn", m2.dependsOn.length === 0);
ok("patch 給 [] 清空時其他欄位仍在", m2.owner === "張良" && m2.estimatedMinutes === 30);

console.log("── 循環防護 ──");
const g = [
  { id: "A", status: "todo", dependsOn: ["B"] },
  { id: "B", status: "todo", dependsOn: [] },
  { id: "C", status: "todo", dependsOn: [] },
];
ok("A→A 被拒絕", wouldCycle("A", "A", g) === true);
ok("B 依賴 A（A→B→A）被拒絕", wouldCycle("B", "A", g) === true);
const g2 = [
  { id: "A", status: "todo", dependsOn: ["B"] },
  { id: "B", status: "todo", dependsOn: ["C"] },
  { id: "C", status: "todo", dependsOn: [] },
];
ok("C 依賴 A（A→B→C→A）被拒絕", wouldCycle("C", "A", g2) === true);
ok("合法依賴（C→B 不成環? A→B→C, C 依 D 不存在鏈）", wouldCycle("A", "C", g2) === false);
ok("stripCycles 丟掉成環、保留合法", (() => { const r = stripCycles("C", ["A", "B2"], g2); return !r.includes("A"); })());

console.log("── Missing Dependency ──");
const t2 = { id: "x", status: "todo", dependsOn: ["ghost", "y"] };
const all2 = [t2, { id: "y", status: "done" }];
ok("失效 id 不計 blocked、done 前置不計 blocked → blocked=false", isBlocked(t2, all2) === false);
ok("missingDeps 抓到 ghost", missingDeps(t2, all2).join() === "ghost");
const t3 = { id: "x", status: "todo", dependsOn: ["y2"] };
ok("有效未完成前置 → blocked=true", isBlocked(t3, [t3, { id: "y2", status: "doing" }]) === true);

console.log("── estimatedMinutes / Quick Win ──");
ok("null → 不是 Quick Win", isQuickWin({ estimatedMinutes: null }) === false);
ok("15 → Quick Win", isQuickWin({ estimatedMinutes: 15 }) === true);
ok("16 → 不是 Quick Win", isQuickWin({ estimatedMinutes: 16 }) === false);
ok("門檻常數 = 15 集中管理", QUICK_WIN_MAX_MINUTES === 15);
ok("normalize: '' → null", normalizePatch({ estimatedMinutes: "" }).estimatedMinutes === null);
ok("normalize: -5 → null", normalizePatch({ estimatedMinutes: -5 }).estimatedMinutes === null);
ok("normalize: NaN → null", normalizePatch({ estimatedMinutes: "abc" }).estimatedMinutes === null);
ok("normalize: 2.5(小數) → null", normalizePatch({ estimatedMinutes: 2.5 }).estimatedMinutes === null);
ok("normalize: '30'(字串數字) → 30", normalizePatch({ estimatedMinutes: "30" }).estimatedMinutes === 30);

console.log("── Normalize（owner/waitingFor/dependsOn/tags）──");
ok("waitingFor 只有空白 → undefined → waiting=false", (() => { const p = normalizePatch({ waitingFor: "   " }); return p.waitingFor === undefined && !isWaiting({ waitingFor: p.waitingFor }); })());
ok("owner trim", normalizePatch({ owner: " 張良 " }).owner === "張良");
ok("owner 空字串 → undefined", normalizePatch({ owner: "" }).owner === undefined);
ok("dependsOn 去重/去空/去自己", (() => { const p = normalizePatch({ dependsOn: ["b", "b", "", "a", " "] }, "a", [{ id: "a" }, { id: "b" }]); return p.dependsOn.join() === "b"; })());
ok("tags 去重去空", normalizePatch({ tags: ["a", "a", "", " b "] }).tags.join() === "a,b");
ok("JSON 存檔會丟掉 undefined key（owner 清空後不留欄位）", !("owner" in JSON.parse(JSON.stringify(mergeTask({ id: "z", owner: "x" }, { owner: "" }, [])))));

console.log("── 刪除＝同一次寫回（任務+引用一起清）──");
const before = [
  { id: "p", status: "todo", dependsOn: ["q"] },
  { id: "q", status: "todo" },
  { id: "r", status: "todo", dependsOn: ["q", "p"] },
];
const after = removeTaskAndRefs(before, "q");
ok("q 被刪掉", !after.some(t => t.id === "q"));
ok("p 的引用被清", after.find(t => t.id === "p").dependsOn.length === 0);
ok("r 只清 q、保留 p", after.find(t => t.id === "r").dependsOn.join() === "p");

console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
