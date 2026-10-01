// GROUN:D 盤中更新（張良 2026-08-27：喬亞後台是即時的，指定時間直接更新「今天」＋顯示更新時間）
// cron 每 15 分打一次（vercel.json，UTC 3-13 點＝台北 11:00-21:45），端點自己核對台北時間在不在名單內；
//   GD 快照格＝SLOTS（11:00-19:30 每 15 分自動生成），AB/1/2 只在整/半點跑——要改時間改 SLOTS 那行就好
// 寫入規則：只蓋「今天＋intraday 標記」的記錄，絕不動正式資料；打烊後 mail-sync syncJoya 會把
// intraday 記錄當缺日重抓成最終值（盤中數字不會凍住）。手動測試：?force=<MENU_PROBE_KEY>
import { joyaLogin, joyaFetchDay, joyaBuildRecord, taipeiToday } from './_joya.js'
import { kvGet, kvPut, announceChanged, invStatus } from './mail-sync.js'
import { syncEatsLive, eatsSession, eatsItemList } from './_eats.js' // AB 盤中定時更新（張良 2026-09-06：不用等人按🔄）

// 2026-08-27 二版（張良：峰值要能切半小時看）：快照相鄰兩張相減＝該時段營業額/單數（喬亞只給每小時，細粒度是快照推算的）
// 2026-09-21 三版（張良：每 15 分記錄一次，版面之後做週期切換）：GD 11:00-19:30 每 15 分一格。
//   月檔 pm_pos_hh 只收整/半點 {t,rev,tx}（既有半小時圖與 DD 口徑完全不動）；
//   15 分完整快照（含全品項累計）存每日檔 pm_pos_q_<日期>——相鄰相減=每15分各品項銷量，30/60分由前端聚合。
const SLOTS = []
for (let t = 11 * 60; t <= 19 * 60 + 30; t += 15) SLOTS.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'))
const WINDOW_MIN = 6 // cron 可能晚幾分鐘觸發，時間點後 6 分鐘內都算數
const AB_OPEN = '12:30', AB_CLOSE = '21:30' // 張良 2026-09-06：1/2/AB 一樣每半小時、12:30-21:30

const taipeiHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

