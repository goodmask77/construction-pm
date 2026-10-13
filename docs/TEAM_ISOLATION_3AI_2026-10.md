# 四人共同開發：cmux 方案與「空間隔離」三家查證（2026-10-14）

張良問：cmux 要不要升 Pro？未來 Belle／阿桑／小夏一起改 GD 有沒有幫助？能不能做到 Belle 管財務、別人碰不到、程式碼與部署不互相衝突？
做法：OpenAI（gpt-6.1-sol＋web_search）、Gemini（gemini-3.8-flash＋Google 搜尋）、獨立 Claude（WebSearch）第一輪各自獨立上網查；CC 再用官方文件與實機查證分歧。

## 實機查證（CC）
- GD repo `goodmask77/construction-pm` 目前是 **公開（public）**，掛在個人帳號下。現行檔案掃描沒有私密金鑰（只有 inline 前端公開 Firebase key）；歷史只掃過 `sk-ant-`，其他未掃。
- Vercel：team「goodmask77's projects」= **Pro**，張良 OWNER。
- cmux 本機 0.65.1 免費版，已開 14 個工作區正常，沒有撞到上限。

## 共識
1. cmux 是個人 Mac 上的「終端機外框」，**不管 git、權限、部署**；Team（$60/人/月）只多統一帳單、共用雲端 VM、優先客服，**沒有多人共享工作區或權限**。→ 四人協作沒幫助，維持免費版；Pro 只在「Mac 關機也要雲端跑」或「手機看進度」才值得，先月繳試。
2. 同一個 repo **做不到依資料夾限制「看」**；只能做到「改了合不進去」（CODEOWNERS＋分支保護／push rulesets）。
3. 要別人「看不到」財務程式碼 → **財務獨立 repo＋獨立 Vercel 專案**。
4. 部署不互洗：正式站只從 main 自動部署，夥伴不給本機 `vercel --prod` 權限；各系統獨立 Vercel 專案則部署互不影響。
5. 資料也要分：財務金鑰只放財務專案；Supabase 用 schema＋RLS；Upstash KV 拿到金鑰就全讀寫，不適合放需隔離的資料。
6. Vercel 官方 Microfrontends 太貴（超過 2 專案每個 +$250/月），不建議；要同網址用 Next.js rewrites（multi-zones）或直接分子網域。

## 分歧與 CC 裁定
| 題目 | 說法 | 查證結果 |
|---|---|---|
| 夥伴提交要不要 Vercel 席位 | GPT／Claude：要，約 $20/人/月；Gemini：老闆一個帳號就夠 | Vercel 官方 /docs/git：「私有 repo 提交者要是 Vercel 團隊成員」**只適用於 GitHub 組織**，「does not apply to collaborators on personal Git accounts」。→ **repo 放在張良個人帳號、夥伴當 collaborator，就不用買夥伴席位**（Gemini 對）；放組織就要。 |
| 私有 repo 分支保護要錢嗎 | Gemini：免費即可；GPT／Claude：要付費 | GitHub 免費版的分支保護／rulesets 只限公開 repo；私有個人 repo 要 **GitHub Pro（$4/月，只算張良一人）**，組織要 Team（$4/人/月）。 |
| 個人帳號的限制 | — | 個人 repo 的 collaborator 一律有寫入權，沒有細分角色；靠「分開 repo＋main 分支保護只收 PR」補足。 |

## 建議方案（待張良裁決）
- 每套系統一個私有 repo，放張良個人帳號：財務（張良＋Belle）、營運（＋阿桑）、EM（＋小夏）、GD／新殼（張良）。
- GitHub Pro $4/月：每個 repo 的 main 鎖住，只收 PR，張良（或該系統負責人）核准才合併。
- Vercel 每套系統一個專案，main 合併自動部署；夥伴不加 Vercel 成員（免席位、也無法從本機部署正式站）。
- 入口：先用各自子網域＋GD 側欄連結；需要同網址再做 rewrites。
- 先決事項：GD repo 目前公開 → 建議先改私有（改之前要確認沒有東西依賴公開網址抓 repo 檔案）。

