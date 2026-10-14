# abgd 搬家：三家 AI 關卡紀錄（張良回來看「分歧與 CC 的選擇」）

> 流程：每關 OpenAI（gpt-6.1-sol）、Gemini（gemini-pro-latest）、獨立 Claude（子代理，不看 CC 答案）第一輪各自審 → 第二輪交換 → 共識全修 → 分歧選較安全做法。原始回覆存本機 scratchpad（gate1/、gate2/…），這裡只記結論。

## 關卡 1：盤點與搬遷順序（2026-10-14）
送審：docs/FEATURE_MAP.md v1。

### 第一輪
| 家 | 結論 | 最重要的意見 |
|---|---|---|
| OpenAI | **暫不通過** | ①寫入權要按「資料域」切不是按頁面（pm_inv／pm_menu／pm_points 多頁共用）②同步橋要 GD 端 trigger＋outbox＋每鍵 rev、初始快照後重播、tombstone、死信佇列③入口切換要狀態機＋writer epoch，切回前先封新寫、排空反向同步④DD 寫入動作要從第 0 波就走命令路由⑤影子不得有外部副作用（發訊、扣點、付款）⑥風險全面調高（SOP 食安、班表、權限、月帳、發文、信箱）⑦補資料字典、檔案／機密／備份工作包、客人端網址清單⑧排程隨資料域交接、財務影子提早起跑 |
| Gemini | 有條件 | ①Storage 543 檔沒列搬遷＝高②名冊 F26／入職 F27 要提前到地基（RLS 靠人）③銷售數據要跟成本一起或先搬；pm_inv 第 1 波④DD 動作跟功能走，不能最後⑤同步用 DB trigger 推送、X-Sync-Source 防迴圈、軟刪除、死信⑥切回要先確保反向同步強一致⑦班表、物料庫／採購調高風險⑧Meta／LINE 回呼網址先登記⑨N+1 用查詢次數監控擋⑩連線池＋RLS 注入⑪LINE 推播雙發要有唯一發送鎖⑫每小時備份大表 |
| Claude（獨立） | 有條件 | ①盤點漏「誰在寫」欄：DD 寫 prep_bind／perm／sop_issues／tasks／名冊，排程 inline-sync／cron-daily／task-remind 建任務，joya-intraday 一支跨五功能②舊主 App 是 pm_bot_context 唯一寫入者＋打卡站前端＋零用金直寫，不能單純「不搬」③漏短網址 /v/、partner-api 12 端點、salary 頁、sw.js、DD 鍵家族、abmod 歸位④64 個 env 只列一半⑤同步橋分兩層（鏡像＋投影）、GD 大表加 rev＋tombstone⑥任務 F03 是寫入者最多的資料，不能第 1 波⑦身分＋名冊＋權限翻譯整個進第 0 波（55 處 permWho 姓名制）⑧core.members 與 GD 客人表撞名 |

### CC 已採納（寫進 FEATURE_MAP v2 與 ABGD_FOUNDATION.md）
- 地基加：名冊／物料／供應商／商品主檔唯讀影子、Storage 搬遷、每小時備份、資料字典（docs/ABGD_DATA_DICT.md）、DD 命令路由、writer owner＋epoch、外部副作用鎖（影子不發訊）。
- 同步橋：GD 端 trigger＋outbox＋rev＋tombstone＋死信；初始快照後重播。
- 入口切換：狀態機（shadow→ready→switching→abgd→rolling_back→gd）；切回先封新寫、排空反向同步。
- 風險：SOP／班表／物料庫／採購／權限／月帳／發文／信箱／名冊／入職 → 高。
- 順序：0 地基＋主檔 → 1 現場低風險 → 2 食材成本＋銷售數據 → 3 inline／行銷 → 4 溝通／人資 → 5 客人面 → 6 錢轉正 → 7 DD 主程式／排程收尾（排程隨資料域交接，不是全部最後）。