export default async function handler(req, res) {
  const hm = taipeiHM(), nowM = toMin(hm)
  const mk = (process.env.MENU_PROBE_KEY || '').trim()
  const force = mk && String(req.query?.force || '') === mk
  const manual = String(req.query?.manual || '') === '1' // 前端「🔄 更新」鈕（張良 2026-08-27：按更新要立刻抓現在的數字）
  const hit = SLOTS.some(s => nowM >= toMin(s) && nowM < toMin(s) + WINDOW_MIN)
  // AB 定時更新（張良 2026-09-06）：手動不在這跑（🔄 鈕本來就會打 mail-sync 抓 AB，避免連打 Eats365 兩次）
  const abHit = !manual && (force || (nowM >= toMin(AB_OPEN) && nowM < toMin(AB_CLOSE) && (nowM % 30) < WINDOW_MIN)) // AB/1/2 維持每30分（cron 變 15 分別跟著加倍打人家後台）
  // ── GD 每日 SOP 超時檢查（張良 2026-09-21）：每次 cron 順路查，過時限未完成 → DD 發內部群一則彙整（每項每日只提醒一次）──
  try {
    const tpe = new Date(Date.now() + 8 * 3600e3)
    const wd = tpe.getUTCDay(), todaySop = tpe.toISOString().slice(0, 10)
    if (wd >= 1 && wd <= 5) { // GD 週末公休不吵
      const defDoc = await kvGet('sp_finance_pm_sop_def')
      const items = (defDoc && defDoc.ground && Array.isArray(defDoc.ground.items)) ? defDoc.ground.items : []
      if (items.length) {
        const dk = 'sp_finance_pm_sop_g_' + todaySop
        const slog = (await kvGet(dk)) || { items: {}, notified: {} }
        slog.items = slog.items || {}; slog.notified = slog.notified || {}
        const over = items.filter(it => it.due && it.due <= hm && !(slog.items[it.id] && slog.items[it.id].done) && !slog.notified[it.id])
        if (over.length) {
          const txt = '⏰ GD SOP 超時未完成：\n' + over.map(it => `・${it.st}｜${it.title}（${it.due} 前${it.photo ? '・要拍照' : ''}）`).join('\n') + '\n\n完成後到 ground-pm.vercel.app/prep 按「完成」打卡 🙏'
          const ncfg = (await kvGet('sp_finance_pm_notify')) || {} // 通知開關（張良 2026-09-21：預設關，/prep 🔔 開）
          const tk = ncfg.sopLate === 1 ? (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim() : ''
          if (tk) {
            const pr = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ to: 'Cf7940efc6517b0c084ad2ad496b45f30', messages: [{ type: 'text', text: txt }] }) })
            if (pr.ok) { over.forEach(it => { slog.notified[it.id] = 1 }); await kvPut(dk, slog, 'SOP超時通知') } // 發送成功才標記，失敗下一輪重試
          }
        }
      }
    }
  } catch (e) { console.log('sop check err', e?.message) }
  // ── 🚫 AB 停售即時偵測（張良 2026-09-29：每天及時知道誰停售＋大概時間）──
  // 每 30 分（AB 營業窗）撈 getItemList，品名 🚫 前綴＝團隊停售慣例；出現/消失 → happy337 即時通知＋記當日時間線
  try {
    if (abHit && (await kvGet('sp_finance_pm_notify') || {}).soldoutAB !== 0) {
      const todaySo = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
      const soDoc = (await kvGet('sp_finance_pm_absoldout')) || { current: {}, log: [] }
      const sessDoc = (await kvGet('sp_finance_pm_eats_sess')) || {}
      const sess = await eatsSession(sessDoc.device || process.env.EATS_DEVICE_COOKIE || '')
      const devN = Object.keys(sess.J.jar).find((k) => k.endsWith('|'))
      if (devN) await kvPut('sp_finance_pm_eats_sess', { device: devN + '=' + sess.J.jar[devN], updatedAt: new Date().toISOString() }, 'AB停售偵測')
      const items = await eatsItemList(sess)
      const nowSo = {}
      for (const it of items) if (/🚫/.test(it.n)) nowSo[it.n.replace(/🚫/g, '').trim()] = 1
      const prev = soDoc.current || {}
      const added = Object.keys(nowSo).filter(n => !(n in prev))
      const removed = Object.keys(prev).filter(n => !(n in nowSo))
      if (added.length || removed.length) {
        soDoc.current = Object.fromEntries(Object.keys(nowSo).map(n => [n, prev[n] || hm]))
        added.forEach(n => { soDoc.current[n] = hm; soDoc.log.unshift({ d: todaySo, t: hm, n, op: '停售' }) })
        removed.forEach(n => soDoc.log.unshift({ d: todaySo, t: hm, n, op: '恢復' }))
        soDoc.log = soDoc.log.slice(0, 300)
        await kvPut('sp_finance_pm_absoldout', soDoc, 'AB停售變化')
        const seenG = (await kvGet('pm_group_seen')) || {}
        const gidSo = (Object.entries(seenG).find(([, v]) => /happy\s*337/i.test((v && v.name) || '')) || [])[0]
        const lines2 = []
        added.forEach(n => lines2.push(`🚫 ${n} 停售了（約 ${hm}）`))
        removed.forEach(n => lines2.push(`✅ ${n} 恢復販售（約 ${hm}）`))
        const txtSo = `🔔 A Beach 停售異動\n${lines2.join('\n')}\n目前停售中：${Object.keys(soDoc.current).length ? Object.keys(soDoc.current).join('、') : '無'}`
        const tkSo = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        if (tkSo && gidSo) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkSo }, body: JSON.stringify({ to: gidSo, messages: [{ type: 'text', text: txtSo }] }) })
      } else if (!soDoc.day || soDoc.day !== todaySo) { // 每天首輪落個檔（沒變化也記狀態基準）
        soDoc.day = todaySo
        await kvPut('sp_finance_pm_absoldout', soDoc, 'AB停售基準')
      }
    }
  } catch (e) { console.log('absoldout err', e?.message) }
  // ── 🕵️ 品項停售盯梢（張良 2026-09-27：超過 5 個營業日沒販售 → DD 發 happy337 群請張良確認 斷貨/下架/產品問題）──
  try {
    if (hm >= '11:00' && hm < '11:20') {
      const todayS = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
      const staleDoc = (await kvGet('sp_finance_pm_stale')) || { notified: {} }
      const ncfgS = (await kvGet('sp_finance_pm_notify')) || {}
      if (staleDoc.day !== todayS && ncfgS.staleItem !== 0) { // 一天查一次；開關預設開（張良指定要的）
        staleDoc.day = todayS
        const mo1 = todayS.slice(0, 7), mo0 = `${Number(mo1.slice(0, 4)) - (mo1.slice(5) === '01' ? 1 : 0)}-${String(((Number(mo1.slice(5, 7)) + 10) % 12) + 1).padStart(2, '0')}` // 上個日曆月（舊寫法今天−32天：每月1-2號會跳過整個上月→9月被跳過誤報64項全停售，2026-10-01張良抓包）
        const [posD, dM1, dM0, aliasD, hiddenD] = await Promise.all([kvGet('sp_finance_pm_pos'), kvGet('sp_finance_pm_pos_d_' + mo1), mo0 !== mo1 ? kvGet('sp_finance_pm_pos_d_' + mo0) : null, kvGet('sp_finance_pm_pos_alias'), kvGet('sp_finance_pm_pos_hidden')])
        const daysAll = Object.assign({}, ((dM0 || {}).days) || {}, ((dM1 || {}).days) || {})
        const alerts = []
        for (const stq of ['ground', 'abeach']) {
          const alias = ((aliasD || {})[stq]) || {}, hidden = ((hiddenD || {})[stq]) || {}
          const bdays = ((posD || {}).entries || []).filter(e => ((/groun/i.test(e.store || '') ? 'ground' : 'abeach') === stq) && e.revenue > 0 && !e.intraday && e.date < todayS).map(e => e.date).sort().reverse().slice(0, 30)
          if (bdays.length < 8) continue
          const recent5 = new Set(bdays.slice(0, 5))
          const last = {}, nm = {}
          for (const dt of bdays) {
            const secs = ((daysAll[dt + '::' + stq] || {}).sheets || {})['總銷售額 (以類別分類)']
            if (!Array.isArray(secs)) continue
            for (const sec of secs) {
              if (sec.title === '總結' || sec.title === '套餐') continue
              for (const r of (sec.rows || [])) {
                if (!Array.isArray(r) || typeof r[0] !== 'string' || /^1\/4/.test(r[0].trim())) continue
                let k = String(r[0]); k = alias[k] || k
                if (hidden[k]) continue
                if ((Number(r[1]) || 0) <= 0) continue
                if (!last[k] || dt > last[k]) { last[k] = dt; nm[k] = r[0] }
              }
            }
          }
          for (const [k, dt] of Object.entries(last)) {
            if (recent5.has(dt)) continue
            const gap = bdays.indexOf(dt) // 最後販售之後過了幾個營業日
            const key = stq + '|' + k
            if (staleDoc.notified[key] === dt) continue // 已通知過且期間沒再賣→不重複吵
            staleDoc.notified[key] = dt
            alerts.push(`・[${stq === 'ground' ? 'GD' : 'AB'}] ${nm[k]}（最後販售 ${dt.slice(5)}，已 ${gap} 個營業日沒賣）`)
          }
        }
        if (alerts.length) {
          const seen = (await kvGet('pm_group_seen')) || {}
          const gidS = (Object.entries(seen).find(([, v]) => /happy\s*337/i.test((v && v.name) || '')) || [])[0]
          const txtS = `🕵️ 品項停售提醒（超過 5 個營業日沒賣出）\n${alerts.slice(0, 15).join('\n')}${alerts.length > 15 ? `\n…共 ${alerts.length} 項` : ''}\n\n請確認：斷貨？下架？產品有問題？要下架的跟 DD 說品名。`
          const tkS = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          if (tkS && gidS) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkS }, body: JSON.stringify({ to: gidS, messages: [{ type: 'text', text: txtS }] }) })
          else if (tkS) { // 找不到 happy337 群→退回私訊審核人（至少不漏）
            const [defS2, rosterS2] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_crew_kb_roster')])
            for (const an of (((defS2 || {}).ground || {}).approvers || ['張良瑋'])) {
              const ap = ((rosterS2 || {}).people || []).find(p2 => p2.name === an && p2.lineUserId)
              if (ap) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkS }, body: JSON.stringify({ to: ap.lineUserId, messages: [{ type: 'text', text: txtS + '\n\n（找不到 happy337 群——請在群裡跟 DD 講句話讓它記到群名後，之後會發群）' }] }) })
            }
          }
        }
        await kvPut('sp_finance_pm_stale', staleDoc, '停售盯梢')
      }
    }
  } catch (e) { console.log('stale err', e?.message) }
  // ── 📈 銷量預測每日快照（張良 2026-09-25 P1）：11:00 場次鎖定當日預測＋回填昨天實績（fcDaily 冪等，已鎖不重寫）──
  try {
    const tpeF = new Date(Date.now() + 8 * 3600e3)
    const wdF = tpeF.getUTCDay()
    if (wdF >= 1 && wdF <= 5 && hm >= '11:00' && hm < '11:20') {
      const { fcDaily } = await import('./_fc.js')
      await fcDaily(kvGet, kvPut, tpeF.toISOString().slice(0, 10))
    }
  } catch (e) { console.log('fc snapshot err', e?.message) }
  // ── 盤點/包材低水位提醒（張良 2026-09-21）：每天第一輪（11:00 場次）查一次，低於最低水位 → DD 發內部群一則彙整 ──
  try {
    const tpe2 = new Date(Date.now() + 8 * 3600e3)
    const wd2 = tpe2.getUTCDay(), todayInv = tpe2.toISOString().slice(0, 10)
    if (wd2 >= 1 && wd2 <= 5 && hm >= '11:00' && hm < '11:20') {
      const invDoc = (await kvGet('sp_finance_pm_inv')) || {}
      invDoc.notified = invDoc.notified || {}
      if (!invDoc.notified[todayInv]) {
        const [f2, p2] = await Promise.all([invStatus('food'), invStatus('pack')])
        const lows = [...f2.items.filter(x => x.low).map(x => ({ ...x, _k: '食材' })), ...p2.items.filter(x => x.low).map(x => ({ ...x, _k: '包材' }))]
        if (lows.length) {
          const txt2 = '📉 庫存低水位提醒：\n' + lows.map(x => `・[${x._k}] ${x.name}：估剩 ${x.est}${x.unit || ''}（低標 ${x.min}）`).join('\n') + '\n\n請盡快叫貨/補盤點：ground-pm.vercel.app/prep'
          const ncfg2 = (await kvGet('sp_finance_pm_notify')) || {}
          const tk2 = ncfg2.lowStock === 1 ? (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim() : ''
          if (tk2) {
            const pr2 = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk2 }, body: JSON.stringify({ to: 'Cf7940efc6517b0c084ad2ad496b45f30', messages: [{ type: 'text', text: txt2 }] }) })
            if (pr2.ok) { invDoc.notified = { [todayInv]: 1 }; await kvPut('sp_finance_pm_inv', invDoc, '低水位提醒') } // 只留今天鍵，一天一次
          }
        } else { invDoc.notified = { [todayInv]: 1 }; await kvPut('sp_finance_pm_inv', invDoc, '低水位檢查(無警報)') }
      }
    }
  } catch (e) { console.log('inv check err', e?.message) }
  if (!hit && !abHit && !force && !manual) return res.status(200).json({ ok: true, skipped: '非指定時間', taipei: hm })
  if (manual && !hit && !force && (nowM < toMin('11:00') || nowM >= toMin('19:30'))) {
    return res.status(200).json({ ok: true, skipped: '非營業時間（11:00-19:30 才有盤中數字）', taipei: hm })
  }
  // ── AB 即時＋參考店（獨立 try：AB 掛了不影響 GD，反之亦然）──
  const extra = {}
  if (abHit) {
    try { extra.ab = await syncEatsLive(kvGet, kvPut) } catch (e) { extra.ab = { error: e?.message || String(e) } }
    // 參考店 1/2 已退役（張良 2026-09-24：停抓＋刪設定與數據）
  }
  if (!hit && !force && !manual) { // 只有 AB 場次（GD 已打烊 19:30 後）：發廣播直接回
    await announceChanged()
    return res.status(200).json({ ok: true, taipei: hm, gd: 'GD時段外', ...extra })
  }
  try {
    const today = taipeiToday()
    const store = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
    const isGround = (n) => /groun/i.test(n || '')
    const cur = store.entries.find(e => e.date === today && isGround(e.store))
    if (cur && !cur.intraday) { await announceChanged(); return res.status(200).json({ ok: true, skipped: '今天已是打烊後正式資料，不覆蓋', taipei: hm, ...extra }) }
    // 手動更新冷卻 3 分鐘（端點公開，防連打狂敲喬亞）；排程時間點與金鑰不受限
    if (manual && !hit && !force && cur?.intraday && cur.fetchedAt && nowM >= toMin(cur.fetchedAt) && nowM - toMin(cur.fetchedAt) < 3) {
      return res.status(200).json({ ok: true, skipped: '剛更新過（' + cur.fetchedAt + '），3 分鐘內不重抓', taipei: hm, revenue: cur.revenue, txCount: cur.txCount, ...extra })
    }
    const cookie = await joyaLogin()
    const day = await joyaFetchDay(cookie, today)
    if (day.empty) { await announceChanged(); return res.status(200).json({ ok: true, skipped: '喬亞今天還沒有資料（未開店/公休）', taipei: hm, ...extra }) }
    const rec = joyaBuildRecord(day)
    rec.intraday = true
    rec.fetchedAt = hm
    rec.period = today + '（盤中更新 ' + hm + '）'
    rec.partial = '盤中更新（' + hm + '，未打烊）：數字之後還會變，打烊後自動換成最終值。' + (rec.partial || '')
    const { _details, ...summary } = rec
    // 摘要：整筆換掉今天的盤中記錄（上面擋過正式資料，這裡只會蓋到 intraday 或沒有）
    store.entries = [...store.entries.filter(e => !(e.date === today && isGround(e.store))), summary].sort((a, b) => (a.date < b.date ? -1 : 1))
    store.updatedAt = new Date().toISOString()
    await kvPut('sp_finance_pm_pos', store, '喬亞盤中更新 ' + hm)
    // 明細月檔：同樣只蓋今天的盤中明細（品項/時段下鑽跟著即時）
    const did = 'sp_finance_pm_pos_d_' + today.slice(0, 7)
    const doc = (await kvGet(did)) || { days: {} }
    doc.days[today + '::ground'] = { date: today, period: rec.period, store: rec.store, sheets: _details, intraday: true }
    doc.updatedAt = new Date().toISOString()
    await kvPut(did, doc, '喬亞盤中更新 ' + hm)
    // 快照（視窗外的手動更新不記，資料格線才乾淨；同格重複抓不重記）
    const slotHit = SLOTS.find(s => nowM >= toMin(s) && nowM < toMin(s) + WINDOW_MIN)
    if (slotHit) {
      // ① 15 分完整快照（含全品項累計）→ 每日檔（張良 2026-09-21：預做節奏＋之後版面切 15/30/60 分）
      //    喬亞實測不吃時分（帶時間回空白）→ 歷史回補不了，只能從部署日起收。
      const itemQ = {}
      for (const it of (day.items || [])) { const q = Math.round(Number(it.value_qvalue) || 0); if (q > 0) itemQ[it.name] = q }
      const qid = 'sp_finance_pm_pos_q_' + today
      const qdoc = (await kvGet(qid)) || { date: today, slots: [] }
      if (!qdoc.slots.some(s => s.t === slotHit)) {
        qdoc.slots.push({ t: slotHit, at: hm, rev: rec.revenue, tx: rec.txCount, items: itemQ })
        qdoc.updatedAt = new Date().toISOString()
        await kvPut(qid, qdoc, '喬亞15分快照 ' + slotHit)
      }
      // ② 整/半點 {t,rev,tx} → 月檔（既有半小時圖與 DD 的口徑不動、檔案不變肥）
      if (/:(00|30)$/.test(slotHit)) {
        const hid = 'sp_finance_pm_pos_hh_' + today.slice(0, 7)
        const hdoc = (await kvGet(hid)) || { days: {} }
        const arr = hdoc.days[today] = hdoc.days[today] || []
        if (!arr.some(s => s.t === slotHit)) {
          arr.push({ t: slotHit, at: hm, rev: rec.revenue, tx: rec.txCount })
          hdoc.updatedAt = new Date().toISOString()
          await kvPut(hid, hdoc, '喬亞半小時快照 ' + slotHit)
        }
      }
    }
    await announceChanged() // 開著的網頁即刻自動跟上
    return res.status(200).json({ ok: true, updated: true, taipei: hm, date: today, revenue: rec.revenue, txCount: rec.txCount, snap: slotHit || null, ...extra })
  } catch (e) {
    await announceChanged().catch(() => {}) // AB 那邊若有更新照樣廣播
    return res.status(200).json({ ok: false, error: e?.message || String(e), taipei: hm, ...extra })
  }
}