## 來源
cmux.com/pricing、cmux.com/docs/cloud、cmux.com/docs/ios、cmux.com/docs/base、cmux.com/compare、github.com/manaflow-ai/cmux（issues #1188 #2487 #11627）、news.ycombinator.com/item?id=47079718、reddit r/cmux、console.dev/tools/cmux、github.com/pricing、docs.github.com（protected branches／CODEOWNERS／rulesets／repository roles）、vercel.com/docs/git、vercel.com/docs/rbac/access-roles、vercel.com/docs/microfrontends、vercel.com/docs/plans/pro-plan、nextjs.org/docs/app/guides/multi-zones、supabase.com RLS 文件。

---

# 第二輪：張良定案「全部同一個 goodmask77 的 GitHub／Vercel／Supabase、abgd 單一 repo 分區塊共編」後，大公司怎麼協作（2026-10-14）
三家（GPT gpt-6.1-sol＋web_search、Gemini 3.8-flash＋Google 搜尋、獨立 Claude）第一輪各自上網查。

## 大公司做法（共識，附代表來源）
| 做法 | 解決 | 來源 |
|---|---|---|
| 主線開發＋短命分支 | 分支放太久合不起來 | Google monorepo 論文、Shopify merge queue 文章 |
| PR 審查＋CODEOWNERS＋主線保護 | 改到別人區塊、直接覆蓋正式版 | GitHub docs |
| CI 自動檢查當硬門檻 | 壞程式進主線 | Uber「Shifting E2E testing left」、GitHub |
| 合併排隊 merge queue | 上百人同時合併、A＋B 各自通過但合起來壞 | GitHub、Shopify、Uber SubmitQueue |
| 每個 PR 預覽環境 | 上線前看不到 | Vercel |
| 功能開關 feature flag | 先上線不打開，出事一鍵關 | Meta Gatekeeper、GitHub |
| 分階段上線 canary＋一鍵回滾 | 出錯影響全部人 | Google SRE、Vercel Rolling Releases／Instant Rollback |
| 資料庫先加後減 expand/contract | 改資料表讓舊程式壞掉 | Stripe online migrations、Fowler |
| 模組邊界 | 跨組直接改別人內部 | Shopify modular monolith／Packwerk |
| 最小權限、AI 不給正式庫寫入 | 一個錯指令毀掉正式資料 | Anthropic、Replit 刪庫事故 |

## 4 人不需要（共識）
merge queue、canary 百分比上線、拆微服務／多 repo、自建大型 CI 或功能開關平台。

## 4 人最低必要組合（共識，併入 abgd 七道防線）
1. 每人每任務一條短命分支（同台電腦多 AI 用 worktree），1~2 天內合併。
2. main 上鎖：只收 PR、檢查通過、負責人核准。
3. 資料夾分區＋CODEOWNERS；共用外框、套件安裝（package.json）、CI 設定、CODEOWNERS 本身、migration 列高風險，只由張良（或指定人）核准。
4. CI 硬門檻：build、型別、關鍵流程測試（財務金額、角色越權）；build 綠燈≠業務正確。
5. 每個 PR 預覽網址由負責人親手驗收。
6. 正式站只從 main 自動部署，任何人不從本機部署。
7. 資料庫只用 migration 檔改、先加後減；**預覽站不接正式可寫資料庫**（GD 現況 Preview 與 Production 共用 SUPABASE_SERVICE_ROLE_KEY，abgd 要改）；AI 不拿正式庫管理金鑰。
8. 一鍵回滾＋資料庫備份實際還原演練（Storage 檔案另外備份）。
9. 跨區衝突停下來找兩區負責人，**不讓 AI 自己「全選我的版本」解衝突**。

## 分歧：AI 審查通過就自動合併部署？
| 家 | 說法 |
|---|---|
| Claude | 可分級：只動自己資料夾的純畫面／文字＋檢查全過→AI 通過自動合併；財務、金流、權限、資料庫、共用外框→負責人親按 |
| GPT | 同樣分級，但更保守：先只放文件／非敏感文字自動合併，一般功能仍要人看預覽 |
| Gemini | 完全不要自動合併（AI 寫 AI 審有同一盲點；所引「Stanford HAI 2026」「arXiv AI-to-AI review」**未查證**） |
| 證據 | GitHub Copilot 2026-09 起 AI 核准可算合併門檻（公開預覽、預設關、可限路徑）；CodeRabbit 統計 AI 寫的 PR 問題約人寫的 1.7 倍；無人審就合併的 PR 事故率顯著較高（廠商數據） |
| CC 建議 | 前一個月全部人工按合併、AI 只給審查意見；穩定後只對「純畫面／文字＋只動自己區」開放三家都過就自動合併；高風險區永遠人工 |