### 分歧與 CC 的選擇
- 同步觸發：Gemini 主張 trigger 直接呼叫 Edge Function 推送；OpenAI 主張 trigger 只寫 outbox、worker 拉。**CC 選 outbox＋拉**（trigger 不打網路，GD 寫入不受外部影響）。
- 財務影子起跑：OpenAI 主張依賴齊備就提早；FEATURE_MAP 原排最後。**CC 選提早**：銷售數據進新表後就開始跑點數／薪資影子計算，但只算不發。

### 第二輪（交換意見，看完別家＋FEATURE_MAP v3）
| 家 | 結論 | 條件／仍不同意 |
|---|---|---|
| OpenAI | 不通過 | 要先寫成可執行契約：資料域所有權表＋封鎖機制、同步／回退契約、身分權限對照、跨域副作用矩陣、波次矛盾（F16／abmod／pm_menu／任務邊界）、檔案敏感分類、盤點退役證據。不同意：Gemini 的 trigger 推 HTTP 與強一致反向；Claude 的 max-id 游標；pm_bot_context 稱「唯一真相」矛盾 |
| Gemini | 有條件通過 | 條件：Storage 並行期雙向存取、pm_bot_context 過渡期由 GD 端 cron 產生、DD 代查也走 adapter、Supavisor 連線池＋入口設定 no-store。收斂：改站輪詢 rev、同意 DD adapter、同意身分權限提前 |
| Claude | 有條件通過 | H1 公司／店歸屬欄、H2 身分＋權限進第 0 波、H3 hr.js 拆單、H4 切換／切回規格、H5 DDL 草案、H6 兩個命名先問張良（core.members 改名、新鍵 prep_routes）、H7 影子無副作用全站規則、H8 第 0 波拆 0a／0b 分段驗收。新發現：hr.js 同時寫 F15／F26／F30；v3 寫 cron-daily 有 SOP 超時是錯的 |

### CC 的裁決（關卡 1 結案：有條件通過，條件已全部補成文件後再開第 2 步）
- 採最安全路線：先補齊文件再寫程式。已補：docs/ABGD_DOMAINS.md（資料域所有權＋公司店歸屬規則＋跨域命令矩陣＋切換驗收案例）、docs/ABGD_WRITERS.gen.md（機器產生寫入者清單）、FEATURE_MAP v4（F16 改第 2 波、abmod 歸 F15、F18 與 F12 同域同波、DD 代查也走 adapter、pm_bot_context 改 GD 端 cron、Storage 雙向存取、no-store、hr.js 拆段、cron-daily 描述修正）、abgd/docs/ABGD_FOUNDATION.md v2.2（同步／切換／身分契約與 DDL 草案）。
- 分歧：同步觸發＝outbox＋worker 領取（不推 HTTP、不用 max-id）；反向同步＝凍結→排空（不承諾強一致）；名冊＝身分／權限第 0 波、編輯頁第 4 波。
- 命名兩題改成「問張良但不阻塞」：core.members → 暫用 core.memberships；GD 新鍵暫用 sp_finance_pm_prep_routes；張良回覆再改。

## 關卡 2：資料表設計／登入／同步橋／入口切換（2026-10-14）
送審：abgd/docs/ABGD_FOUNDATION.md v1 → v2.1 → v2.2。

### 第一輪
| 家 | 結論 | 最重要的意見 |
|---|---|---|
| OpenAI | 不通過 | users／members 兩套身分；RLS 只隔公司不隔店／功能；settings PK 不合法；docs 表不能放流水；service key 無 RLS 第二道牆；佔位帳號拿不到 session；cookie 不可撤銷；max-id 游標漏晚提交；快照不一致；部分成功破壞對帳；editor 可偽造；writer owner 在入口擋不住在途交易；feature≠可切換單位；自動切回門檻太粗；對帳要比實存資料；備份漏會員真表；migration 改「禁止破壞性」而非只准新增 |
| Gemini | 有條件 | 37 MB 家族不能進 docs；settings PK；假 email 撞名；HMAC 要 nonce；service key 拔掉 RLS；cookie 與撤銷脫鉤；outbox 不存整包；worker 併發要鎖；反向條件更新熱點卡死要重試；死信觸發的切回要人工；SOP 照片私桶破圖；private cache 失效；冷資料分離 |
| Claude（獨立） | 有條件 | 閘門必須進資料庫（12 個檔各自 kvGet／kvPut、主 App 用 JWT 直寫、93 處 sopWho 只 55 處守門）；RLS 第二道牆與 updated_at 條件更新都不存在；自管 cookie 下 auth.uid() 空；改 Supabase 真 session；DB trigger 管 rev；反向整包投影；切回 cron 在 abgd 自己身上會死鎖；補 switching 凍結窗；權限語意對照（沒設定＝允許）；影子副作用總開關；個資加密金鑰 |

