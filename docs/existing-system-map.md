# 現況核對｜existing-system-map（批次 0 交付物）

> 2026-10-10 唯讀調查。對象＝`docs/COST_MODULE_SPEC.md` v2 的「資料來源 boss-api／資料模型／計算規則／開發批次」四節 ＋ `docs/INVENTORY_BLUEPRINT.md` 資料模型段。
> 行號以本日工作樹為準。調查途中另一條 session 已把批次 1 後端提交為 `f0355db`（`api/_cost.js`＋`mail-sync.js ?costtodo/?costsnap`），`api/_cost.js` 仍有未提交改動；行號會飄，請以關鍵字 grep。
> 「未確認」＝沒在 repo 內找到證據，不猜。

## 1. repo 與路由

### 1a. /prep（GD 夥伴 App）＝ `public/ops/index.html`（206 行，分頁按鈕在 157–177 行）＋ `public/ops/js/p01~p16`（classic script，載入順序＝執行順序）

| 檔 | 負責頁 | 跟成本模組的關係 |
| --- | --- | --- |
| p01-core.js | 金鑰/分頁/快取/營運看板/登入；`actLoss()`（507 行）＝舊備料板「耗損記錄」→ `?prepact` | 耗損 v1 要併入的「舊備料板耗損」就在這裡（存 `sp_finance_pm_prep_act_` 月檔） |
| p02-sop.js | 節奏表＋SOP 打卡＋推播＋模擬檢視；**`canTab()` 223 行、`EDIT_FN` 231 行＝前端鎖門表** | 新頁所有寫入按鈕要登記進 `EDIT_FN` |
| p03-sopedit.js | 站別管理＋問題回報＋SOP 編輯 | 無 |
| p04-inv-meet.js | 🥩盤點／📦包材（`invLoad`）＋🛒採購（`buyLoad`）＋打卡＋會議 | 盤點品項＝`sp_finance_pm_inv`；採購需求＝`sp_finance_pm_buy`（文字需求單，非叫貨單） |
| p05/p06-shift*.js、p07-labor.js | 班表、工時成本試算、品項明細 | p07「工時成本」是人力成本，與食材成本無關 |
| p08-menu-misc.js | ⚠️異常通知（`incLoad`→`?absinc`）＋🍔菜單（base/draft 快照）＋分頁自訂 | 菜單頁只有「品名/售價/備註」，無規格/通路/包材 |
| p09-ntf-crew.js | 通知中心＋inline 顧客＋人員管理；`TAB_DEF`（297 行）＝側邊欄分頁真來源 | **`TAB_DEF` 沒有 `matlib`**（只在 `TAB_ICONS` 322 行與 index.html 165 行），所以物料庫不能改名/排序、也不在權限矩陣的分頁清單 |
| p10-perm-init.js | 權限 modal（241 行：訪客/一般/主管/停權/審核人）＋預測＋錯誤偵測＋init | 這裡是「角色」UI；「分頁勾選」在設定頁（p09）+ 後端 `sp_finance_pm_prep_perm` |
| p11~p15 | 勞基法/薪資、名冊、入職、AB 模組班表、行銷大師、文件庫 | 無 |
| p16-matlib.js | 🧾物料庫（三子頁 `dash` 波動分析／`list` 物料清單／`ord` 叫貨單）；只打 `?matlib` `?matcat` `?matord` | 規格「物料庫＋物料卡」唯一現成前端；但資料是「叫貨明細聚合」，沒有物料卡實體 |

### 1b. 主 App（`src/`，React，Supabase anon key 直讀 `pm_documents`）

