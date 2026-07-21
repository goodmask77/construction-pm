// ── P3 薪資試算引擎（純函式；App 薪資頁與 D哥 共用同一套——資料一致鐵則）──
// ⚠ 試算＝草稿參考：正式發薪以人工核定為準；加班費/費率規則建議經勞資顧問覆核。
// 勞基法參數全部存 sp_crew_pay_rules（App「⚙ 薪資/勞基法設定」頁可改），
// 並支援「預排調整」：設定生效日＋新值（例：明年基本工資調漲），到期自動切換、不用改程式。

// 預設參數（2026 現行值先帶入；設定頁可改、以設定頁為準）
export const PAY_DEFAULTS = {
  minWageMonthly: 28590,   // 基本工資（月薪）
  minWageHourly: 190,      // 基本工資（時薪）
  otRate1: 1.34,           // 平日延長工時前 2 小時倍率（勞基法 §24）
  otRate2: 1.67,           // 平日延長工時第 3-4 小時倍率
  dailyRegularHours: 8,    // 每日正常工時
  monthlyBaseHours: 240,   // 月薪換算時薪的除數（月薪 ÷ 240）
  laborInsRate: 0.115,     // 勞保費率（含就保）
  laborInsEmpShare: 0.2,   // 勞保自付比例（雇主 0.7、政府 0.1）
  laborInsErShare: 0.7,
  healthInsRate: 0.0517,   // 健保費率
  healthInsEmpShare: 0.3,  // 健保自付比例（雇主 0.6、政府 0.1）
  healthInsErShare: 0.6,
  pensionRate: 0.06,       // 勞退雇主提繳 6%
  scheduled: [],           // 預排調整 [{effective:"2027-01-01", patch:{minWageMonthly:29500, minWageHourly:196}, note:"2027基本工資調整"}]
  updatedAt: null,
};

// 取某日期適用的參數：套用所有「生效日 <= 該日」的預排調整（照生效日排序疊加）
export function rulesAt(doc, dateISO) {
  const base = { ...PAY_DEFAULTS, ...(doc || {}) };
  const sched = [...(base.scheduled || [])].filter(s => s.effective && s.effective <= dateISO).sort((a, b) => a.effective.localeCompare(b.effective));
  let out = { ...base };
  for (const s of sched) out = { ...out, ...(s.patch || {}) };
  return out;
}

// 判斷 PT（時薪制）：名冊職稱含 PT/工讀/時薪
export const isHourly = (title) => /pt|工讀|時薪/i.test(String(title || ""));

const n = (v) => { const x = Number(String(v ?? "").replace(/[^\d.]/g, "")); return isFinite(x) ? x : 0; };

// 單日工時 → {reg, ot1, ot2}（正常／延長前2小時×1.34／再往後×1.67；超過法定上限的部分試算仍以 1.67 估）
export function splitDayHours(hours, rules) {
  const r = rules.dailyRegularHours;
  const reg = Math.min(hours, r);
  const ot1 = Math.max(0, Math.min(hours - r, 2));
  const ot2 = Math.max(0, hours - r - 2);
  return { reg, ot1, ot2 };
}

// 月試算：person=名冊人(薪資欄位) title=職稱 days=[{date, hours}]（實卡或班表模擬時數）
export function calcMonthPay({ person, title, days, rules }) {
  const hourly = isHourly(title);
  const wage = n(person.baseSalary) || (hourly ? rules.minWageHourly : rules.minWageMonthly);
  const hourRate = hourly ? Math.max(wage, rules.minWageHourly) : Math.max(wage, rules.minWageMonthly) / rules.monthlyBaseHours;
  let reg = 0, ot1 = 0, ot2 = 0;
  for (const d of days || []) { const s = splitDayHours(d.hours || 0, rules); reg += s.reg; ot1 += s.ot1; ot2 += s.ot2; }
  const round = (x) => Math.round(x);
  const basePay = hourly ? round(reg * hourRate) : wage;                       // 月薪制底薪固定；時薪制＝正常時數×時薪
  const otPay = round(ot1 * hourRate * rules.otRate1 + ot2 * hourRate * rules.otRate2);
  const allowance = round(n(person.mealAllow) + n(person.studyAllow));          // 津貼（名冊：伙食/學習補助；時薪制多半為 0）
  const laborBase = n(person.laborIns), healthBase = n(person.healthIns);
  const laborSelf = round(laborBase * rules.laborInsRate * rules.laborInsEmpShare);
  const healthSelf = round(healthBase * rules.healthInsRate * rules.healthInsEmpShare);
  const gross = basePay + otPay + allowance;                                    // 應發
  const net = gross - laborSelf - healthSelf;                                   // 預估實領（未含所得稅/其他代扣）
  const employerCost = gross
    + round(laborBase * rules.laborInsRate * rules.laborInsErShare)
    + round(healthBase * rules.healthInsRate * rules.healthInsErShare)
    + round((laborBase || (hourly ? gross : wage)) * rules.pensionRate);        // 勞退以勞保投保額(無則以工資)估
  return { hourlyMode: hourly, wage, hourRate: Math.round(hourRate * 100) / 100, hours: { reg: r1(reg), ot1: r1(ot1), ot2: r1(ot2), total: r1(reg + ot1 + ot2) }, basePay, otPay, allowance, laborSelf, healthSelf, gross, net, employerCost };
}
const r1 = (x) => Math.round(x * 10) / 10;

export function monthSummary(rows) {
  const sum = (k) => rows.reduce((a, b) => a + (b.pay?.[k] || 0), 0);
  return { people: rows.length, gross: sum("gross"), net: sum("net"), employerCost: sum("employerCost"), otPay: sum("otPay") };
}
