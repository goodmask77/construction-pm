// 任務通知（v4.71.115 從 mail-sync ?tasknotify 抽出，文字與收件規則照抄；GD 舊任務頁與新殼任務頁（經代發口 task_notify）共用）
// tb：{kind:'assign'|'manual'|'review'|'approve'|'reject'|'ack', mode:'group'|'dm'|'none', gid?, title, due?, owner?, creator?, doer?, id?}；actorName＝操作者（呼叫端已驗身分）
import './_qpatch.js' // DD 推播統一補額度尾巴
import { kvGet } from './_onboard.js'
export async function taskNotify(tb, actorName) {
    const actor9 = actorName || '現場'
    const title9 = String(tb.title || '').slice(0, 80)
    if (!title9) return { ok: false, status: 400, error: '缺任務標題' }
    const tkL9 = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
    const bd9 = (await kvGet('sp_finance_pm_prep_bind')) || {}
    const uidByName9 = nm => { for (const [u9, tk9] of Object.entries(bd9.byUid || {})) { if (((bd9.tokens || {})[tk9] || {}).name === nm) return u9 } return null }
    const ridByName9 = nm => { const e9 = Object.values(bd9.tokens || {}).find(x => x.name === nm); return e9 ? (e9.rid || e9.uid) : null }
    const allIdsByName9 = nm => { const s = new Set(); for (const v of Object.values(bd9.tokens || {})) if (v && v.name === nm) { if (v.rid) s.add(v.rid); if (v.uid) s.add(v.uid) } return [...s] } // v4.54.4 同名所有身分id(桌面/手機各綁一組都中)=通知不漏任何一台
    const { prepLink, wpPush } = await import('./_webpush.js')
    const push9 = (to, text) => tkL9 ? fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkL9 }, body: JSON.stringify({ to, messages: [{ type: 'text', text }] }) }).catch(() => {}) : null
    let sent9 = 0
    const kind9 = String(tb.kind || 'assign'), mode9 = String(tb.mode || 'none')
    let grpTo9 = 'Cf7940efc6517b0c084ad2ad496b45f30'
    if (mode9 === 'group' && tb.gid) {
      const gidQ = String(tb.gid || '').replace(/[^A-Za-z0-9]/g, '')
      let okG9 = false; try { const { ddAll } = await import('./_ddmsg.js'); okG9 = (await ddAll()).groups.some(g => g.gid === gidQ) } catch (_) {}
      if (!okG9) return { ok: false, error: '這個群不在 DD 的群組清單裡，發不出去——重新整理再選一次' }
      grpTo9 = gidQ
    }
    const due9 = tb.due ? `\n截止：${String(tb.due).slice(0, 10)}` : ''
    // v4.41.6 深層連結（張良「通知跟訊息一樣定位 直接帶過去看那張卡片閃金光」）：帶任務 id → 連結直達該卡
    const tid9 = String(tb.id || '').replace(/[^A-Za-z0-9_-]/g, '')
    const lnk9 = prepLink(tid9 ? 'task=' + tid9 : '')
    const url9 = tid9 ? '/prep#task=' + tid9 : '/prep'
    if (kind9 === 'assign' && mode9 !== 'none') {
      const txt9 = `🛠 任務指派｜${title9}\n負責人：${tb.owner || '（未定）'}${due9}\n— ${actor9} 指派\n點開直達這張卡 👇\n${lnk9}`
      if (mode9 === 'group') { await push9(grpTo9, txt9); sent9++ }
      else if (mode9 === 'dm') {
        const u9 = uidByName9(String(tb.owner || ''))
        if (!u9) return { ok: false, error: `${tb.owner || '負責人'} 還沒綁定 GD，私訊不到——改發群組或請他先綁定` }
        await push9(u9, txt9); sent9++
      }
      const r9 = allIdsByName9(String(tb.owner || '')); if (r9.length) { try { await wpPush(r9, { title: '🛠 新任務指派', body: `${title9}（${actor9} 指派）`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'manual' && mode9 !== 'none') { // v4.41.4 卡片內🔔隨時補通知（張良「一開始不通知後來要通知」）：措辭=提醒不是指派
      const txtM = `🛠 任務提醒｜${title9}${tb.owner ? `\n負責人：${tb.owner}` : ''}${due9}\n— ${actor9} 提醒\n點開直達這張卡 👇\n${lnk9}`
      if (mode9 === 'group') { await push9(grpTo9, txtM); sent9++ }
      else if (mode9 === 'dm') {
        const uM = uidByName9(String(tb.owner || ''))
        if (!uM) return { ok: false, error: `${tb.owner || '負責人'} 還沒綁定 GD，私訊不到——改發群組或請他先綁定` }
        await push9(uM, txtM); sent9++
      }
      const rM = allIdsByName9(String(tb.owner || '')); if (rM.length) { try { await wpPush(rM, { title: '🛠 任務提醒', body: `${title9}（${actor9}）`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'review') { // 別人建立的任務按完成 → 固定私訊建立者審核（不吵群）
      const cu9 = uidByName9(String(tb.creator || ''))
      if (cu9) { await push9(cu9, `✅ ${actor9} 回報完成【${title9}】\n請到 GD 任務審核（通過＝封存）\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const cr9 = allIdsByName9(String(tb.creator || '')); if (cr9.length) { try { await wpPush(cr9, { title: '🛠 完成待審核', body: `${actor9}：${title9}`, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'approve' || kind9 === 'reject') { // 審核結果 → 私訊回報完成的人
      const du9 = uidByName9(String(tb.doer || ''))
      if (du9) { await push9(du9, kind9 === 'approve' ? `🎉 你完成的【${title9}】通過審核，已封存` : `↩️ 【${title9}】被退回，再處理一下（${actor9}）\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const dr9 = allIdsByName9(String(tb.doer || '')); if (dr9.length) { try { await wpPush(dr9, { title: kind9 === 'approve' ? '🎉 審核通過' : '↩️ 任務退回', body: title9, url: url9 }) } catch (_) {} }
    }
    if (kind9 === 'ack') { // v4.41.6 ✅ 確認收到（張良「對方看到按下去 即時私訊任務建立者」）：負責人按鈕 → 建立者私訊+推播
      const cu9 = uidByName9(String(tb.creator || ''))
      if (cu9) { await push9(cu9, `👌 ${actor9} 已確認收到任務【${title9}】${due9}\n點開直達這張卡 👇\n${lnk9}`); sent9++ }
      const cr9 = allIdsByName9(String(tb.creator || '')); if (cr9.length) { try { await wpPush(cr9, { title: '👌 任務已確認收到', body: `${actor9}：${title9}`, url: url9 }) } catch (_) {} }
    }
    return { ok: true, sent: sent9 }
}
