# SequenceView 開發規格書（工序即日誌 v1）

定案原則：**工序 = 主體，日誌 = 工序時間軸上的事件。** 「工作日誌」分頁併入「工序」，導覽列為 總覽 / 看板 / 明細 / **工序** / 檔案庫 / AI設定 / 帳號。

---

## 1. 視角（v1 只有兩個）

- **週（預設）**：16 週甘特巨觀。工序條 = 五色狀態色，條上疊事件點。老闆全局視角。
- **日**：點工序 ▸ 自動切入並展開該列（最多 3 列）成事件卡軌道；其餘列維持細條 + 事件點。
- 列表模式 → **phase 2**（純加法 feed，週視圖事件點 + AI 週報已覆蓋老闆掃近況）。

## 2. 狀態列舉（沿用 ground-pm 五色）

| key | 標籤 | 條色 |
|---|---|---|
| pending | 待開工 | #aeb4c2 |
| doing | 施工中 | #5b9be8 |
| done | 完成 | #54c47a |
| issue | 問題/延遲 | #e86a5b |
| wait | 等待材料 | #e8a24b |

建議工序狀態可由當天日誌**自動帶**：prog=100 → done；issue 有值 → issue；其餘維持手動。

## 3. 事件點顏色（只有三種，與五色脫鉤）

- 預排（log.date > 今天）→ 黃 `#E8B84B`
- 有問題（log.issue 非空）→ 紅 `#d63b2b`
- 一般紀錄 → **白 `#fff` + 1px 深色細邊**（確保任何顏色條上都看得見）

## 4. 斷代示警

施工中 / 等待材料且已開工的工序，距今 ≥ `WARN_DAYS`（預設 3，寫成可調參數）無紀錄 → 左側工項名跳 ⚠。

## 5. 互動規則

- 週視圖點工序 ▸ → 切日 + 展開該列 + 捲到該段。
- 日視圖點 ▸ → 展開/收起（最多 3，超過自動收最早）。
- 事件點：hover → Notion 泡泡（工序·日期·摘要·照片數）；click → 開 Drawer。
- 展開列空白處 click（限工期內）→ Drawer 新增；卡片 click → Drawer 編輯。
- 未來日期自動為「預排」（填 next）；今天/過去為「紀錄」（填 done/issue/next）。

## 6. Supabase 資料表

```sql
-- 專案（W1 錨點）
projects (
  id uuid pk, name text, start_date date  -- 週/日座標皆由此推算
)

-- 工序（取代目前前端寫死的 ITEMS）
work_items (
  id uuid pk, project_id uuid fk,
  name text, sort_order int,
  planned_start date, planned_end date,    -- 前端換算 sw/dur
  status text check (status in ('pending','doing','done','issue','wait'))
)

-- 日誌 = 事件（每工序每日一筆，upsert）
work_logs (
  id uuid pk, project_id uuid fk,
  item_id uuid fk work_items,
  log_date date,
  done text, issue text, next text,
  prog int check (prog between 0 and 100),
  photos jsonb,                            -- [{url, caption}]，url 指向 Storage
  author text, created_at timestamptz, updated_at timestamptz,
  unique (item_id, log_date)
)
```
照片：上傳 Supabase Storage bucket（如 `site-photos/{project}/{item}/{date}/`），把 public/signed URL 存進 `photos` jsonb。

## 7. 前端接線清單（SequenceView.jsx 內 `// ⇨` 標記處）

1. `SEED_LOGS` / `ITEMS` → 改成由 `work_logs` / `work_items` 的 fetch。
2. `saveLog` → `upsert(work_logs)`；`delLog` → `delete`。
3. Drawer `setStatus` → `update(work_items.status)`。
4. Drawer `addPhotos` → 改成上傳 Storage、回填 URL（目前用 createObjectURL 僅供預覽）。
5. `aiTidy` / `aiWeekly` → 接 AI 顧問後端（送 photos + 草稿 / 本週 logs）。
6. `PROJECT_START` → 改讀 `projects.start_date`。

## 8. Phase 2（介面確認後再加）

- 拖拉工序條改工期（update planned_start/end）
- 拖照片進事件軌道直接建紀錄
- 列表模式（時間倒序跨工序 feed）
- AI 自動週報後端串接
- 多門店：work_items 範本複製（1 店 → N 店）
