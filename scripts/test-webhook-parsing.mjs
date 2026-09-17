// DD（LINE bot）動作解析自我測試：parseActions / describeAction / extractMemoryTags / stripJson
// 這些函式決定「DD 聽懂指令 → 動手操作 App」的正確性，跑在每次部署前（npm run selftest）。
import { parseActions, extractBalancedObjects, describeAction, extractMemoryTags, stripJson } from '../api/line-webhook.js'

let fails = 0
const ok = (name, cond) => { console.log((cond ? '✅' : '❌') + ' ' + name); if (!cond) fails++ }

console.log('── DD 動作解析 ──')

// 標準 markdown json 區塊
const a1 = parseActions('好的，幫你記！\n```json\n{"actions":[{"type":"add_log","content":"今天水電進場"}]}\n```')
ok('標準 json 區塊 → 1 動作', a1.length === 1 && a1[0].type === 'add_log' && a1[0].content === '今天水電進場')

// 裸 json（AI 忘了包 code fence）＋多動作
const a2 = parseActions('{"actions":[{"type":"add_task","desc":"買水泥"},{"type":"add_payment","category":"消防","amount":100}]}')
ok('裸 json 多動作 → 2 動作', a2.length === 2 && a2[0].type === 'add_task' && a2[1].type === 'add_payment')

// 純文字回答 → 不得誤判出動作
ok('純文字 → 0 動作', parseActions('今天進度 87%，預算還剩 NT$120,000，加油！').length === 0)

// 壞掉的 json → 不能炸掉（要回空陣列或撿得回的部分）
ok('壞 json 不炸', Array.isArray(parseActions('```json\n{"actions":[{bad json!!}]}\n```')))

// 巢狀物件的平衡擷取
const objs = extractBalancedObjects('前面廢話 {"type":"add_item","meta":{"a":{"b":1}}} 後面廢話 {"type":"add_log"}')
ok('平衡擷取巢狀物件 → 2 個', objs.length === 2 && JSON.parse(objs[0]).meta.a.b === 1)

console.log('── describeAction（確認清單顯示）──')
const types = [
  { type: 'add_log', content: '今天拉管線' },
  { type: 'add_task', desc: '買水泥', due: '2026-09-05' },
  { type: 'add_todo', desc: '追交期' },
  { type: 'add_conclusion', topic: '開幕日', conclusion: '9/10' },
  { type: 'add_payment', category: '消防', amount: 63000 },
  { type: 'add_finance_tx', kind: 'expense', amount: 500 },
  { type: 'update_task', task: '買水泥', status: '完成' },
  { type: 'update_task', task: '時鐘', space: '團隊', category: '採購' },
  { type: 'delete_task', task: '溫度探針、推車、碼錶、計時器、時鐘', space: '團隊' },
  { type: 'add_category', name: '採購', space: '團隊' },
  { type: 'set_item', category: '消防', item: '灑水頭', status: '完工' },
  { type: 'delete_category', category: '空調' },
  { type: 'no_such_type' },
]
ok('所有動作類型都能描述（含未知型別）', types.every(t => typeof describeAction(t) === 'string' && describeAction(t).length > 0))
ok('跨空間描述帶空間名（確認時看得出動到哪個空間）', describeAction({ type: 'delete_task', task: 'X', space: '團隊' }).includes('團隊') && describeAction({ type: 'add_category', name: '採購', space: '團隊' }).includes('團隊') && describeAction({ type: 'update_task', task: 'X', space: '團隊', category: '採購' }).includes('團隊'))

console.log('── 記憶標記 ──')
const m1 = extractMemoryTags('好的沒問題！\n[[記住:老闆偏好條列回覆]]\n[[記住:阿哲負責消防]]')
ok('抓出 2 條記憶＋標記移除乾淨', m1.facts.length === 2 && m1.facts[1] === '阿哲負責消防' && !m1.clean.includes('[['))
const m2 = extractMemoryTags('一般回答，沒有標記。')
ok('無標記 → 原文不動', m2.facts.length === 0 && m2.clean === '一般回答，沒有標記。')

console.log('── stripJson（prose 保留）──')
const s1 = stripJson('幫你記這筆！另外你問的進度是 87%。\n```json\n{"actions":[{"type":"add_log","content":"x"}]}\n```')
ok('json 拿掉、給人看的文字保留', s1.includes('87%') && !s1.includes('add_log'))

// 自動執行分流：純記錄類 vs 要確認類（與 line-webhook.js 的 AUTO_TYPES 保持一致）
console.log('── 自動執行分流 ──')
const AUTO_TYPES = new Set(['add_log', 'add_task', 'add_todo', 'add_conclusion'])
const mixed = [{ type: 'add_log' }, { type: 'add_payment' }, { type: 'add_task' }, { type: 'delete_item' }, { type: 'delete_task' }]
const auto = mixed.filter(a => AUTO_TYPES.has(a.type))
const confirm = mixed.filter(a => !AUTO_TYPES.has(a.type))
ok('記錄類直接執行、危險類留給確認（delete_task 屬確認類）', auto.length === 2 && confirm.length === 3 && confirm.every(a => ['add_payment', 'delete_item', 'delete_task'].includes(a.type)))

