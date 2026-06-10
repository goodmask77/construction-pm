// 「唯一真相快照」builder（純函式）。App 存檔時用它把目前空間的權威資料寫進 pm_bot_context；
// 未來 LINE bot 只讀這一個 key 就拿到「跟畫面一致、不漏、不重算」的全部資料。
import { catEstAfter, catPaid, catUnpaidAfter, isFundingCat, withPettyItems, projectTotals } from "./cost.js";

export function buildBotSnapshot({ space, settings, cats, petty, journal = [], events = [], plans = [] }, nowISO) {
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
    issues: allItems.filter((i) => i.status === "issue").map((i) => i.name).slice(0, 50),
    journalRecent: (journal || []).slice(0, 10).map((j) => ({ date: j.date || "", title: j.title || "", content: (j.content || "").slice(0, 120) })),
    eventsUpcoming: (events || [])
      .filter((e) => e.date && new Date(e.date) >= new Date(now.getTime() - 7 * 86400000))
      .slice(0, 20)
      .map((e) => ({ date: e.date, title: e.title, cat: e.catName || "" })),
    plansOpen: (plans || []).filter((p) => !p.done).slice(0, 30).map((p) => ({ title: p.title, priority: p.priority || "中", due: p.dueDate || "" })),
  };
}
