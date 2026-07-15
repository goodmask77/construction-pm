# TASK_OS_DESIGN.md — Ground PM 任務系統 產品北極星

> 這是「產品規格」：回答 Ground PM 最後會長成什麼樣。
> 它**不是** Sprint 工作單。工程規格只回答「這一週做什麼」（見各 Sprint 工作單）。
> Sprint 2（Today/Home）開工時，以本文件為依據。

## 核心設計原則

- 若某個 View 被拿掉，使用者失去的若只是「另一種排列方式」，這個 View 就不該存在。
- **Today 是 Home**（每天打開的落地頁），不是第七個並列的 View。
- Single Source of Truth：所有 View 共用同一份 Task 資料，不建立任何 View 專屬資料。
- **Every View answers a different operational question.**

## View 藍圖（規劃中）

- Today (Home)
- Project
- Workflow
- List
- Timeline
- Gantt
- Mindmap

## View Mapping Table（北極星）

> ⚠️ 待補：張良與 GPT 十幾輪討論沉澱出的「View 定位表」——每個 View 回答什麼問題、
> 隱藏什麼、拿掉會失去什麼。請把那張表貼進這一節。
> （Sprint 1 刻意不含它：資料地基階段不需要思考 View。）

## 進度

- ✅ Sprint 1：Task Object Foundation（owner / waitingFor / dependsOn / estimatedMinutes、
  derived state 不落地、Merge Rule、normalize、循環防護、D哥同步、Quick Win 定義）
- ✅ Sprint 2：Today / Home（2026-07-16）——任務中心預設落地頁，獨立於六視角之外。
  區塊（每任務依緊急度只出現一次、全部即時推導）：今天必處理(逾期+今日) → 進行中 →
  被前置卡住(含「等：前置名單」) → 在等別人 → Quick Wins(≤15分，Sprint 1 定義的首次 UI) →
  接下來 7 天。含問候列一眼總覽與 all-clear 空狀態。
- ⚠️ View Mapping Table 仍待張良貼入本文件；貼入後若與現行 Today 佈局有出入，依表調整。