// 每日任務提醒（cron-daily）：早班簡報/晚班追蹤的分組與「沒事就不吵」
console.log('── 每日任務提醒 ──')
const { buildTaskRemind, buildTeamRemind } = await import('../api/cron-daily.js')
const T = '2026-09-08'
const sample = [
  { title: '付消防尾款', sp: '工程', due: '2026-09-05', status: 'todo' },                    // 逾期
  { title: '訂杯子', sp: '團隊', due: '2026-09-08', owner: '阿桑', status: 'todo' },          // 今天
  { title: '排下月班表', sp: '夥伴', due: '2026-09-10', status: 'todo' },                     // 三天內
  { title: '找新供應商', sp: '團隊', priority: 'urgent', status: 'todo' },                    // 超急無截止
]
const morning = buildTaskRemind(sample, false, T)
ok('早班簡報含 逾期/今天/超急/三天內 四組', morning.includes('逾期') && morning.includes('付消防尾款') && morning.includes('今天到期') && morning.includes('訂杯子') && morning.includes('超急') && morning.includes('三天內'))
const eve = buildTaskRemind(sample, true, T)
ok('晚班只追 逾期＋今天，不含三天內', eve.includes('付消防尾款') && eve.includes('訂杯子') && !eve.includes('排下月班表'))
ok('晚班：今天/逾期都清了 → null 不吵', buildTaskRemind([{ title: 'x', sp: '工程', due: '2026-09-10', status: 'todo' }], true, T) === null)
ok('沒任何到期/急件 → 早班也不發', buildTaskRemind([{ title: 'x', sp: '工程', status: 'todo' }], false, T) === null)
const team = buildTeamRemind(sample, T)
ok('團隊版按負責人分組＋逾期標記', team.includes('阿桑') && team.includes('訂杯子') && team.includes('（未指派）') && team.includes('逾期'))

// 任務互動按鈕卡（_ddcards buildTaskCards）：一卡一任務、postback 資料格式、日曆按鈕
console.log('── 任務按鈕卡 ──')
const { buildTaskCards } = await import('../api/_ddcards.js')
const card = buildTaskCards([
  { id: 'a1', title: '付消防尾款', sp: '工程', due: '2026-09-05', status: 'todo' },
  { id: 'b2', title: '訂杯子', sp: '團隊', due: '2026-09-08', owner: '阿桑', status: 'todo' },
], '今日任務', '2026-09-08')
const raw = JSON.stringify(card)
ok('flex 訊息＋2 張卡', card.type === 'flex' && card.contents.type === 'carousel' && card.contents.contents.length === 2)
ok('四顆按鈕資料格式正確（done/d1/pick/del＋空間碼）', raw.includes('tk|done|工|a1') && raw.includes('tk|d1|工|a1') && raw.includes('tk|pick|團|b2') && raw.includes('tk|del|團|b2'))
ok('改日期用 datetimepicker（跳日曆）且逾期卡標紅', raw.includes('datetimepicker') && raw.includes('#B42318') && raw.includes('（逾期）'))
ok('單件任務 → 單卡不是 carousel', buildTaskCards([{ id: 'x', title: 'x', sp: '工程' }], 't', '2026-09-08').contents.type === 'bubble')

// 下週規劃（週日傍晚送）：逾期優先、按日分組、超急/沒日期另列、沒事回 null
console.log('── 下週規劃 ──')
const { buildWeeklyPlan } = await import('../api/cron-daily.js')
const wk = buildWeeklyPlan([
  { id: '1', title: '付消防尾款', sp: '工程', due: '2026-09-05', status: 'todo' },
  { id: '2', title: '訂杯子', sp: '團隊', due: '2026-09-09', owner: '阿桑', status: 'todo' },
  { id: '3', title: '排班表', sp: '夥伴', due: '2026-09-11', status: 'todo' },
  { id: '4', title: '找新供應商', sp: '團隊', priority: 'urgent', status: 'todo' },
  { id: '5', title: '慢慢想', sp: '工程', status: 'todo' },
], '2026-09-06') // 週日
ok('週規劃：先清舊帳＋按日分組＋週幾正確', wk.includes('先清舊帳') && wk.includes('付消防尾款') && wk.includes('09/09（三）') && wk.includes('09/11（五）') && wk.includes('排班表'))
ok('週規劃：超急無日期、沒截止日另列', wk.includes('超急') && wk.includes('找新供應商') && wk.includes('1 件沒設截止日'))
ok('週規劃：完全沒事 → null', buildWeeklyPlan([{ id: 'x', title: 'x', sp: '工程', status: 'todo' }], '2026-09-06') === null)