| 檔 | 內容 | 備註 |
| --- | --- | --- |
| `src/lib/spaces.js` 68 行 | 供應鏈空間分頁：smat 物料庫／sprice 價格追蹤／ssemi 半成品／sproducts 成品食譜／sorder 叫貨／scost 成本分析；權限矩陣 124–131 行（每頁 edit/money 開關） | 主 App 權限＝「空間:頁」字串清單，與 /prep 的 `prep_perm` 是兩套 |
| `src/supply/Supply.jsx`（153KB） | 空間總入口：讀寫 `pm_supply`／`pm_orders`／`pm_recipe_v_`／`pm_price_flags`／`pm_ph_`／`pm_editlog_`；叫貨單建立 288 行、驗收完成 729–742 行（寫進價事件＋更新 last 快取＋漲跌警示）；`syncToPos` 1127–1150 行把食譜成本寫進 `sp_finance_pm_pos_costs` | 驗收攔截要改的「既有頁」＝這裡（GROUN:D 叫貨）；A Beach 驗收在阿桑 OPS |
| `src/supply/inv.js` | **純函式算法（唯一成本引擎）**：`packToBase/lastPaid/unitCost/quoteUnit/recipeCost/buildPriceEvents/applyLastPaid/priceAlert/parseSpec/organizeAll` | 見第 3 節 |
| `src/supply/Materials.jsx` | 物料大表＋詳情（貨源/趨勢/被哪些食譜用/叫貨紀錄/編輯歷史）；改價 44 行 append `pm_ph_` | 規格物料卡五分頁的 1/2/4/5 已有雛形 |
| `src/supply/PriceTrack.jsx` | 價格波動 KPI＋排行＋趨勢；疑似有誤旗標 `pm_price_flags`（key=`vendor||item`） | 規格「價格異常」分頁的前身，但只有 pending/ok/fixed 三態，無原因/靜音 |
| `src/supply/Recipe.jsx` | 食譜卡公版（內容物/SOP 文字/耗損率/產量/每包成本/每克成本）版本流水 | 無步驟媒體、無草稿/發布、無換算鏈顯示 |
| `src/supply/Ingredients.jsx` | 物料清單 v3（截圖 AI 匯入、⚡自動整理同名併卡） | 「同名自動合併」與規格「同名只建議不自動合」相反 |
| `src/supply/digest.js` | 供應鏈 AI 摘要（App 與 D哥共用） | 新資料域要加這裡（100% 資料鐵則） |
| `src/lib/cost.js` | **工程報價成本模型**（數量×單價、稅別、議價、付款分攤、零用金） | 與食材成本無關，不沿用 |
| `src/finance/Finance.jsx` 1903–1905 行 | 品項明細「💰填成本」：成本＝Σ當日份數×品項成本；毛利＝POS 實收−成本 | 成本來源 `pm_pos_costs`（手填或 Supply 同步） |

### 1c. `api/`（Vercel 無框架函式；KV = Supabase `pm_documents`，service role）

| 端點（檔:行） | 金鑰／守門 | 做什麼 |
| --- | --- | --- |
| `boss-sync.js`（265 行；cron `7 * * * *` vercel.json 50 行） | env `BOSS_API_BASE_URL/BOSS_API_KEY`；`?force=MENU_PROBE_KEY` | 阿桑 API → `sp_finance_pm_boss_*`；端點表 46–71 行；`OFF` 45 行停更 revd/revm/sched/staff/att/ot/prep/rout/temp；**8 個新端點已預接 pend:1（prod/sup/rcp/citem/gprod/gsup/gord/gordi）**，404 安靜等 |
| `boss-sync.js` `?bosspeek`(106) `?bossraw`(118) `?histfill`(131) `?fillpos`(143) | PARTNER／MENU_PROBE 金鑰 | 看月檔原始列／直打上游／回填重啟／AB 營收回填 |
| `mail-sync.js ?matlib`(4567) | OPS_BOARD_KEY ＋ **`me=token` 必須綁定**；`canEdit=permWho(me,'buy')` | 13 個月 `ordi` 聚合「物料×廠商×時間」；key=`c:code` 否則 `n:品名`；波動=最早 vs 最新 approved 單價 |
| `?matcat`(4637 POST) | `permWho(token,'buy')` | 物料／廠商分類增刪改排序 → `sp_finance_pm_boss_matcat` |
| `?matseed`(4661) | MENU_PROBE_KEY | 廠商分類種子（GET 彙總／POST 灌入） |
| `?matord`(4729) | me=token；canEdit=buy | `ord`+`ordi` 以 order_id 組「每張叫貨單＋明細」 |
| `?costtodo`(4697) `?costsnap`(4720) ＋ `api/_cost.js` | me=token；決定要 buy 權限；快照灌入要 MENU_PROBE／PARTNER 金鑰 | **批次 1 後端（commit `f0355db`，仍在改）**：待處理清單／決定留痕 `sp_finance_pm_cost_todo`；10/06 快照 `sp_finance_pm_cost_snap_<sheet>`；灌檔腳本實際是 `scripts/cost-snap-ingest.py`（mail-sync 註解寫 `.mjs`） |
| `?inv`(2990) `?invset`(2997) `?invcount`(3025)；`invStatus()` 29 行 | OPS 金鑰；寫入 `permWho(token,'food'|'pack')` | /prep 盤點品項、分類、盤點數；`invStatus` 用 GD POS 明細「照銷售自動扣」 |
| `?buy`(5162) `?buyadd`(5170) `?buyop`(5190) | `permWho(token,'buy')`；刪＝提出者或審核人 | /prep 採購需求：open→bought→received（收貨必拍照） |
| `?supplyreset`(606) `?phingest`(717) `?supplyingest`(745) | MENU_PROBE_KEY | 主 App 供應鏈維護口：清庫／灌價格歷史月檔／批次灌物料+廠商+食譜（會 import `src/supply/inv.js`） |
| `?priceset`(1534) `?aliasset`(1556) | MENU_PROBE_KEY | POS 牌價 `pm_pos_prices`／品名別名 `pm_pos_alias` |
| `?absinc`(2283) | OPS 金鑰 | 讀 `boss_inc_` 近 3 個月給異常通知頁 |
| `?menu`(1991) | OPS 金鑰 | /prep 菜單 base/draft（`sp_finance_pm_menu`） |
| `?bossprobe`(4402) | MENU_PROBE_KEY | 列全部 `sp_finance_pm_boss_*` 檔與每 slug 一列樣本 |
| `partner-api.js` `orders`(121) `orders/prices`(135) | PARTNER_API_KEY（給阿桑） | 反向輸出 GD 叫貨單 `sp_supply_pm_orders` 與價格歷史 `pm_ph_` |
| `line-webhook.js loadBossText()`(1053) | — | D哥 AI 讀 boss 月檔（ord 用 total_amount/line_count/status；menu 用 cost/cost_ratio/cost_complete） |

