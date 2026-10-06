# 入職流程 HANDOFF（2026-10-06 更新 → v4.56.9）

> 這一條 CC session 在做「GD /prep 自建完整入職流程」。給下一棒／另一條 CC 接手用。
> **本線只動入職相關檔；共用檔（index/p10/icon）只加自己的行、改前先問張良。**

---

## 一、入職流程整體步驟（①②③④ 主體已全部完成）

| 步驟 | 狀態 | 說明 |
|---|---|---|
| 新人入口（綁定GD→連結直達入職頁） | ✅ | 綁定新建卡者連結帶 `#tab=onb` |
| 選單「入職」分頁按鈕 | ✅ v4.56.5 | index 加 `tab-onb`＋p09 `TAB_DEF.onb`＋單色 user-plus 圖示；全員可見，權限頁可逐人關 |
| ① 基本資料 | ✅ | 欄位對齊 NUEiP「到職基本資料單」：出生/性別/婚姻/身分族群/身分證號碼/外籍證號/兵役/退伍日期/身心障礙(+說明)/國籍/手機/住家電話/email(+同步通知)/戶籍地址/通訊地址(「同戶籍」勾選)/通勤方式(複選)/機車停車格/**緊急聯絡人拆三格(姓名/關係/電話)必填**/眷屬多筆(健保加保,JSON)/3 條報到須知勾選 |
| ② 繳交表 | ✅ | 健檢區(勞工體檢+食品從業健檢說明/博仁醫院兩週內/官方 Line 預約鈕/健檢報告上傳最多2張)＋薪轉(中信)＋存摺封面照＋分行＋12碼帳號 |
| ③ 簽署 | ✅ v4.56.8 | 顯示勞動契約＋四週變形工時同意書全文(公版,帶入本人姓名/身分證/到職日)＋我已詳閱同意勾選＋**手寫簽名板**(手指/滑鼠,白底存PNG,清除重簽)→送出存私有桶 signDoc |
| ④ 勞健保確認 | ✅ v4.56.9 | 新人端=等加保狀態頁→加保後入職完成頁；主管端=「入職管理」面板(進度總覽+確認加保) |
| 檔案上傳 | ✅ v4.56.7 | 可拍照／圖庫／檔案三選一(移除 capture 強制鏡頭)；圖片壓縮、PDF 原檔直傳 |
| 主管端：名冊待審核＋核准 | ✅ 另一條 CC v4.60（p12-roster.js，非本線） | 本線的入職管理面板(onbMgrView)與之並存，之後可整併 |

---

## 二、已改／新增的檔案（全是本線的）

| 檔案 | 改了什麼 |
|---|---|
| `public/ops/js/p13-onboard.js` | **本線主檔**。新人入職頁＋主管入職管理面板。主要函式：onbPage/onbRender/onbStep1~4Form/onbStep4Self/onbDone/onbMgrView/onbMarkIns/onbSaveStep1~3/onbFileUpload+onbSendFile/onbSignInit+onbSigClear/onbDep*(眷屬)/onbSameAddr*(同戶籍)/onbEditStep1~3/onbDocContract+onbDocFlex(合約內文) |
| `api/mail-sync.js` | 入職端點：`?onboardself`(GET 讀自己+回 approver 旗標／POST 寫白名單欄位+onboardStep；首次簽署設 contractSigned+notifyOps 通知老闆)、`?onboardfile`(POST 機密檔→私有桶 ground-private，欄位 idDoc/bankDoc/healthDoc1/healthDoc2/signDoc，支援 PDF)、`?onboardmgr`(GET 主管列入職中新人進度)、`?onboardins`(POST 主管確認加保→onboardStep=4+wpPush 通知新人+notifyOps) |
| `public/ops/index.html` | 本線只加：`tab-onb` 按鈕；p13/p09 快取戳。**不碰別人的 icon/brand** |
| `public/ops/js/p09-ntf-crew.js` | `TAB_DEF.onb='入職'`＋`TAB_ICONS.onb`(單色 user-plus)。p09 當時是乾淨的，沒撞到別人未提交 |
| `public/ops/js/p10-perm-init.js` | 路由 R 字典 `onb:()=>onbPage()`（早先版本，本次未再動） |
| `docs/ONBOARD_FLOW_DESIGN.md` | 四步流程設計稿 |
| `docs/legal-templates/*.md` | 勞動契約／四週變形工時同意書**公版範本（待顧問覆核）**；p13 簽署頁內文即源自這兩份 |

