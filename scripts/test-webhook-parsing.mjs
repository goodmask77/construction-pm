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

if (fails) { console.error(`\n❌ ${fails} 個測試失敗`); process.exit(1) }
console.log('\n✅ test-webhook-parsing 全過')