## 2. 資料表與 key（全部在 Supabase `pm_documents`，`id`=key、`data.v`=JSON 字串）

### 2a. boss-api 同步檔 `sp_finance_pm_boss_*`（寫：只有 `boss-sync.js`；增量窗整段重拉＋刪除偵測）

| key | 型態 | 主鍵／一列範例欄位（依程式實際讀到的欄名） | 讀的人 |
| --- | --- | --- | --- |
| `…_ord_YYYYMM` | 月檔 `{rows:{order_id:列}, updatedAt}` | `order_id, created_at, supplier, dept, status(approved/pending), total_amount, line_count, unpriced_lines` | matord、App.jsx 112、line-webhook |
| `…_ordi_YYYYMM` | 月檔 `{rows:{line_id:列}}` | `line_id, order_id, name|item, code, qty, unit, price, amount, supplier, dept, order_status|status, ordered_at|created_at, is_backfill`（is_backfill 只在 `_cost.js` 用到，欄位存在與否未確認） | matlib、matseed、matord、_cost.js |
| `…_menu` | 快照單檔 `{rows:{menu_id:列}, count}` | `menu_id, name, is_active, price?, cost, cost_ratio, cost_complete`（price 未確認） | App.jsx、line-webhook 1097 |
| `…_sett_YYYYMM` | 月檔 | `date, cash_total, card_total, ue_total` | fillpos、App.jsx、line-webhook |
| `…_revd_YYYYMM`（停更） | 月檔 | `date, net_sales, discount, service_charge, transactions, customers` | fillpos |
| `…_revm`（停更） | 快照 | `month, …` | mail-sync 1486、App.jsx 111 |
| `…_inc_YYYYMM` | 月檔 | `incident_id, created_at, …` | absinc |
| `…_sched_/_staff/_att_/_ot_/_prep_/_rout_/_temp_`（停更） | 月檔或快照 | 見 boss-sync 53–60 行 pk | mail-sync 2749（sched）、line-webhook |
| `…_prod / _sup / _rcp / _citem / _gprod / _gsup`（預接快照）、`…_gord_YYYYMM / _gordi_YYYYMM`（預接月檔） | 尚未入庫（阿桑 404） | 主鍵候選：product_id/id/code/sku；supplier_id/id/name；recipe_id/id/menu_id/name；item_id/product_id…；order_id/id；line_id/id | 目前無人讀 |
| `…_state` | 單檔 | `{bf:{slug:回填游標|'done'}, rot, res:{slug:{at,ok|live:0|scope:0|err}}, auth401, lastRun}` | boss-sync |
| `…_matcat` | 單檔（**人工維護，非同步**） | `{cats:[], map:{'c:code'|'n:品名':分類}, vcats:[], vmap:{廠商:分類}}` | matlib/matcat/matseed、_cost.js |