// 確認卡（cf|ok / cf|no）
console.log('── 確認按鈕卡 ──')
const { buildConfirmCard } = await import('../api/_ddcards.js')
const cf = JSON.stringify(buildConfirmCard('共 2 個操作'))
ok('確認卡帶 cf|ok 與 cf|no 按鈕', cf.includes('"cf|ok"') && cf.includes('"cf|no"') && cf.includes('確認執行') && cf.includes('取消'))

// 快速設定卡（記完任務馬上附：截止日/分類/負責人/超急）
console.log('── 快速設定卡 ──')
const { buildTaskSetupCards } = await import('../api/_ddcards.js')
const su = JSON.stringify(buildTaskSetupCards([
  { id: 'n1', title: '快樂甜圈球－找代工廠', sp: '團隊' },
  { id: 'n2', title: '蜂蜜奶油玉米麵包－找代工廠', sp: '團隊' },
], '2026-09-08'))
ok('設定卡：四顆按鈕資料格式（pick/cat/own/urg＋團隊碼）', su.includes('tk|pick|團|n1') && su.includes('tk|cat|團|n1') && su.includes('tk|own|團|n2') && su.includes('tk|urg|團|n2'))
ok('設定卡：日曆按鈕＋兩張卡', su.includes('datetimepicker') && JSON.parse(su).contents.contents.length === 2)

// 「說記好但沒寫入」自動抓包（2026-09-12 翻車案例的防呆）
console.log('── 假完成抓包 ──')
const { falseDoneWarning } = await import('../api/line-webhook.js')
ok('說「已記好」但 0 動作 → 加警語', falseDoneWarning('好，設備更換電磁爐評估已記好，你到 App 看得到 👌', 0).includes('沒有'))
ok('json 區塊壞掉沒解析出動作 → 加警語', falseDoneWarning('幫你記！```json\n{壞掉}\n```', 0).includes('格式出錯'))
ok('講「上次已記好」（回顧過去）→ 不誤判', falseDoneWarning('上次那筆已記好了，在採購大項裡。', 0) === '')
ok('一般回答 → 不加警語', falseDoneWarning('今天進度 87%，目前沒有逾期任務。', 0) === '')
ok('真的有執行動作 → 不加警語', falseDoneWarning('幫你記這筆👇', 2) === '')
// v2.5.9：2026-09-16 群組翻車原句「7 件都先建好了」閃過舊 regex → 補「建好/建立/開好」措辭
ok('說「都先建好了」→ 抓到', falseDoneWarning('7 件都先建好了，每張都附了快速設定卡。', 0).includes('沒有'))
ok('說「已建立大項」→ 抓到', falseDoneWarning('系統設備大項已建立，任務也開好了。', 0).includes('沒有'))
ok('唯讀對話（readonly）→ 用唯讀版警語', (() => { const w = falseDoneWarning('都建好了！', 0, true); return w.includes('寫入權限') && w.includes('操作者') })())
ok('唯讀＋一般回答 → 不加警語', falseDoneWarning('今天進度 87%。', 0, true) === '')
// 仿冒「✅ 已直接記好」→ 消毒改標假清單（二次翻車防呆）
const { sanitizeFakeDone } = await import('../api/line-webhook.js')
const fake = sanitizeFakeDone('好，確實送出一次👇\n✅ 已直接記好（團隊工作·採購）：\n📝 12吋披薩圓盒')
ok('仿冒系統核可章 → 改標 ❌ 假清單', fake.includes('❌') && fake.includes('假清單') && !fake.includes('✅ 已直接記好'))
ok('沒仿冒 → 原文不動', sanitizeFakeDone('今天進度 87%') === '今天進度 87%')

// 年資計算（2026-09-18 翻車防呆：AI 目測年份判滿一年 → 改由程式算好餵給它）
console.log('── 年資計算 ──')
const { tenureOf } = await import('../api/line-webhook.js')
const NOW = Date.UTC(2026, 8, 18) // 固定在 2026-09-18（台北）測
ok('2025-04-02 → 1年5個月（翻車案例本人）', tenureOf('2025-04-02', NOW) === '1年5個月')
ok('2025-09-18 → 整整1年（當天滿）', tenureOf('2025-09-18', NOW) === '1年')
ok('2025-09-19 → 11個月（差一天不滿）', tenureOf('2025-09-19', NOW) === '11個月')
ok('2022-01-17 → 4年8個月', tenureOf('2022-01-17', NOW) === '4年8個月')
ok('壞日期 → 空字串不炸', tenureOf('不明', NOW) === '' && tenureOf('', NOW) === '')

if (fails) { console.error(`\n❌ ${fails} 個測試失敗`); process.exit(1) }
console.log('\n✅ test-webhook-parsing 全過')