---

## 三、資料結構（存在名冊卡 sp_crew_kb_roster 的 people[] 裡，本人 token 只能改自己）

- 基本/聯絡：birthday/gender/marital/ethnic/nid/foreignPermitNo/military/dischargeDate/disability/disabilityNote/nationality/mobile/homePhone/email/emailNotify/regAddr/mailAddr/commute/parkingPlate/agree1~3
- 緊急聯絡人：emerName/emerRel/emerPhone（＋相容舊 emergency 合併字串）
- 眷屬：dependents（JSON 字串，上限 2000 字）
- 繳交表：bankBranch/bankAccount；檔案 bankDoc/healthDoc1/healthDoc2（私有桶路徑）
- 簽署：agreeDoc/signName/signedAt/contractSigned；簽名圖 signDoc
- 勞健保：insured/insuredAt；onboardStep（0基本→1繳交→2簽署→3勞健保待加保→4完成）
- **絕不開放**：role/status/gdRole/薪資/投保額（安全守門）

---

## 四、部署狀態

- **最後 commit**：v4.56.9（入職第四步=勞健保確認）
- **Vercel**：每步都 `vercel --prod` 部署成功，繞快取驗證「已上線」
- 正式網域：`ground-pm.vercel.app`（= /prep = /ops/）

---

## 五、已知問題：CDN 邊緣快取競態

- 部署後，`...p13-onboard.js?v=XXXX` 這個帶版本號的 URL 有時短暫抓到舊快取（grep 新函式=0）。
- **處理**：用隨機參數繞快取確認：`curl ".../p13-onboard.js?x=$(date +%s%N)"`；再用 `curl -o /dev/null ".../ops/?w=$(date +%s%N)"` 戳一下觸發傳播，幾秒後 `?v=` URL 會更新。grep=0 不代表沒上線。

---

## 六、與另一條 CC 的分工（避免互相覆蓋）

**入職流程用獨立檔策略**：新人端＋主管面板全在 `p13-onboard.js`（獨立），共用檔只加不改——這是避免撞車的關鍵，接手請維持。

| 共用檔 | 接手注意 |
|---|---|
| `public/ops/index.html` | 只加自己的 script/按鈕行、不改別人的 icon/brand；改前重讀 |
| `public/ops/js/p09-ntf-crew.js` | 只加了 `onb` 到 TAB_DEF/TAB_ICONS；改前重讀 |
| `public/ops/js/p10-perm-init.js` | 只加了 onb 路由 |

**不要碰（另一條 CC 活躍區）**：p01-core.js、p12-roster.js(名冊主管端 v4.60)、p02-sop.js、p08-menu-misc.js、物料庫、cron-daily.js 備料群發。

---

## 七、下一步（待辦）

1. **找真新人實測**走完 ①→④：綁定→連結→填①②→簽③→（你是主管）在「入職管理」確認加保④→新人收到入職完成通知。
2. **法律內文顧問覆核**：`docs/legal-templates/` 兩份是公版，正式啟用前要給勞資顧問／律師確認；四週變形工時另需「勞資會議同意＋公告」（個別同意書不能取代）。
3. **主管端整併**：本線的入職管理面板(onbMgrView) 與 p12 待審核(v4.60) 日後可整併成一處（本線沒動 p12）。
4. 身分證正反面圖片(idDoc)：後端已支援，①基本資料前端入口可再加（目前存摺/健檢/簽名已接）。

---

## 八、欄位對齊 NUEiP 結論（已逐欄比對完成）

- ①基本資料、②繳交表：**已與 NUEiP「到職基本資料單」「入職繳交表」逐欄比對，必填＋選填全數補齊對齊**（2026-10-06）。
- ③簽署、④勞健保：NUEiP 無對應單；依勞基法＋公司流程自建。
- NUEiP 的 nuBPM 表單無法用現有串接(出勤/班表/薪資)直接讀，比對是靠張良截圖；要自動化需另逆向 nuBPM（成本未知，暫不做）。