### 2b. 主 App 供應鏈（前綴 `sp_supply_`；寫：前端 `window.storage.set`，anon key + RLS；維護口 supplyingest/phingest）

| key | 結構摘要 | 誰寫 / 誰讀 |
| --- | --- | --- |
| `sp_supply_pm_supply` | 整包 `{categories, products[{id,name,semi,is_active,store(AB/GD),posName}], materials, vendors[{id,name,dept,vcat}], vendorItems[{id,vendor_id,ingredient_id,matId,name,spec,unit,price,packToBase,moq,grp,last{price,ts,prevPrice,prevTs},quote{…}}], ingredients[{id,name,cat,baseUnit,countFreq,countRole,countUnit,isKey,costFree,nonStock}], matches, productPackaging[{product_id,packaging_id}], settings{priceAlertPct}}` | Supply.jsx save(105)；supplyingest；讀：App.jsx 70、line-webhook 1196、partner 無 |
| `sp_supply_pm_orders` | 陣列（滾動約 600 張）`{id,ts,vendor_id,vendorName,dept,needDate,via,status(草稿/已送出/已到貨/有問題),text,items[{id,name,qty,unit,price}],check{by,ts,items{i:{st,fu}}}}` | Supply.jsx saveOrders(113)；讀：partner-api 123、App.jsx 71 |
| `sp_supply_pm_price_<orderId>_<i>` | 進價事件（append-only、決定性 id）`{id,ts,ingredient_id,vendor_item_id,vendor_id,price,unit,qty,order_id,inspectSt}` | Supply.jsx 734（完成驗收）；讀：目前只靠 `last` 快取，事件本身無人讀回（AI 摘要略過，App.jsx 446） |
| `sp_supply_pm_quote_<rid>` | 報價事件 `{id,ts,date,ingredient_id,vendor_item_id,vendor_id,price,by}` | Supply.jsx 408；讀：同上 |
| `sp_supply_pm_recipe_v_<rid>` | 食譜版本（append-only）`{id,product_id,ts,ingredients[{ingredient_id,qty}],subRecipes[{product_id,qty}],yield,lossPct,…}` | Recipe.jsx；讀：Supply/Ingredients/App.jsx 71/line-webhook |
| `sp_supply_pm_ph_YYYY-MM` | 價格歷史月檔 `{rows:[{d,vendor,item,unit,p,q,src}]}`（**以廠商+品名文字為 key，非物料 ID**） | Supply.appendPh(73)、Materials 44、phingest；讀：PriceTrack、partner `orders/prices`、AI |
| `sp_supply_pm_price_flags` | `{ 'vendor||item': {status:pending|ok|fixed,…} }` | Supply.saveFlags(96)；讀 PriceTrack/digest |
| `sp_supply_pm_editlog_YYYY-MM` | `{rows:[{ts,by,kind,name,field,from,to}]}` | Supply.logEdit(89)；讀 Materials/AI |
| `sp_finance_pm_pos_costs` | `{abeach:{abNorm(品名):成本}, ground:{品名:成本}}`（每份食材成本） | Finance.jsx 218（手填）、Supply.syncToPos 1147（覆蓋）；讀 Finance、line-webhook 827 |
| `sp_finance_pm_pos_prices` | `{ground|abeach:{品名:牌價}}` | priceset、Finance | 
| `sp_finance_pm_pos_alias` | 品名別名合併表 | aliasset、Finance、AI |
| `pm_bom / pm_po / pm_vendor*` | **repo 內不存在**（grep 無） | — |

### 2c. /prep 相關（前綴 `sp_finance_`；寫：mail-sync 端點，service role）

