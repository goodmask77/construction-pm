// 本機單元測試：假 KV，驗 specG/perGram/loadRows(含舊備料板)/addWaste(金額快照、大額旗標、沖銷)/summarize
process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'
const W = await import(process.argv[2] + '/api/_waste.js')
const kv = {}
const kvGet = async id => kv[id] ? JSON.parse(JSON.stringify(kv[id])) : null
const kvPut = async (id, o) => { kv[id] = JSON.parse(JSON.stringify(o)) }
const ym = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
kv['sp_finance_pm_boss_gprod'] = { rows: { 'GD-1': { code: 'GD-1', name: '冷凍披薩麵團250g*30個-卡普托', unit: '箱', spec: '未稅', price: 810, cost: 0, stock: 11, is_active: true, category: '烘焙', store: '凍' }, 'GDS-0074': { code: 'GDS-0074', name: '白醬', unit: '包', spec: '1000g/包', price: 225, cost: 225, stock: 3, is_active: true }, 'GD-2': { code: 'GD-2', name: '美生菜', unit: '公斤', price: 180, cost: 180, stock: 2, is_active: true }, 'GD-3': { code: 'GD-3', name: '雞蛋', unit: '顆', price: 7, stock: 60, is_active: true } } }
kv['sp_finance_pm_prep_act_' + ym] = { days: { [ym + '-05']: { '夏威夷披薩': { loss: [{ q: 2, r: '掉了', by: '小海', ts: ym + '-05T03:00:00Z' }] } } } }
let fails = 0
const T = (n, c) => { console.log(c ? '✓' : '✗', n); if (!c) fails++ }
T('specG 250g*30個 = 7500', W.specG('冷凍披薩麵團250g*30個-卡普托')?.total === 7500)
T('specG 1kg*10塊/箱 = 10000', W.specG('1kg * 10塊/箱')?.total === 10000)
T('perGram 公斤 → /1000', Math.abs(W.perGram({ unit: '公斤', cost: 180 }).perG - 0.18) < 1e-9)
T('perGram 箱+名稱規格 810/7500', Math.abs(W.perGram({ unit: '箱', price: 810, cost: 0, spec: '未稅', name: '冷凍披薩麵團250g*30個' }).perG - 810 / 7500) < 1e-9)
T('perGram 顆 無換算→null+perUnit', W.perGram({ unit: '顆', price: 7 }).perG == null && W.perGram({ unit: '顆', price: 7 }).perUnit === 7)
const who = { name: '測試員' }
let r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', station: 'Pizza', code: 'GD-2', grossG: 1500, tareG: 300, netG: 1200, reason: '過期', ai: { readG: 1500, conf: .9, cands: [{ code: 'GD-2' }] } } })
T('入帳 美生菜 1200g 金額=216', r.ok && r.rec.amount === 216 && r.rec.src === 'photo' && r.rec.corrected === false)
r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', code: 'GD-2', grossG: 20000, tareG: 0, netG: 20000, reason: '製作失誤', ai: { readG: 2000, conf: .9, cands: [{ code: 'GDS-0074' }] } } })
T('大額 3600 元 bigFlag + 修正(讀數/物料都不同)', r.ok && r.rec.bigFlag === true && r.rec.corrected === true)
r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', code: 'GD-3', qty: 5, qtyUnit: '顆', reason: '掉落污染' } })
T('數量型 5 顆 ×7 = 35', r.ok && r.rec.amount === 35)
r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', name: '不明料', netG: 100, reason: '其他' } })
T('其他沒說明被擋', !r.ok)
r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', name: '不明料', netG: 100, reason: '其他', note: '測' } })
T('不在主檔 → 金額 null 待物料卡', r.ok && r.rec.amount == null && /待物料卡/.test(r.rec.costNote))
r = await W.addWaste({ kvGet, kvPut, who, body: { store: 'ground', code: 'GD-2', netG: 50, staffMeal: true } })
T('員工餐 不需原因', r.ok && r.rec.reason === '員工餐')
const rows = await W.loadRows({ kvGet, months: [ym] })
T('舊備料板耗損併入清單', rows.some(x => x.src === 'board' && x.name === '夏威夷披薩' && x.qty === 2))
const cfg = await W.cfgGet(kvGet)
T('命中率紀錄 GD-2 n=2 hit=1', cfg.hit['GD-2'] && cfg.hit['GD-2'].n === 2 && cfg.hit['GD-2'].hit === 1)
const s = W.summarize(rows, cfg)
T('統計 總額=216+3600+35=3851、員工餐另計、大額1、無金額2(不明料+舊備料板份數)', s.total.amount === 3851 && s.total.staffMeal === 1 && s.total.big === 1 && s.total.noCost === 2)
const big = rows.find(x => x.bigFlag)
r = await W.voidWaste({ kvGet, kvPut, who, body: { id: big.id, ym } })
const rows2 = await W.loadRows({ kvGet, months: [ym] }); const s2 = W.summarize(rows2, cfg)
T('沖銷後 總額=251、原紀錄保留', r.ok && s2.total.amount === 251 && rows2.some(x => x.id === big.id))
r = await W.voidWaste({ kvGet, kvPut, who, body: { id: big.id, ym } })
T('重複沖銷被擋', !r.ok)
r = await W.cfgSave({ kvGet, kvPut, who, body: { containers: [{ name: '小盆', g: 180 }], reasons: ['過期', '其他'], bigAmt: 300 } })
const c2 = await W.cfgGet(kvGet); T('設定 容器/原因/門檻', c2.containers[0].g === 180 && c2.reasons.length === 2 && c2.bigAmt === 300)
console.log(fails ? `❌ ${fails} 項失敗` : '✅ 全部通過')
