// 「唯一真相快照」builder（純函式）。App 存檔時用它把目前空間的權威資料寫進 pm_bot_context；
// 未來 LINE bot 只讀這一個 key 就拿到「跟畫面一致、不漏、不重算」的全部資料。
import { catEstAfter, catPaid, catUnpaidAfter, isFundingCat, withPettyItems, projectTotals } from "./cost.js";

// 工序 itemId（cat / cat::sub / cat::ci::costItem）→ 可讀名稱
function seqItemName(cats, itemId) {
  if (!itemId) return "";
  const [cid, mid, iid] = String(itemId).split("::");
  const cat = (cats || []).find((c) => c.id === cid);
  if (!cat) return itemId;
  if (!mid) return cat.name;
  if (mid === "ci") { const it = (cat.items || []).find((x) => x.id === iid); return `${cat.name}／${it?.name || iid}`; }
  const sub = (cat.seqSubs || []).find((s) => s.id === mid); return `${cat.name}／${sub?.name || mid}`;
}

export function buildBotSnapshot({ space, settings, cats, petty, journal = [], events = [], plans = [], seqLogs = [], issues = [] }, nowISO) {
  const now = nowISO ? new Date(nowISO) : new Date();
  const display = withPettyItems(cats || [], petty);
  const real = (display || []).filter((c) => !isFundingCat(c));
  const totals = projectTotals(display); // {est, paid, unpaid}（含零用金、排除撥款帳）
  const allItems = real.flatMap((c) => c.items || []);
  const totalItems = allItems.length;
  const doneItems = allItems.filter((i) => i.done || i.status === "done").length;

  const spends = (petty && petty.spends) || [];
  const advances = (petty && petty.advances) || [];
  const advTotal = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const spendTotal = spends.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const pettyByCat = {};
  spends.forEach((s) => {
    const c = (cats || []).find((x) => x.id === s.catId);
    const k = c ? c.name : "（未歸類）";
    pettyByCat[k] = (pettyByCat[k] || 0) + (Number(s.amount) || 0);
  });

  const targetDate = settings?.targetDate || "";
  const daysLeft = targetDate ? Math.ceil((new Date(targetDate) - now) / 86400000) : null;

  // 工序：近 ±21 天的日誌（日期／工項／做了什麼／預計／是否異常）＋ 急件🔥
  const lo = new Date(now.getTime() - 21 * 86400000), hi = new Date(now.getTime() + 21 * 86400000);
  const seqEntries = (seqLogs || [])
    .filter((l) => l && l.date)
    .filter((l) => { const d = new Date(l.date); return d >= lo && d <= hi; })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 120)
    .map((l) => ({ date: l.date, item: seqItemName(cats, l.itemId), done: l.done || "", next: l.next || "", issue: !!l.issue }));
  const urgent = [];
  (cats || []).forEach((c) => {
    if (c.urgent) urgent.push(c.name);
    (c.seqSubs || []).forEach((s) => { if (s.urgent) urgent.push(`${c.name}／${s.name}`); });
    (c.items || []).forEach((it) => { if (it.seq?.urgent) urgent.push(`${c.name}／${it.name}`); });
  });

  // ToDo（待辦）：未完成事項
  const todo = (issues || [])
    .filter((i) => i && (i.status || "open") !== "done")
    .slice(0, 80)
    .map((i) => ({ desc: i.desc || "", category: i.category || "其他", due: i.due || "", track: !!i.track }));

  return {
    space,
    updatedAt: now.toISOString(),
    project: {
      name: settings?.projectName || "",
      address: settings?.projectAddress || "",
      owner: settings?.ownerName || "",
      contractor: settings?.contractorName || "",
      targetDate,
      daysLeft,
      notes: settings?.notes || "",
    },
    totals,
    progress: {
      doneItems,
      totalItems,
      pct: totalItems ? Math.round((doneItems / totalItems) * 100) : 0,
      doneCats: real.filter((c) => c.status === "done").length,
      totalCats: real.length,
    },
    cats: real.map((c) => ({
      name: c.name,
      status: c.status || "pending",
      est: catEstAfter(c),
      paid: catPaid(c),
      unpaid: catUnpaidAfter(c),
      items: (c.items || []).length,
      done: (c.items || []).filter((i) => i.done || i.status === "done").length,
      assignee: c.assignee || "",
      payAccount: c.payAccount || "",
    })),
    petty: { advances: advTotal, spends: spendTotal, balance: advTotal - spendTotal, byCat: pettyByCat },
    seq: { logs: seqEntries, urgent },
    todo,
    issues: allItems.filter((i) => i.status === "issue").map((i) => i.name).slice(0, 50),
    journalRecent: (journal || []).slice(0, 10).map((j) => ({ date: j.date || "", title: j.title || "", content: (j.content || "").slice(0, 120) })),
    eventsUpcoming: (events || [])
      .filter((e) => e.date && new Date(e.date) >= new Date(now.getTime() - 7 * 86400000))
      .slice(0, 20)
      .map((e) => ({ date: e.date, title: e.title, cat: e.catName || "" })),
    plansOpen: (plans || []).filter((p) => !p.done).slice(0, 30).map((p) => ({ title: p.title, priority: p.priority || "中", due: p.dueDate || "" })),
  };
}