| key | 結構摘要 | 端點 |
| --- | --- | --- |
| `sp_finance_pm_inv` | `{food|pack:{items[{id,name,cat,unit,min,links[POS品名]}],cats[],counts{id:[{ts,qty,by}]},edits[]}, notified}` | inv/invset/invcount；joya-intraday 196 低水位 |
| `sp_finance_pm_buy` | `{list[{id,text,cat,url,media,by,status(open/bought/received),doneBy,doneTs,recvBy,recvTs,recvMedia}]}` | buy/buyadd/buyop |
| `sp_finance_pm_prep_act_<月>` | 備料板實備/耗損（`op:'loss', item, qty, reason`） | prepact 4484 |
| `sp_finance_pm_menu` | `{base:{sections[{name,note,items[{id,name,price,note}]}]}, draft, …}` | menu/menuset |
| `sp_finance_pm_prep_perm` | `{mode:'open'|'approve', users{rid:{name,edit,admin,tabs{分頁:0=關},hide{分頁:1}}}, pending, removed}` | prepperm 4440（金鑰口）、preppermset 3650（admin） |
| `sp_finance_pm_prep_bind` | `{byUid, tokens{token:{rid,uid,name}}}` | sopWho 383 |
| `sp_finance_pm_cost_todo`、`sp_finance_pm_cost_snap_<sheet>`（sheet=products/suppliers/recipes/recipeLines/menu/menuLines/quality/priceLog/sameName） | 批次 1（`f0355db`）；todo 結構見 `api/_cost.js` | costtodo/costsnap |

## 3. 現有成本公式

| 位置 | 公式 | 輸入 | 輸出 | 是否沿用 |
| --- | --- | --- | --- | --- |
| `src/supply/inv.js` `unitCost`(15) | 實付價 ÷ packToBase；`lastPaid`(8) 沒 last 時**退回主檔 `price`** | vendorItem.last.price / price、packToBase | $/基準單位 或 null（缺任一不當 0） | 架構沿用（null 不當 0、報價不進成本）；**退回主檔 price 違反規格「只用已確認驗收價」要改** |
| `inv.js` `recipeCost`(41) | Σ(用量×物料最近實付單位成本) ＋ Σ(半成品 recipeCost×qty) → ÷ (yield × (1−lossPct/100)) ＋ 包材每份 1 個單價 | 最新版本食譜、db、visited 防循環 | `{total, missing[]}` | 骨架可沿用（遞迴、缺口照實回報、`costFree` 白名單）；**要改**：lossPct 另加耗損（規格：產量已含耗損不再加）、包材寫死每份 1 個單一通路（規格：內用/外帶/外送各組＋數量）、無深度上限 5、用量單位鎖 baseUnit 無換算鏈 |
| `inv.js` `latestCostOfIngredient`(24) | 多貨源取「最近有實付的」 | — | 單位成本 | 規格改為「主要供應品」決定基準價 → 要加主要來源旗標 |
| `inv.js` `priceAlert`(106) | \|last−prev\|/prev ≥ 15%（settings.priceAlertPct） | last 快取 | {pct,up} | 規格：門檻內也要記錄待確認；門檻依品類（_cost.js DEFAULT_CFG 50/80/30）→ 取代 |
| `inv.js` `buildPriceEvents`(78)/`applyLastPaid`(94) | 驗收完成→逐品項進價事件（price>0 才記）＋同價只刷時間 | 叫貨單 check | `pm_price_*` 事件、last/prevPrice | 事件只新增可沿用；**但驗收價立即進成本（無「待確認」狀態）** |
| `inv.js` `parseSpec`(145) | 規格文字「100張/包 60包/箱」鏈乘→packToBase＋baseUnit；kg×1000、台斤×600、L×1000 | 字串 | {packToBase, baseUnit} | 沿用為「規格文字自動解析成建議換算」；**但 g↔ml 皆靠文字單位，無密度概念** |
| `inv.js` `organizeAll`(208) | 未掛卡貨源→同名（`normName`）自動併卡 | db | 新 ingredients/vendorItems | 規格「同名只建議、人確認」→ 改成只產生合併建議 |
| `mail-sync ?matlib`(4567) | pctChg=(最新 approved 價−最早 approved 價)/最早；qty30/amt30 近 30 天 approved；amount 缺時 price×qty | boss `ordi` | 物料清單＋series | 畫面可沿用；**價格 0 被當有效價**（`p != null` 即算）違反規格「0＝未知」；基準＝下單價非驗收價 |
| `api/_cost.js`（WIP） | 價格序列：approved/received、排除 is_backfill、單價 0/空、qty≤0；同單同料加權平均；門檻 default 50／veg 80／tight 30 | boss ordi、10/06 快照 | 待處理清單 | 批次 1 正在做，與規格一致方向 |
| `Finance.jsx` 1904／`line-webhook` 826 | 當日成本=Σ份數×`pm_pos_costs`；毛利=POS 實收−成本；沒填當 0 並標覆蓋率 | pm_pos_costs、pos 明細 | 每日毛利/成本率 | 沿用為「菜單成本→營運報表」出口；成本來源改成本模組的成本快照 |
| `Supply.syncToPos`(1127) | 只同步「成本完整」品項到 `pm_pos_costs`，缺料不寫 | recipeCost | 覆蓋手填值 | 同上，需改成由快照驅動且保留手填/自動來源標記 |
| `src/lib/cost.js` | 數量×單價、稅別（含稅÷1.05、未稅+5%）、議價、付款分攤 | 工程報價 | 工程金額 | **不沿用**（工程空間）；只有「含稅/未稅換算口徑」可參考 |
| `v_item_cost` / `v_menu_cost` / `recipe_conv` | **不在本 repo**（grep 無）；是阿桑 DB 的 view | — | — | 只能經 boss-api `/costs/items`、`/costs/menu`（已同步 `boss_menu`；`citem` 預接中）拿結果交叉比對 |

