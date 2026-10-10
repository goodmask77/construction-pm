// 阿桑 boss-api 端點表（v4.70.41 從 boss-sync.js 搬出來：DD 資料覆蓋自檢 _ddcoverage.js 也要讀同一份，避免兩邊各寫一份漏接）
// 新增一個端點＝在這裡加一行；DD 會自動（1）摘要一行（2）query_boss 代查得到（3）每日自檢列進健康頁——不用再去 line-webhook 手接
// 端點表（照 SKILL §3.1；orders/summary 刻意不同步＝SKILL 建議用自己的 orders 算）
// 2026-10-04 張良收斂：「桑這邊其實只需要繼續接叫貨訂單＋物料價格規格」→ 日常只同步 ord/ordi/menu（物料價格規格）
// ＋inc（/prep 異常通知頁在用）＋sett（對帳）。其餘停更：營收=日結信自己的、班表/出勤=NUEiP、revm 歷史已入庫不會變、
// prep/rout/staff/temp 沒在用（月檔資料留著不刪，AI 讀到過期月自然淡出）。要復活＝把 slug 從 OFF 拿掉。
export const OFF = new Set(['revd', 'revm', 'sched', 'staff', 'att', 'ot', 'prep', 'rout', 'temp'])
export const EPS = [
  { ep: 'revenue/daily', slug: 'revd', pk: r => r.date, df: r => r.date, back: 14, fwd: 0 },
  { ep: 'revenue/monthly', slug: 'revm', pk: r => r.month, snapshot: 1 }, // 2026-10-04 阿桑新增：iCHEF 時代 2021-02 起月營收（無 from/to 參數→快照全抓）
  { ep: 'revenue/settlement', slug: 'sett', pk: r => r.date, df: r => r.date, back: 7, fwd: 0 },
  { ep: 'orders', slug: 'ord', pk: r => r.order_id, df: r => String(r.created_at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'orders/items', slug: 'ordi', pk: r => r.line_id, df: r => String(r.ordered_at || r.created_at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'costs/menu', slug: 'menu', pk: r => r.menu_id, snapshot: 1 },
  { ep: 'hr/schedule', slug: 'sched', pk: r => r.shift_id, df: r => r.work_date, back: 7, fwd: 35 },
  { ep: 'hr/staff', slug: 'staff', pk: r => r.staff_id, snapshot: 1 }, // 含離職不刪（歷史 *_staff_id 會指到）
  { ep: 'hr/prep', slug: 'prep', pk: r => r.submit_id, df: r => String(r.at || '').slice(0, 10), back: 14, fwd: 0 },
  { ep: 'hr/routine', slug: 'rout', pk: r => `${r.biz_date}|${r.task_id}`, df: r => r.biz_date, back: 7, fwd: 0 },
  { ep: 'hr/attendance', slug: 'att', pk: r => r.event_id, df: r => r.date, back: 31, fwd: 0 },
  { ep: 'hr/overtime', slug: 'ot', pk: r => r.event_id, df: r => r.date, back: 31, fwd: 0 },
  { ep: 'ops/incidents', slug: 'inc', pk: r => r.incident_id, df: r => String(r.created_at || '').slice(0, 10), back: 45, fwd: 0 },
  { ep: 'ops/temp-alerts', slug: 'temp', pk: r => r.reading_id, df: r => String(r.recorded_at || '').slice(0, 10), back: 7, fwd: 0 },
  // ── 2026-10-10 阿桑公告「新增 8 個端點（物料庫即時讀取用）」：公告當晚實測全 404＝尚未真的上線 → 先預接（pend:1）
  //    404 時安靜記 live:0 不算錯誤；第一次打通自動入庫＋DD 私訊審核人一次（之後畫面再接）。欄位未定→主鍵用候選欄位+內容雜湊兜底
  { ep: 'products', slug: 'prod', pk: r => pkOf(r, ['product_id', 'id', 'code', 'sku']), snapshot: 1, pend: 1 }, // AB 叫貨商品主檔（標準單價/規格/廠商）
  { ep: 'suppliers', slug: 'sup', pk: r => pkOf(r, ['supplier_id', 'id', 'name']), snapshot: 1, pend: 1 }, // AB 廠商（叫貨日/休息日/帳期）
  { ep: 'recipes', slug: 'rcp', pk: r => pkOf(r, ['recipe_id', 'id', 'menu_id', 'name']), snapshot: 1, pend: 1 }, // AB 配方（yield_qty 一批原料用量）
  { ep: 'costs/items', slug: 'citem', pk: r => pkOf(r, ['item_id', 'product_id', 'id', 'code', 'name']), snapshot: 1, pend: 1 }, // AB 每品項單位成本
  { ep: 'gops/products', slug: 'gprod', pk: r => pkOf(r, ['product_id', 'id', 'code', 'sku']), snapshot: 1, pend: 1 }, // GD 產品（price/cost/stock/safe/station/store）
  { ep: 'gops/suppliers', slug: 'gsup', pk: r => pkOf(r, ['supplier_id', 'id', 'name']), snapshot: 1, pend: 1 }, // GD 廠商
  { ep: 'gops/orders', slug: 'gord', pk: r => pkOf(r, ['order_id', 'id']), df: r => String(r.created_at || r.ordered_at || '').slice(0, 10), back: 14, fwd: 0, pend: 1 }, // GD 叫貨單（含向 AB 央廚）
  { ep: 'gops/orders/items', slug: 'gordi', pk: r => pkOf(r, ['line_id', 'id']), df: r => String(r.ordered_at || r.created_at || '').slice(0, 10), back: 14, fwd: 0, pend: 1 }, // GD 叫貨明細＋驗收結果
]
// 主鍵兜底：依序找候選欄位，都沒有就用整列內容雜湊（穩定、同列同鍵）
function pkOf(r, keys) {
  for (const k of keys) if (r && r[k] != null && String(r[k]).length) return String(r[k])
  let h = 0; const s = JSON.stringify(r); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return 'h' + (h >>> 0).toString(36)
}

