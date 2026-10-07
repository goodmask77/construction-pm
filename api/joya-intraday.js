// GROUN:D 盤中更新（張良 2026-08-27：喬亞後台是即時的，指定時間直接更新「今天」＋顯示更新時間）
// cron 每 15 分打一次（vercel.json，UTC 3-13 點＝台北 11:00-21:45），端點自己核對台北時間在不在名單內；
//   GD 快照格＝SLOTS（11:00-19:30 每 15 分自動生成），AB/1/2 只在整/半點跑——要改時間改 SLOTS 那行就好
// 寫入規則：只蓋「今天＋intraday 標記」的記錄，絕不動正式資料；打烊後 mail-sync syncJoya 會把
// intraday 記錄當缺日重抓成最終值（盤中數字不會凍住）。手動測試：?force=<MENU_PROBE_KEY>
import { joyaLogin, joyaFetchDay, joyaBuildRecord, taipeiToday } from './_joya.js'
import { kvGet, kvPut, announceChanged, invStatus } from './mail-sync.js'
import { wpPush, wpPushUids, prepLink } from './_webpush.js' // v4.33.0 Web Push＋LIFF連結（點通知/群組連結直接開GD帶身分）
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
  // ── GD SOP 超時提醒（v4.60.0 停用）：照 GROUND_SOP_CC_spec.md 第7節，取消「每項到期立即群組提醒（含逐項超時）」，
  //    改成每天台北 20:05 一則「收班彙整」（api/sop-summary.js + vercel.json cron）。站內狀態即時更新，群組只收彙整。
  // ── 📣 會議宣達未簽收追提醒（v4.16.0 張良：24h/48h/72h DD私訊、3次不理→大群點名；cron每15分隨機命中=時點不固定）──
  try {
    const meetDoc = await kvGet('sp_finance_pm_meet')
    const listM = (meetDoc && meetDoc.list) ? meetDoc.list.slice(0, 30) : []
    const tkM = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    if (tkM && listM.length) {
      const rosM = await kvGet('sp_crew_kb_roster')
      const pplM = ((rosM || {}).people) || []
      const bindM = (await kvGet('sp_finance_pm_prep_bind')) || {} // v4.31.0 張良：提醒要給「可以直接點的連結」→ 私訊帶本人專屬連結+#meet 直達該則

      const { logPush } = await import('./push.js')
      let dirtyM = false
      for (const it of listM) {
        if (!it.ackNames || !it.pubTs) continue
        const ageH = (Date.now() - it.pubTs) / 3600e3
        if (ageH < 24 || ageH > 14 * 24) continue
        const verM = it.ver || 1
        const missing = it.ackNames.filter(n => !(it.acks && it.acks[n] && it.acks[n].ver === verM))
        if (!missing.length) continue
        it.remind = it.remind || {}
        const stage = ageH >= 72 ? 3 : ageH >= 48 ? 2 : 1
        for (const nm of missing) {
          const r0 = it.remind[nm] || { n: 0 }
          if (r0.n >= stage) continue
          if (Math.random() > 0.25) continue // 隨機 tick 命中＝提醒時間不固定（張良習慣）
          const po = pplM.find(p2 => p2.name === nm && p2.lineUserId)
          if (po) {
            const pr = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkM }, body: JSON.stringify({ to: po.lineUserId, messages: [{ type: 'text', text: (() => { const tkP = ((bindM.byUid || {})[po.lineUserId]); const lnk = tkP ? `https://ground-pm.vercel.app/prep?me=${tkP}#meet=${it.id}` : prepLink('meet=' + it.id); return `📣 會議宣達還沒簽收（第 ${r0.n + 1} 次提醒）\n【${it.type}・${it.date}】\n點下面連結直達這則，看完按「✅ 確認熟知」，有問題按「❓ 我想發問」👇\n${lnk}` })() }] }) })
            if (pr.ok) { await logPush(po.lineUserId, 1, '宣達未簽提醒'); it.remind[nm] = { n: r0.n + 1, last: Date.now() }; dirtyM = true }
            try {
              const nPend = listM.filter(x => x.pubTs && (x.ackNames || []).includes(nm) && !((x.acks || {})[nm] && x.acks[nm].ver === (x.ver || 1))).length // 這個人全部未簽收數=圖示紅點(v4.33.2)
              await wpPushUids([po.lineUserId], { title: '📣 會議簽收提醒', body: `【${it.type}・${it.date}】還沒簽收，點開直達這則`, url: '/prep#meet=' + it.id, badge: nPend })
            } catch (_) {} // v4.33.0
          } else { it.remind[nm] = { n: stage, last: Date.now() }; dirtyM = true } // 沒LINE的直接記階段，等大群點名
        }
        const dead = missing.filter(nm => (it.remind[nm] || {}).n >= 3)
        if (dead.length && !it.remind.__grp && ageH >= 96) {
          const { ddGet, ddFill, ddGroupGid } = await import('./_ddmsg.js') // v4.54.0 走 DD 自動訊息設定(meet_nudge)：開關/群/文字
          const cfgMN = await ddGet('meet_nudge')
          if (cfgMN.on) {
            const gidMN = await ddGroupGid(cfgMN.group)
            const { groupMembers: _gm, quotaFoot: _qf } = await import('./push.js')
            const _mem = await _gm(gidMN)
            const pg = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkM }, body: JSON.stringify({ to: gidMN, messages: [{ type: 'text', text: ddFill(cfgMN.text, { type: it.type, date: it.date, names: dead.join('、'), link: prepLink('meet=' + it.id) }) + await _qf(_mem) }] }) })
            if (pg.ok) { it.remind.__grp = 1; dirtyM = true }
          }
        }
      }
      if (dirtyM) await kvPut('sp_finance_pm_meet', meetDoc, '宣達追提醒')
    }
  } catch (e) { console.log('meet remind err', e?.message) }
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
        const lines2 = []
        added.forEach(n => lines2.push(`🚫 ${n} 停售了（約 ${hm}）`))
        removed.forEach(n => lines2.push(`✅ ${n} 恢復販售（約 ${hm}）`))
        const listSo = `${lines2.join('\n')}\n目前停售中：${Object.keys(soDoc.current).length ? Object.keys(soDoc.current).join('、') : '無'}`
        const { ddGet, ddFill, ddGroupGid } = await import('./_ddmsg.js') // v4.54.0 DD自動訊息設定(soldoutAB)：群/文字（開關沿用上面 sp_finance_pm_notify 閘）
        const cfgSo = await ddGet('soldoutAB')
        const gidSo = await ddGroupGid(cfgSo.group)
        const tkSo = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
        if (tkSo && gidSo) { const { groupMembers: _gm, quotaFoot: _qf } = await import('./push.js'); const _mem = await _gm(gidSo); await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkSo }, body: JSON.stringify({ to: gidSo, messages: [{ type: 'text', text: ddFill(cfgSo.text, { list: listSo }) + await _qf(_mem) }] }) }) }
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
          const listS = `${alerts.slice(0, 15).join('\n')}${alerts.length > 15 ? `\n…共 ${alerts.length} 項` : ''}`
          const { ddGet, ddFill, ddGroupGid } = await import('./_ddmsg.js') // v4.54.0 DD自動訊息設定(staleItem)：群/文字（開關沿用上面 staleItem 閘）
          const cfgST = await ddGet('staleItem')
          const gidS = await ddGroupGid(cfgST.group)
          const txtS = ddFill(cfgST.text, { list: listS })
          const tkS = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
          if (tkS && gidS) { const { groupMembers: _gm, quotaFoot: _qf } = await import('./push.js'); const _mem = await _gm(gidS); await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkS }, body: JSON.stringify({ to: gidS, messages: [{ type: 'text', text: txtS + await _qf(_mem) }] }) }) }
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
          const listLS = lows.map(x => `・[${x._k}] ${x.name}：估剩 ${x.est}${x.unit || ''}（低標 ${x.min}）`).join('\n')
          const { ddGet, ddFill, ddGroupGid } = await import('./_ddmsg.js') // v4.54.0 走 DD 自動訊息設定(lowStock)：開關(相容舊 pm_notify.lowStock)/群/文字
          const cfgLS = await ddGet('lowStock')
          if (cfgLS.on) { // v4.33.0 LINE＋GD推播同開關、同一天一次標記
            const tk2 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
            let sent2 = false
            if (tk2) {
              const gidLS = await ddGroupGid(cfgLS.group)
              const { groupMembers: _gm, quotaFoot: _qf } = await import('./push.js')
              const _mem = await _gm(gidLS)
              const pr2 = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk2 }, body: JSON.stringify({ to: gidLS, messages: [{ type: 'text', text: ddFill(cfgLS.text, { list: listLS }) + await _qf(_mem) }] }) })
              if (pr2.ok) sent2 = true
            }
            try { if (await wpPush(null, { title: '📉 庫存低水位', body: lows.map(x => x.name).join('、'), url: '/prep' })) sent2 = true } catch (_) {}
            if (sent2) { invDoc.notified = { [todayInv]: 1 }; await kvPut('sp_finance_pm_inv', invDoc, '低水位提醒') } // 只留今天鍵，一天一次
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
    try {
      const abLive = await syncEatsLive(kvGet, kvPut)
      extra.ab = abLive
      // v4.67.0 AB即時化（張良 2026-10-08 轉給CC①：AB 跟 GD 一樣盤中更新）：把 AB 即時營收寫進 pos entries(intraday=true)，
      // 看板才看得到「營業中」今日營收；打烊後日結信會自動覆蓋（ingestPosRecords 已處理盤中覆蓋）。
      if (abLive && abLive.revenue != null) {
        const abToday = taipeiToday()
        const live = (await kvGet('sp_finance_pm_ablive')) || {}
        const posAB = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
        const isAB = (n) => /beach/i.test(n || '')
        const curAB = posAB.entries.find(e => e.date === abToday && isAB(e.store))
        if (!(curAB && !curAB.intraday)) { // 已有打烊正式值就不覆蓋
          const abRec = { id: 'pos-' + abToday.replace(/-/g, '') + 'eats-abeach', date: abToday, period: abToday + '（Eats365 盤中更新 ' + hm + '）', store: 'A Beach 101&Pizza', subject: 'A Beach Eats365 盤中即時', revenue: Math.round(Number(abLive.revenue) || 0), txCount: Number(abLive.tx) || 0, dineTx: (live.dineIn || {}).tx || 0, takeTx: (live.takeout || {}).tx || 0, intraday: true, fetchedAt: hm, partial: '盤中更新（' + hm + '，未打烊）：數字之後還會變，打烊後自動換成最終值。' }
          // 清掉 AB 自己的舊盤中筆（含今天這筆要換新），正式筆與 GD 全不動
          posAB.entries = [...posAB.entries.filter(e => !(isAB(e.store) && e.intraday && e.date <= abToday)), abRec].sort((a, b) => (a.date < b.date ? -1 : 1))
          posAB.updatedAt = new Date().toISOString()
          await kvPut('sp_finance_pm_pos', posAB, 'Eats365 盤中更新 ' + hm)
        }
      }
    } catch (e) { extra.ab = { error: e?.message || String(e) } }
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
