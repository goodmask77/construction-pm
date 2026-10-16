// 異常通知域（v4.71.158 abgd 搬家 B 模式）：阿桑交接異常月檔 sp_finance_pm_boss_inc_YYYYMM、AB 停售 sp_finance_pm_absoldout
//   依資料歸屬走 GD 或新殼、一律版本比對寫；incTx(key, mutate, editor)：每次重讀最新 → mutate(cur) 回 { write, doc, value } → 寫；撞版本重讀重做（最多 8 次）
import crypto from 'node:crypto'
import { abgdKv } from './_abgdkv.js'
const newKv = (op) => abgdKv({ domain: 'incidents', lockKey: 'sp_finance_pm_boss_inc_', operator: String(op || '異常通知').slice(0, 30), label: '異常通知', versioned: true })
// deadline（毫秒時刻，可省）約定：截止後「不再發起」新的讀、寫或重做；已送出的那一個請求允許完成（最多讀 15 秒／寫 20 秒；
//   送出的寫入就算中途取消，伺服器端也可能已提交，取消不能保證不寫，所以不宣稱截止即停）。這裡只用於清帳＝拿掉已送 id，晚到完成也是冪等（關卡 3 OpenAI 第十二輪）
export async function incTx(key, mutate, editor, op, deadline) {
  const late = () => { if (deadline && Date.now() >= deadline) { const e = new Error('超過這輪時間，停止'); e.code = 'deadline'; throw e } }
  for (let i = 0; i < 8; i++) {
    late()
    const kv = await newKv(op || editor)
    late()
    const cur = await kv.kvGet(key)
    late()
    const res = mutate(cur)
    if (!res || !res.write) return res ? res.value : undefined
    late() // 寫入發起前再檢查一次（關卡 3 Gemini 第二輪 B）
    try { await kv.kvPut(key, res.doc, editor || '異常通知'); return res.value } catch (e) { if (!(e && e.code === 'stale')) throw e }
    await new Promise(r => setTimeout(r, 100 + Math.random() * 300))
  }
  const e = new Error('異常通知資料一直有人同時在改，這次沒存進去'); e.code = 'commitfail'; throw e
}
// 觀測戳記：抓來源之前取；ISO 時間＋隨機尾碼（同毫秒兩次觀測也分得出先後，字串比大小；關卡 3 OpenAI 第二輪 A2）
export const obsStamp = () => new Date().toISOString() + '|' + Math.random().toString(36).slice(2, 10).padEnd(8, '0')
// AB 停售狀態比對寫（排程 joya-intraday 與手動掃描 ?abscan 共用一份算法）：每次重做都對「最新那份」重算，回傳只取最後成功那次的結果
//   nowSo：這次看到的停售品名 {名:1}；obs：抓清單前取的觀測戳記（文件裡的較新＝不寫、回 null）；day：今天；stamp：記在 current 的時間字樣
//   每次觀測都寫（推進觀測戳記 obsAt、記今天基準）；manual＝手動掃描：回 { added, removed, current }（不發群）；排程：只有真的有變化才回結果（呼叫端據此發群），第一次建檔只落基準
//   待發群事件跟狀態存同一份（pend：[{ id, at, list }]，關卡 3 OpenAI 第七輪 A1）：排程回 { pend }＝要送的（含之前沒送成功的），送成功再 soldoutDone 拿掉；超過 6 小時沒送成的丟掉
const PEND_MS = 6 * 3600e3
const livePend = (p, now) => (Array.isArray(p) ? p : []).filter(e => { if (!e || !e.id) return false; if (now - Date.parse(e.at || 0) < PEND_MS) return true; console.log('absoldout pend expired（6 小時沒送成，丟掉）', e.id, String(e.list || '')); return false }) // 不設筆數上限（每 30 分最多一筆新事件，6 小時內十幾筆）；到期丟掉要留紀錄（關卡 3 OpenAI 第八輪 A1）
export function soldoutApply(cur, { nowSo, obs, day, hm, stamp, manual, now = Date.now() }) {
  if (cur && cur.obsAt && cur.obsAt > obs) return manual ? { write: false, value: { skipped: '已有較新的掃描結果', current: cur.current || {}, added: [], removed: [] } } : { write: false, value: { pend: livePend(cur.pend, now) } }
  const doc = cur ? { ...cur, current: { ...(cur.current || {}) }, log: [...(cur.log || [])], obsAt: obs, pend: livePend(cur.pend, now) } : { current: {}, log: [], obsAt: obs, pend: [] }
  if (!cur && !manual) { doc.current = Object.fromEntries(Object.keys(nowSo).map(n => [n, stamp])); doc.day = day; return { write: true, doc, value: { pend: [] } } } // 第一次建檔＝只落基準不發群（關卡 3 OpenAI 第六輪 A2）
  const prev = doc.current
  const added = Object.keys(nowSo).filter(n => !(n in prev)), removed = Object.keys(prev).filter(n => !(n in nowSo))
  if (added.length || removed.length) {
    doc.current = Object.fromEntries(Object.keys(nowSo).map(n => [n, prev[n] || stamp]))
    added.forEach(n => doc.log.unshift({ d: day, t: hm, n, op: '停售' })) // current 上一行已給新停售品 stamp
    removed.forEach(n => doc.log.unshift({ d: day, t: hm, n, op: '恢復' }))
    doc.log = doc.log.slice(0, 300)
    if (manual) { doc.day = day; return { write: true, doc, value: { added, removed, current: doc.current } } } // 手動掃描＝靜默校正（舊行為，不發群）
    const lines = [...added.map(n => `🚫 ${n} 停售了（約 ${hm}）`), ...removed.map(n => `✅ ${n} 恢復販售（約 ${hm}）`)]
    const cn = Object.keys(doc.current)
    doc.pend = [...doc.pend, { id: crypto.randomUUID(), at: new Date(now).toISOString(), list: `${lines.join('\n')}\n目前停售中：${cn.length ? cn.join('、') : '無'}` }]
    doc.day = day
    return { write: true, doc, value: { pend: doc.pend } }
  }
  if (manual) { doc.day = day; return { write: true, doc, value: { added, removed, current: doc.current } } }
  doc.day = day; return { write: true, doc, value: { pend: doc.pend } } // 沒變化也寫：推進觀測戳記（較新的「沒變化」也要擋住較舊的不同結果；關卡 3 OpenAI 第六輪 A1）＋記今天基準
}
export async function soldoutTx(opts, editor) { return incTx('sp_finance_pm_absoldout', (cur) => soldoutApply(cur, opts), editor) }
// 送待發事件：send(ev) 回 true＝已送達（或 LINE 說同一個重送識別碼已收過）；送成功的從文件拿掉（重讀最新再拿，撞版本重做）
//   整輪共用一個截止時間 budgetMs（含清帳）：發送只用到截止前 reserveMs（留給清帳）；每筆整段（含查群成員、額度尾巴）最多 perMs；
//   清帳（拿掉已送 id）也受剩餘時間限制，逾時＝先回傳、事件留著，下一輪用同一個重送識別碼再送（LINE 去重）（關卡 3 OpenAI 第九、十輪 A1）
// 逾時只是不再等：底層請求（查群成員、LINE 發送、清帳寫入）仍可能在背景完成——送達了下一輪同一重送識別碼 LINE 去重、清帳冪等（關卡 3 Gemini 第二輪 B）
const within = (p, ms, msg) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(msg)), Math.max(0, ms)); p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) }) })
export async function soldoutFlush(pend, send, editor, { perMs = 12000, budgetMs = 25000, reserveMs = 8000 } = {}) {
  const done = [], end = Date.now() + budgetMs, sendEnd = end - reserveMs
  for (const ev of pend || []) {
    const left = sendEnd - Date.now(); if (left < 1000) { console.log('absoldout flush 這輪發送時間用完，剩下留到下一輪'); break }
    try { if (await within(Promise.resolve().then(() => send(ev)), Math.min(perMs, left), '發送逾時')) done.push(ev.id) } catch (e) { console.log('absoldout send err', ev.id, e?.message) }
  }
  if (done.length) {
    try { await within(incTx('sp_finance_pm_absoldout', (cur) => { if (!cur || !Array.isArray(cur.pend) || !cur.pend.some(e => done.includes(e.id))) return { write: false }; return { write: true, doc: { ...cur, pend: cur.pend.filter(e => !done.includes(e.id)) } } }, editor || 'AB停售通知已送', undefined, end), end - Date.now(), '清帳逾時') }
    catch (e) { console.log('absoldout 已送但清帳沒完成（下一輪同一個重送識別碼再送，LINE 去重）', done.join(','), e?.message) }
  }
  return done
}
export async function incGet(key, op) { return (await newKv(op)).kvGet(key) }