## 4. 權限

| 層 | 機制（檔:行） | 內容 |
| --- | --- | --- |
| /prep 身分 | `sopWho` mail-sync 383 | `?me=token` 或 POST `token` → `prep_bind.tokens` → 名冊 `gdRole`（一般/主管/審核人/停權；停權=null）；管理者 GET 可 `&as=rid` 模擬 |
| /prep 編輯權 | `permWho(token, tab)` 418；資料 `sp_finance_pm_prep_perm` | `mode=open`：綁定即可編；`mode=approve`：`users[rid].edit` 且（admin 或 `tabs[tab]!==0`）。分頁鍵＝`board/sop/task/lb/menu/fb/meet/shift/food/pack/buy/gear…` |
| /prep 前端鎖門 | `canTab(k)` p02 223、`EDIT_FN` p02 231、`whoami` 1201 | 與 permWho 同邏輯；寫入按鈕沒權限→灰鎖跳窗。盤點/包材用 `'*'` 跟當前頁 |
| 物料庫目前守門 | `?matlib/?matord`：OPS_BOARD_KEY ＋ **sopWho(me) 必須綁定**（未綁 403）；`canEdit`／`?matcat` 寫入＝`permWho(me,'buy')` | 看＝任何已綁定者；改分類＝「採購」分頁編輯權。**沒有獨立的「看成本」開關**，也沒有 matlib 自己的分頁鍵 |
| 採購 buy | `?buy` 讀：OPS 金鑰（me 只用來回 canEdit/approver）；`buyadd/buyop`：`permWho(token,'buy')`；刪＝提出者或 `sop_def.ground.approvers` | 審核人名單在 `sp_finance_pm_sop_def.ground.approvers`（預設張良瑋） |
| 費用敏感口 | `costtodo`（WIP）：看＝綁定；決定＝buy 權限 | 與規格「功能×角色開關、API 層不回傳」仍有距離 |
| 主 App | `editOK/moneyOK` App.jsx 1018–1030；矩陣 `spaces.js` 124–131（供應鏈六頁各 edit/money）；admin/manager 全開；未登入訪客唯讀且金額全遮 | 規格第 7 頁「看成本／看售價試算／改價格／改配方／發布／處理待處理／靜音」只有 edit/money 兩維，需擴 |
| 資料庫 RLS | `docs/RLS_LOCKDOWN.md`（2026-07-18）：`pm_documents` 開 RLS，`pmdoc_read_auth/insert_auth/update_auth`＝**已登入者全表可讀寫**；`docs/AUTH_PLAN.md` 階段 4「金額後端鎖死」未做 | 主 App 前端用 anon key 直寫 `sp_supply_*`；/prep 全走 service role 端點。規格「關掉的權限 API 層不回傳」只有 /prep 路徑做得到 |
| ground-pack | 規格提到其 RLS 關閉；**本 repo 無該專案**（只有 Supply.jsx 1235 行「ground-pack 風」樣式註解） | 未確認 |

## 5. 規格頁面 × 現有可沿用 × 要新增

