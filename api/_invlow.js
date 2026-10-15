// 盤點/包材低水位提醒（GD joya-intraday 11:00 場次，張良 2026-09-21；v4.71.88 從 joya-intraday 原樣拆出，依賴全部由呼叫端傳入＝可用替身測試）
// 回 { ran:false, reason } 或 { ran:true, reason:'sent'|'none'|'already'|'claimed-elsewhere'|'send-failed'|'off' }
export async function gdInvLow ({ now, hm, owner, kvGet, invStatus, invMark, ddGet, sendLine, sendPush }) {
  const tpe2 = new Date(now.getTime() + 8 * 3600e3)
  const wd2 = tpe2.getUTCDay(), todayInv = tpe2.toISOString().slice(0, 10)
  if (!(wd2 >= 1 && wd2 <= 5)) return { ran: false, reason: 'weekend' }
  if (!(hm >= '11:00' && hm < '11:20')) return { ran: false, reason: 'not-window' }
  if ((await owner()) !== 'gd') return { ran: false, reason: 'moved' } // abgd 搬家（F05）：盤點切新殼後低水位提醒改新殼排程 /api/ops/cron/inv-low
  const invDoc = (await kvGet('sp_finance_pm_inv')) || {}
  if ((invDoc.notified || {})[todayInv]) return { ran: true, reason: 'already', day: todayInv } // 今天已處理（含新殼反推回來的標記）→ 不另發
  const [f2, p2] = await Promise.all([invStatus('food'), invStatus('pack')])
  const lows = [...f2.items.filter(x => x.low).map(x => ({ ...x, _k: '食材' })), ...p2.items.filter(x => x.low).map(x => ({ ...x, _k: '包材' }))]
  if (!lows.length) { await invMark(todayInv, '低水位檢查(無警報)'); return { ran: true, reason: 'none', day: todayInv } }
  const listLS = lows.map(x => `・[${x._k}] ${x.name}：估剩 ${x.est}${x.unit || ''}（低標 ${x.min}）`).join('\n')
  const cfgLS = await ddGet('lowStock')
  if (!cfgLS.on) return { ran: true, reason: 'off' }
  if ((await invMark(todayInv, '低水位提醒(認領)')) !== 'ok') return { ran: true, reason: 'claimed-elsewhere', day: todayInv } // 先認領再發（沒認領到＝別的場次已處理）
  let sent2 = false
  try { if (await sendLine(listLS)) sent2 = true } catch (_) {}
  try { if (await sendPush(lows.map(x => x.name).join('、'))) sent2 = true } catch (_) {}
  if (!sent2) { await invMark(todayInv, '低水位提醒(發送失敗收回)', false); return { ran: true, reason: 'send-failed', day: todayInv } } // 都沒送出＝收回認領，下一場次重試
  return { ran: true, reason: 'sent', day: todayInv, n: lows.length }
}