### 第二輪
| 家 | 結論 | 裁決與條件 |
|---|---|---|
| OpenAI | 不通過 | A（自管＋set_config）有條件可行、B 也合法；完整接管的文件採 D 整包投影、C 只作例外；不同意假 uuid 店、依年份不同步；擋關：editor 當通行證、pm_kv_patch 版本比對非原子、快照又用 max-id、租約與同鍵順序、提交級 fencing、RLS 功能讀取、租戶撞名、副作用／會員／備份閉環。要用最小驗證程式證明越權、併發、晚提交、刪後重建、切換中斷 |
| Gemini | 有條件通過 | 條件：改 Supabase 原生 session、反向整包投影、event_id 冪等。另：業務交易只寫 dirty、鏡像層可省、冷資料進 archive 無外鍵 |
| Claude | 有條件通過 | 改口採 A（自管＋set_config）但要四硬條件（nobypassrls 專用角色、force RLS、完整 claims、CI 證據）；C vs D 採 D；SQL v3 三題：editor 確定可繞、pm_kv_patch 非原子、領取制有重複 done／同鍵死信跳過／跨庫 done 不原子；另：GD 主 App src/supa.js 寫入失敗只 console.warn＝假存檔，ABGD_LOCKED 要有可見錯誤 |

### CC 的裁決（關卡 2：採多數＋較安全）
- 登入：**B Supabase 原生 session**（Gemini、Claude 主張；OpenAI 認可合法）。反向：**D 整包投影＋event_id＋epoch**（三家一致）。閘門：可信上下文（RPC 內 set_config）取代 editor。outbox：lease token＋CAS＋同鍵序列化＋一致讀取；快照不截斷。settings：NULL＋部分唯一索引（OpenAI）而非假 uuid（Gemini）。冷資料：archive schema 無外鍵（Gemini）但以「封存狀態」而非年份判定（OpenAI）。鏡像層保留（OpenAI／Claude 要重播層；Gemini 認為多餘→18 MB 不構成負擔）。
- 登入 A vs B 最終：Gemini B、Claude 改 A、OpenAI 兩者皆可 → **選 B（Supabase 原生 session）**：少一套自訂角色／RLS 注入程式＝攻擊面較小，兩庫已設 autoconfirm／disable_signup／jwt 15 分。
- **最小驗證程式已跑過（2026-10-14 09:50，abgd-test 東京庫，scripts/test-abgd-bridge.mjs）18/18 通過**：rev 自增、outbox、鎖住後一般角色偽造 editor 被擋、自設 abgd.sync 但 epoch 錯被擋、投影成功／同 event_id 重送 dup 不改資料／錯 epoch 例外回滾不留 applied、領取每鍵一筆、同鍵序列化、錯 token 標不了 done、晚提交事件仍領得到、刪後重建 rev 連續、併發同 event_id 一成功一 dup 無例外。
- SQL 定稿：construction-pm/supabase/migrations/0004_abgd_sync_bridge.sql（v4：可信上下文、owner/epoch fencing、lease token、CAS done、pm_read_current、pm_snapshot、pm_kv_project 先佔 event_id）。
- 待辦（寫進第 0 波）：GD 共用層 kvSet 遇 ABGD_LOCKED 要回可見錯誤並記 errlog（獨立 Claude ②）；worker 單例用租約列。
- **關卡 2 結案：有條件通過，條件已落實（SQL＋測試）；開始寫地基程式。**


## 關卡 2：資料表設計／登入／同步橋／入口切換（2026-10-14）
送審：abgd/docs/ABGD_FOUNDATION.md v1。審查中。

