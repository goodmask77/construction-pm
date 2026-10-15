// 收件匣操作分派（v4.71.120 從 mail-sync ?inbox 抽出；GD 舊頁與新殼（經代發口 inbox_op）共用同一份，內容照搬）
// 呼叫端負責驗身分（who：name／rid／role）；主管資格、可見帳號、名單在這裡依 GD 資料算（同原本）；回傳物件，status 欄＝HTTP 狀態（沒有＝200）
// 存檔依資料歸屬走 GD 或新殼（_inbox.js ibKv）；整段以操作者姓名執行（新殼命令橋與驗收閘門看得到是誰）
import * as IB from './_inbox.js'
import { kvGet } from './_onboard.js'
export async function inboxDispatch({ method, op: opI, q = {}, body: bodyI = {}, who: whoI, origin: originI }) {
  const [defI, pmI, rosI, hrI] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_prep_perm'), kvGet('sp_crew_kb_roster'), kvGet('sp_crew_pm_hr_master')])
    const aprI = (((defI || {}).ground || {}).approvers || ['張良瑋'])
    const mgrI = IB.isMgr(whoI, aprI, pmI)
    const cfgI = await IB.loadCfg()
    // 名單依 AB／GD × 正職／PT 分組（張良 10-11）：店別與職別來自人資名冊 sp_crew_pm_hr_master（co 含 A Beach＝AB、GD；title 正職／PT），在職名單仍以 kb_roster 為準
    const aliveI = ((rosI || {}).people || []).filter(p => p && p.name && !p.endDate && (p.status || '在職') !== '離職')
    const hrRows = ((hrI || {}).rows || [])
    const peopleI = aliveI.map(p => { const h = hrRows.find(r => r && r.name === p.name && !r.resign && !r.leave) || hrRows.find(r => r && r.name === p.name) || {}; const co = /A ?Beach|AB/i.test(h.co || '') ? 'AB' : /GD|GROUN/i.test(h.co || '') ? 'GD' : ''; const title = /PT|兼職/i.test(h.title || p.gdRole || '') ? 'PT' : (h.title ? '正職' : ''); return { name: p.name, co, title } })
  return IB.ibAs(whoI.name, async () => {
      const accountsI = IB.ACCOUNTS.filter(a => IB.canSeeAcct(cfgI, whoI, mgrI, a.key)).map(a => ({ key: a.key, name: a.name, color: a.color, configured: IB.configured(a), canReply: IB.canReplyAcct(cfgI, whoI, mgrI, a.key) }))
      if (method !== 'POST') {
        if (opI === 'list') return ({ ok: true, ver: IB.INBOX_VER, me: { rid: whoI.rid || whoI.uid, name: whoI.name, mgr: mgrI }, cats: cfgI.cats, accounts: accountsI, convs: await IB.listConvs({ who: whoI, mgr: mgrI, cfg: cfgI, acct: String(q.acct || '') || null }), templates: cfgI.templates || [], people: peopleI.map(p => p.name), peopleInfo: peopleI })
        if (opI === 'conv') return (await IB.getConv({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(q.id || ''), markRead: String(q.read || '') === '1' }))
        if (opI === 'settings') { if (!mgrI) return ({ status: 403, ok: false, error: '只有主管能看設定' }); return ({ ...(await IB.settings({ origin: originI })), people: peopleI.map(p => p.name), peopleInfo: peopleI }) }
        return ({ status: 400, ok: false, error: '不認識的操作' })
      }
      if (['send', 'sendfile', 'connect'].includes(opI)) { const g = await IB.ibGate(); if (g) return ({ status: 409, ok: false, error: g, code: 'smoke' }) } // v4.71.122 對外動作前先問切換驗收閘門（關卡 3 inbox 第一輪 A5）
      if (opI === 'send') return await IB.ibSendOnce(bodyI.cid, () => IB.sendOut({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(bodyI.id || ''), text: bodyI.text })) // cid＝頁面每次按送出產生：同一次只送一次
      if (opI === 'sendfile') return await IB.ibSendOnce(bodyI.cid, () => IB.sendMedia({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(bodyI.id || ''), dataUrl: bodyI.dataUrl, name: bodyI.name }))
      if (opI === 'ai') return (await IB.inboxAi({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(bodyI.id || ''), q: bodyI.q, hist: bodyI.hist })) // v4.71.11 收件匣問 AI
      if (opI === 'import') return (await IB.importChat({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(bodyI.id || ''), csv: bodyI.csv, dry: !!bodyI.dry })) // v4.71.20 匯入舊帳號聊天記錄 CSV
      if (opI === 'cust') return (await IB.inboxCust({ who: whoI, mgr: mgrI, cfg: cfgI, id: String(bodyI.id || '') })) // v4.71.12 客戶資料側欄
      if (['status', 'assign', 'note', 'rename', 'star', 'wait', 'memo', 'memodel', 'cat', 'custset', 'bkset'].includes(opI)) return (await IB.convOp({ who: whoI, mgr: mgrI, cfg: cfgI, op: opI, id: String(bodyI.id || ''), value: bodyI.value }))
      if (opI === 'cfg') { if (!mgrI) return ({ status: 403, ok: false, error: '只有主管能改設定' }); return (await IB.saveCfg(bodyI.cfg || {}, whoI)) }
      if (opI === 'connect') { if (!mgrI) return ({ status: 403, ok: false, error: '只有主管能接帳號' }); return (await IB.connectAcct({ key: String(bodyI.acct || ''), origin: originI, force: !!bodyI.force })) }
      return ({ status: 400, ok: false, error: '不認識的操作' })
  })
}
