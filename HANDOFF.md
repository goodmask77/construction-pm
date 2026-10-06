# 入職流程 HANDOFF（2026-10-06）

> 這一條 CC session 在做「GD /prep 自建完整入職流程」。給下一棒／另一條 CC 接手用。

---

## 一、入職流程整體步驟

| 步驟 | 狀態 | 說明 |
|---|---|---|
| 新人入口（綁定GD→連結直達入職頁） | ✅ 完成 | 綁定新建卡者連結帶 `#tab=onb` |
| ① 基本資料 | ✅ 完成 | 出生/性別/婚姻/身分族群/身分證號/外籍工作證號/緊急聯絡人 |
| ② 繳交表 | ✅ 完成 | 薪轉說明(中信)＋分行＋帳號＋存摺封面照(壓縮上傳私有桶) |
| ③ 簽署（勞動契約＋四週變形勞資會議同意書） | ⬜ 未開始 | 公版內文已備（docs/legal-templates/），GD 要自建簽署機制（主App 只參考） |
| ④ 勞健保確認（DD 提醒公司→勾選→通知新人） | ⬜ 未開始 | 設計稿已定 DD 雙向通知 |
| 四步進度條框架 | ✅ 完成 | onbRender 頂部進度條 |
| 主管端：名冊待審核＋核准 | ✅ 已有（另一條 CC v4.60 做的，非本線） | p12-roster.js |

---

## 二、已改／新增的檔案

| 檔案 | 改了什麼 |
|---|---|
| `public/ops/js/p13-onboard.js` | **新檔**。新人入職頁：進度條＋①基本資料表單＋②繳交表＋機密檔案壓縮上傳＋toast。全域函式 onbPage/onbRender/onbStep1Form/onbStep2Form/onbSaveStep1/onbSaveStep2/onbFileUpload/onbEditStep1/onbEditStep2/onbToast |
| `api/mail-sync.js` | 新增兩端點：`?onboardself`（GET 讀自己名冊卡回顯／POST 寫白名單欄位＋onboardStep，本人 token 驗身分 sopWho→rid，絕不碰 role/status/薪資）；`?onboardfile`（POST 機密檔案 idDoc/bankDoc 進私有桶 ground-private，壓縮後 dataUrl→buffer，10MB 上限） |
| `api/line-webhook.js` | v4.56.0 綁定GD「本名」名冊找不到人→自動建入職中名冊卡(onboarding:true,gd:1)；v4.56.1c 綁定新建卡者連結帶 `#tab=onb` 直達入職頁 |
| `public/ops/js/p10-perm-init.js` | 路由 R 字典加 `onb: ()=>onbPage()`（支援 `#tab=onb` 深層連結） |
| `public/ops/index.html` | 載入 `p13-onboard.js`（快取戳 `?v=4563`） |
| `docs/ONBOARD_FLOW_DESIGN.md` | 四步流程完整設計稿 |
| `docs/legal-templates/labor-contract-template.md` | 勞動契約通用公版（勞基法法定項目框架，待顧問覆核，張良可編輯） |
| `docs/legal-templates/four-week-flexible-agreement-template.md` | 四週變形工時勞資會議同意書通用公版（§30-1） |

---

## 三、部署狀態

- **最後 commit**：`f5c7d75`（入職第二步=繳交表 v4.56.2）
- **Vercel**：READY（已 `vercel --prod` 部署成功）
- **線上驗證**：繞快取抓線上 p13 有 `onbStep2Form`（2 處）；`onboardself`/`onboardfile` 端點回應正常。第①②步 + 兩端點皆確認上線。

---

## 四、已知問題：CDN 邊緣快取競態

- 部署後，`...p13-onboard.js?v=XXXX` 這個「帶版本號的 URL」有時會短暫抓到舊快取（grep 新函式=0）。
- **處理方式**：用隨機參數繞快取確認真實狀態：`curl ".../p13-onboard.js?x=$(date +%s%N)"`。通常幾秒後邊緣傳播完成，`?v=` URL 也會更新。grep=0 不代表沒上線，要繞快取再確認一次。

---

## 五、與另一條 CC 的分工（重要：避免互相覆蓋）

**另一條 CC 是 /prep 前端主力**（已推到 v4.56 物料庫、v4.60 名冊、v4.5x icon 等）。

| 共用檔 | 兩邊都動過什麼 | 接手注意 |
|---|---|---|
| `public/ops/index.html` | 我：加 p13 載入行＋快取戳。另一條 CC：icon 換成 `-r2`、brand/theme 改版 | **只加自己的行、不改別人的**；改前先重讀（常被同時改） |
| `public/ops/js/p10-perm-init.js` | 我：R 字典加 onb。另一條 CC：也在改別處 | 同上，改前重讀 |
| **icon**（icon-180/192/512 + manifest） | 我：v4.55.2 修成無 alpha 白底。**另一條 CC 之後換成 `-r2` 盒子標誌，已覆蓋我的** | icon 這塊歸另一條 CC，**本線不要再動**；若張良說 icon 又變怪，是它的 -r2 版問題 |

**不要碰的檔（另一條 CC 的活躍區）**：
- `public/ops/js/p01-core.js`（備料/預估/耗損）
- `public/ops/js/p12-roster.js`（名冊主管端，v4.60）
- 物料庫相關（v4.56 盤點分類）
- `api/cron-daily.js` 備料群發（本線已停用、勿動）

**入職流程用獨立檔策略**：新人端全在 `p13-onboard.js`（獨立），共用檔只加不改——這是避免撞車的關鍵，接手請維持。

---

## 六、line-webhook（綁定）目前狀態

- **是本線的領域，沒被另一條 CC 動**（最近 commit 都是本線：v4.56.0 入職整合、v4.54.0 外部群）。
- 綁定邏輯：「綁定GD 本名」有名冊→綁定；沒名冊→自動建入職卡＋綁定＋發 `#tab=onb` 連結＋通知老闆審核卡。
- （曾一度誤判「被另一條 CC 改」，查證後確認是行號位移，已更正。）

---

## 七、未回答／待確認的問題

- **入職表欄位 vs NUEIP 畫面一致性**：
  - ① 基本資料：**已比對**——核心欄位（出生/性別/婚姻/身分族群/身分證號/外籍工作證號）與 nuBPM「到職基本資料單」一致；已補員工編號顯示；nuBPM 的「外籍工作許可函(檔案)」移到後續步驟（跟證件一起走私有桶）；本線多加「緊急聯絡人」（張良確認要保留）。
  - ② 繳交表：對應 nuBPM「入職繳交表」（薪轉銀行/存摺封面照/分行/帳號）。
  - ③④ 簽署、勞健保：**尚未做，故尚未比對**。做的時候需再對 NUEIP／法規確認欄位。

---

## 八、下一步要做什麼

1. **第③步 簽署**：把 `docs/legal-templates/` 兩份公版內文接進 App，GD 自建線上簽名（本名簽署→記時間/裝置→存私有桶）；勞資會議同意書另需「公告留存」。簽署內文最終要顧問覆核。
2. **第④步 勞健保確認**：DD 於新人報到當天提醒張良/行政加保→App 勾選「已加保」→DD 自動通知新人「入職完成🎉」。
3. **主管端整合**：入職中列表 + 四步進度總覽 + 核准（接現有 p12 待審核）。
4. **再測**：找一個真新人走完整流程（綁定→連結→①②填完→主管看到待審核）。
5. 身分證影本（idDoc）上傳：onboardfile 後端已支援，第①或②步前端可加入口（目前只有存摺照 bankDoc 接了前端）。