| 規格頁面 | 現有可沿用 | 要新增 | 理由 |
| --- | --- | --- | --- |
| 1 成本總覽 | /prep 看板卡片樣式（p01）、`Finance.jsx` 毛利口徑、`?costtodo&count` 徽章數 | 新頁：四格 KPI＋本週成本變動＋待處理前 10；品類成本率上限設定（新 KV） | 現無任何「成本完整數／變價數」聚合；數字需來自成本快照（尚無） |
| 2 偵錯與待處理中心 | `api/_cost.js`＋`?costtodo`（WIP）、`PriceTrack` 疑似有誤旗標概念、`matcat` 分類、D哥/`wpPush` 通知底盤 | 五分頁 UI（p17 新檔）、靜音三範圍與期限、決定留痕 UI、導覽徽章、合併建議資料 | 既有 `pm_price_flags` 只三態且綁文字 key；待處理需綁供應品/物料卡 ID |
| 3 物料庫＋物料卡 | p16-matlib 三子頁（列表/篩選/下鑽/叫貨單）、`Materials.jsx` 詳情五區雛形、`inv.js parseSpec`、`sp_finance_pm_inv.cats` 分類 | **物料卡／供應品／價格紀錄／換算／合併紀錄五個新實體**（目前只有「ordi 聚合」與主 App `ingredients/vendorItems`，且兩套互不相通）、當時價查詢、照片牆 | 規格要求舊代碼永遠保留變別名、價格只新增不覆寫；現 matlib 以 `c:code|n:name` 當 key、主 App `last` 是覆寫快取 |
| 4 食譜庫＋製作模式 | `inv.js recipeCost` 遞迴骨架、`pm_recipe_v_` append-only、`Recipe.jsx` 版面、boss `/recipes`（預接 `rcp`） | 草稿/發布狀態、步驟表（媒體/計時）、換算鏈逐行、成本快照＋差異標記、循環/深度檢查、製作模式手機版 | 現版本流水「每存＝新版本」沒有草稿；A Beach 195 份食譜要從 boss `rcp` 讀，repo 目前零筆 |
| 5 菜單與定價 | `sp_finance_pm_menu`（品名/售價）、`pm_pos_prices` 牌價、`pm_pos_costs` 出口、boss `menu` 快照（price/cost/cost_ratio 交叉比對）、`productPackaging` 概念 | 菜單規格（多規格/通路/稅別）、三通路包材組、套餐展開、試算、成本歷史 | 現菜單無規格/通路/包材欄；`productPackaging` 無數量無通路 |
| 6 廠商與月帳 | 主 App `vendors`、matlib 廠商分類 `vmap`、boss `/suppliers` `/gops/suppliers`（預接）、`src/lib/cost.js` 稅別換算口徑 | 廠商列表（稅別/帳期/最低訂購）、對帳「未稅＋稅額」兩格、GROUN:D vendor_recon | repo 無任何對帳(vendor_recon)資料；A Beach 對帳在阿桑端（規格列「尚缺」） |
| 7 權限設定 | `prep_perm`＋`permWho`＋`EDIT_FN` 鎖門器（/prep）、`spaces.js` 矩陣（主 App） | 功能×角色開關（看成本/試算/改價/改配方/發布/處理/靜音）、API 層依開關裁欄位、matlib 自己的分頁鍵 | 現只有「分頁可編 0/1」一維；成本可見性等於「有綁定」 |
| 驗收攔截（既有頁） | GROUN:D：`Supply.jsx` 729–742 驗收流程＋`buildPriceEvents`；A Beach：無本 app 驗收 | GD：攔截對話框（門檻內提示／超門檻必選原因＋拍照）、「待確認」狀態使成本不立即更新；AB：每日掃 `ordi/gordi` 寫價格變動紀錄 | 現驗收價寫入即更新 `last` 進成本，無待確認 |
| 耗損紀錄（1b） | p01 `actLoss`＋`prep_act_` 月檔（舊備料板）、`sopsign` 私桶直傳、AI 中樞 `api/_ai.js`（aiCall/aiImage）、`sp_finance_pm_inv` 物料清單 | 耗損流水/照片/容器/辨識圖庫/估重配對五實體、AI 讀秤、合理性檢查、大額進待處理 | 舊耗損只有 item 文字＋qty，無金額快照、無物料 ID |

## 6. boss-api 已開通端點實際欄位

（CC 補）

## 7. 規格 vs 程式／資料對不上的點