## 進度註記（2026-10-14 10:50）
- 第 0 波程式已上線（abgd v0.2.x、GD v4.71.28），尚未切任何資料域；詳見 docs/FEATURE_MAP.md 5.1。
- 更正：pm_bot_context 是舊主 App「工程」空間的衍生快照，只要工程資料不搬（F37 不搬），由舊主 App 繼續產生即可，不需要 GD 端 cron（原關卡 1 寫法修正）。
- 關卡 3 起每個功能切入口前送審：對帳結果＋程式差異＋速度量測（scripts/perf.mjs）。

## 0.5 波演練：文件庫 F21（2026-10-14 10:30～11:35，正式環境）
| 步驟 | 結果 |
|---|---|
| 切換 library → abgd（控制器：abgd 封寫→GD owner=frozen→等 30 秒＋本域 outbox 排空→owner=abgd epoch=1→GD routes lib→新殼） | ✅（第一次失敗：void RPC 空回應被當 JSON、排空看整個 outbox；修 PR 8 後通過） |
| GD 側欄 tabcfg.routes | ✅ {lib: https://ab-gd.vercel.app/ops/library}（no-store） |
| GD 舊端點寫入（libfold add） | ✅ 資料庫閘門擋下（pm_abgd_locked 紀錄 1 筆）；**發現假成功**：端點仍回 ok → v4.71.29 改回 409 |
| 新殼寫入（新增資料夾）→ 反向投影 → GD 大表 | ✅ rev 2、editor=abgd-sync、JSON 含新資料夾；對帳差 0 |
| 注入錯誤（settings watch_inject）→ 看門狗 | ✅ 3 秒內切回：GD routes 清空、owner=gd；DD 私訊張良；對帳差 0 |
| GD 寫入恢復 → 正向同步 → 對帳 | ✅ 差 0 |
| 測試資料清理 | ✅ 三個演練資料夾已刪（GD 端刪→投影同步） |
| 速度（正式站，張良 session） | /api/ops/library 熱 P50 330 ms／冷 1.1 s；/ops/library 頁 P50 356 ms；首頁 P50 296 ms。**冷啟動與 who() 六次往返待優化（目標 API P95 0.5 s）** |
- 補強已上線：GD 看門狗 ?abgdwatch 每 5 分（新殼健康檢查連 3 次失敗→GD 自己清入口）；abgd 看門狗每分鐘（反向同步錯誤≥3／注入／合成探測）。
- 文件庫目前狀態：**shadow**（writer=gd）。正式切換要過關卡 3（對帳＋程式差異＋速度）後再切。

## 關卡 3：文件庫 F21（2026-10-14）
送審：對帳差 0＋GD 原碼 vs abgd 程式＋速度（熱 P50 330／冷 1.1 s）。
### 第一輪
| 家 | 結論 | 重點 |
|---|---|---|
| OpenAI | 不可切 | 管理者定義（prep_perm admin）、未綁定者預設 level 1、人名清單跨公司、空白改名語意、排序非原子、刪除兩步、紀錄格式、兩段上傳可登記任意物件、回傳 ID 不一致、`abgd:` 路徑舊端讀不到、DD 存檔 writer 矛盾、對帳欄位不足 |
| Gemini | 不可切 | 同上要點＋RLS 寫入過寬可繞 ACL、who() 六次往返、人名清單不必每次撈、桶 20MB 硬限制 |
| Claude（獨立） | 有條件可切 | fileOp 沒驗檔案屬於該夾、uploadDone 信任 path 可登記證件、DD 存檔被擋仍回 ✅、點檔名要同頁預覽、iPad 排序、管理者名單對帳 |
### CC 修正（v0.3.x＋GD v4.71.30，全部上線）
檔案操作限定同公司＋該夾＋未刪、排序／序號原子函式、上傳登記驗路徑／fid／桶內物件／真實大小／回 UUID、上傳過渡期直接進 GD 桶（路徑相容，無前綴）、撤 authenticated 寫入 RLS、who() 一次查＋審核人快取、人名按需且限同公司、身分影子投影（prep_perm／名冊→成員角色／權限例外／gd_role）、DD 存檔走新殼命令（HMAC 冪等）、空白改名保留、dl 截 120、/f/ no-store、updatedAt 最後異動、同頁預覽。
有意差異：新殼一律要登入（不開訪客）；noExport 同 GD 只藏按鈕。
### 第二輪（複審）
| 家 | 結論 | 條件 |
|---|---|---|
| OpenAI | 不可切 | 讀取仍可 REST 直讀繞 ACL；DD 登記只驗前綴；upsert 覆寫；部分成功假報；異動／稽核／同步非同交易；影子投影不處理名單外與錯誤；setacl 無範圍與筆數 |
| Gemini | 有條件可切 | 投影同交易＋rev 守門；刪夾同交易；超大檔刪實體 |
| Claude | 有條件可切 | **回音洗回**（writer=abgd 時 pull 仍投影 GD JSON 回真表）；名冊新人無帳號；noExport 預覽視窗；MIME 欄位；DD idem |
### CC 修正 v4～v6（全部上線；GD v4.71.31）
撤 authenticated SELECT（REST 直讀／直寫實測 401）；`ops.library_op` 單一交易（異動＋稽核＋sync_events）含刪夾子檔、setacl 樂觀鎖＋恰好一筆＋ACL 驗值；DD 登記驗精確路徑＋桶 HEAD＋insert 不覆寫＋逐檔結果＋身分由新殼解析；GD 端只移除登記成功者；`core.perm_apply` 同交易＋`legacy.projection_state` rev 守門＋完整快照語意；超大檔刪實體；writer=abgd 域只鏡像不投影；MIME mimetype；名冊新人自動建帳號（不能編）；noExport 預覽一致。
### 演練 3（正式環境）
JWT 直讀 401／直寫 401；切換 epoch 2；DD 壞路徑拒；新增→改名→改 ACL→push→對帳 0→pull 不洗回→刪→對帳 0→切回→對帳 0。速度 n=30 端到端 P50 569／P95 989 ms（熱單次 ~300）。
### 第三～六輪（最終確認，2026-10-14 下午；中途從 Fable 5.1 換 Opus 5.5，獨立 Claude 第三輪因額度中斷後重跑）
| 輪 | OpenAI | Gemini | Claude | CC 處理 |
|---|---|---|---|---|
| 3 | 不可切：投影先記 rev、writer 快取 15 秒、刪後重送回成功、刪夾與新增並行 | 不可切：info 網址錯（**實測不成立**，兩種網址都 200）、名冊新人沒建帳號（設計是登入時建） | （額度中斷） | v7：鎖資料夾、tombstone 衝突、rev 成功後才提交、writer 即時查、MIME 改 content_type、新人建帳號即套權限；演練 4 全過 |
| 4 | 不可切：租約非原子、讀取吞錯、LINE 衝突吞掉 | 不可切：名單外主管被降級 | **可切** | v8：原子租約＋fencing、鏡像條件寫入、讀取錯誤 throw、LINE 衝突 throw、名單外保留角色 |
| 5 | 不可切：fencing 要同交易、LINE 半套 | **可切** | （已判可切） | v9：rev 提交在資料庫內驗 token；LINE 衝突整份先檢查 |
| 6 | 只剩：同批 LINE 重複、名冊整份單一交易 | — | — | v10：同批重複預檢。**不採用「名冊整份單一交易」**：理由＝中途失敗不提交 rev，下次同 rev 重跑冪等收斂；名冊 14 人、每分鐘重試，風險窗極小。分歧記錄在此 |
### 結案（2026-10-14 15:20）
三家：Gemini、獨立 Claude「可切」；OpenAI 最後一條採用、一條不採用（理由如上，選擇已較安全：衝突一律中止）。
**文件庫 F21 正式切到新殼（epoch 4）**：GD 側欄「文件庫」→ ab-gd.vercel.app/ops/library 自動登入；切後對帳差 0；30 分鐘監看中（看門狗每分鐘、GD 看門狗每 5 分鐘）。


