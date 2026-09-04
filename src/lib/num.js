// 數字輸入框共用規則（避免「卡 0」bug）
// 問題：把數字 0 直接綁到 <input> 會顯示 "0"，使用者打字變 01000，要先刪 0。
// 解法：顯示時 0 一律留空（配 placeholder="0"），輸入時解析回數字。
// 用法：<input value={blankZero(x)} onChange={e=>set(parseNum(e.target.value))} placeholder="0" />

export const parseNum = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };

// POS 品項 key 正規化（A Beach：內用/Uber 同品項只差 emoji → 去 emoji/空白合併）
// 營運報表（Finance 品項明細/成本主檔 pm_pos_costs 的 key）與 供應鏈成本分析「同步成本」共用同一套算法，key 才對得上（資料一致鐵則）
export const abNorm = (name) => String(name).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, "").replace(/\s+/g, "");
// 顯示用：0 / 空 → ""（讓使用者直接輸入），其餘照原值
export const blankZero = (n) => (n === 0 || n === "0" || n == null || n === "") ? "" : n;