| # | 規格說 | 程式／資料實況 | 影響 |
| --- | --- | --- | --- |
| 1 | 「尚缺：A Beach 叫貨歷史（orders/order_items）…目前只有 GROUN:D 的叫貨單」 | `boss-sync.js` 50–51 行自 2026-01 起每小時同步 **A Beach** `orders`/`orders/items` → `boss_ord_/ordi_`；matlib/matord/_cost.js 都在用。反倒 GROUN:D `gops/orders` 才是預接中（404） | 規格「已開通端點」表漏列 `/orders` `/orders/items`；「尚缺」表的 A Beach 叫貨歷史其實已有（缺的是 order_adjust 驗收改價） |
| 2 | 已開通 9 端點（2026-10-10） | 10-10 晚實測 8 個新端點全 404（boss-sync 61–62 行註解），KV 內無 `prod/sup/rcp/citem/gprod/gsup/gord/gordi` 任何資料 | 批次 0「用 boss-api 實際呼叫每個端點各一頁」目前做不到，第 6 節待補 |
| 3 | 單價 0 或空白＝不知道價格 | `?matlib` 把 `price=0` 視為有效價（minP/lastPrice/pctChg） | 物料庫波動數字會被 0 污染；`_cost.js` 已排除 0，兩口徑不一致 |
| 4 | 成本基準＝最近一次**已確認的驗收進價** | 主 App `inv.js lastPaid` 無 last 時退回主檔 `price`；驗收完成立即更新 `last`（無待確認）；boss `ordi.price` 為下單價 | 三個來源都不是「已確認驗收價」 |
| 5 | 半成品成本＝原料÷實際可用產量，耗損已在產量裡不再加 | `recipeCost` 另除以 `(1−lossPct)` | 與規格雙重計算；A Beach 食譜若帶 yield_qty 會被再打折 |
| 6 | 包材依內用/外帶/外送各一組＋數量 | `productPackaging` 只有 product_id↔packaging_id，每份固定 1 個、無通路 | 規格頁 5 需新資料結構 |
| 7 | 同名不自動合併，只提建議 | `inv.js organizeAll` 同名（normName）自動併卡 | 需改為產生「合併建議」 |
| 8 | 物料卡／供應品／價格紀錄「只新增不覆寫」 | 主 App `vendorItems.last/quote` 為覆寫快取；`pm_ph_` 以「廠商+品名」文字為 key；matlib 無實體只是聚合 | 當時價查詢無法對到供應品 ID；需要新表 |
| 9 | 權限：功能×角色、關掉的在 API 層不回傳 | /prep 只有「分頁可編 0/1」；成本可見＝有綁定；主 App 只有 edit/money；RLS 對已登入者全表開 | 第 7 頁幾乎全新；主 App 路徑無法在 API 層裁欄位 |
| 10 | 計算在服務端（DB view / RPC） | repo 沒有任何 DB view/RPC；KV 是 `pm_documents` 文件表；主 App 成本在前端 `inv.js` 算 | 「服務端算」只能落在 `api/` 函式（如 `_cost.js`），非 SQL view |
| 11 | 月帳／vendor_recon、order_adjust、item_convs、product_price_log | repo 完全沒有這些資料（grep 無） | 與規格「尚缺」表一致，但表示批次 1 的「對帳兩格」「驗收改價」目前無資料可做 |
| 12 | 物料庫＝模組七頁之一，應有自己的權限 | `TAB_DEF`（p09 297）沒有 `matlib` → 不能改名/排序、權限矩陣沒有它、按鈕文字 fallback | 要把 `matlib`（或新模組鍵）登記進 `TAB_DEF`/`EDIT_FN` |
| 13 | 批次 1b 耗損「物料先用 `src/supply/` 現有物料清單」 | /prep 現場用的是 `sp_finance_pm_inv.food/pack`（另一套，無價格）；`src/supply` 的 `ingredients` 在主 App 空間，/prep 沒有端點讀它（`kvproxy` 1014 只准 `sp_team_pm_task*`） | 耗損在 /prep 做的話要新開端點讀 `sp_supply_pm_supply`，或先接 `pm_inv` |
| 14 | 「10/06 快照 20 筆異常」驗收基準 | 快照灌入口 `?costsnap` 已進 `f0355db`；腳本實際檔名 `scripts/cost-snap-ingest.py`（mail-sync 4696 行註解寫 `.mjs`）；KV 內是否已灌入未確認 | 批次 1 完成條件要先確認快照已入庫 |
