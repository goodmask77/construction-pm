// 積分／排行榜／兌換分派（v4.71.136 從 mail-sync ?lb ?pointscfg ?rewardset ?redeem ?redeemlog ?ledger 抽出；GD 舊頁與新殼（經代發口 points_read／points_op）共用同一份，內容照搬）
// 呼叫端負責驗身分：who（sopWho；讀取可為 null）、canEdit（permWho(token,'lb') 有過＝true；寫入一律要）；回傳物件，status 欄＝HTTP 狀態（沒有＝200）
// 積分四份文件依資料歸屬讀寫（_points.js ptsTx／ptsRead，版本比對）；其他資料（SOP 問題、任務、名冊、SOP 設定、綁定）照舊讀 GD（搬走的域由同步鏡像）
import crypto from 'node:crypto'
import { kvGet, SB_URL, SB_KEY } from './_onboard.js'
import { FACETS, pointsRules, computePointsBoard, pointsCas, ptsTx, ptsRead, PTS_KEYS } from './_points.js'
export const REWARDS_SEED = [
  { id: 'rw_drink', name: '指定飲料一杯', cost: 30, stock: null, desc: '上班日任選一杯', off: false, ord: 1 },
  { id: 'rw_meal', name: '員工餐招待', cost: 60, stock: null, desc: '招待一份員工餐', off: false, ord: 2 },
  { id: 'rw_early', name: '提早 30 分下班', cost: 120, stock: null, desc: '需當班主管同意時段', off: false, ord: 3 },
  { id: 'rw_off', name: '指定一天排休', cost: 200, stock: null, desc: '排班前提出、不卡關鍵日', off: false, ord: 4 },
  { id: 'rw_bonus', name: '加碼獎金 $500', cost: 300, stock: null, desc: '隨當月薪資發放', off: false, ord: 5 },
]
const gdNames = (rosterDoc) => {
  const alive = (((rosterDoc || {}).people) || []).filter(p2 => !p2.endDate && (p2.status || '在職') !== '離職')
  const gd = alive.filter(p2 => p2.gd).map(p2 => p2.name).filter(Boolean)
  return gd.length ? gd : alive.map(p2 => p2.name).filter(Boolean)
}
const aprOf = (def) => (((def || {}).ground || {}).approvers || ['張良瑋'])
const isAdmOf = (who, def) => !!(who && (who.role === '主管' || aprOf(def).includes(who.name)))
const genCodeFrom = (used) => { const AB = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679'; let c; do { c = ''; for (let i = 0; i < 6; i++) c += AB[Math.floor(Math.random() * AB.length)] } while (used.has(c)); used.add(c); return c }
const balOf = (nm, ptsDoc) => { let b = Number(((ptsDoc || {}).carry || {})[nm] || 0); for (const e of ((ptsDoc || {}).list || [])) if (e.person === nm) b += Number(e.pts || 0); return Math.round(b * 10) / 10 }
const twDate = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const twHm = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16)
const twNowR = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')
const clone = (x) => JSON.parse(JSON.stringify(x))
// 兌換單上限 2000：只裁已結案（不通過／已核銷／已給），待審、核准中、可用券一律保留（關卡 3 積分第一輪 OpenAI A5）
const OPEN_RD = new Set(['pending', 'approving', 'approved'])
const RD_CLOSED = 1e9 // 兌換關卡（流水帳 rdGate[兌換單]＝最新世代）關閉值：退回後任何世代都扣不到點
const trimRedeem = (list) => { if (list.length <= 2000) return list; let room = 2000 - list.filter(x => OPEN_RD.has(x.status)).length; return list.filter(x => OPEN_RD.has(x.status) || (room-- > 0)) }
// 通知小工具（鈴鐺＋LINE；同原本）：一律在資料都存好之後才呼叫
async function notify(names, title, body) { try {
  const bindN = (await kvGet('sp_finance_pm_prep_bind')) || {}
  const nm2 = {}; for (const v of Object.values(bindN.tokens || {})) if (v && v.name) nm2[v.name] = { uid: v.uid, rid: v.rid || v.uid }
  const rids = [...new Set(names.map(n => nm2[n] && nm2[n].rid).filter(Boolean))]
  if (rids.length) { const { wpPush } = await import('./_webpush.js'); await wpPush(rids, { title, body, url: '/prep#lb', cat: 'reward' }) }
  const tkN = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()
  if (tkN) for (const n of names) { const u = nm2[n] && nm2[n].uid; if (u) { await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tkN }, body: JSON.stringify({ to: u, messages: [{ type: 'text', text: title + '\n' + body + '\nhttps://ground-pm.vercel.app/prep#lb' }] }) }).catch(() => {}); try { const { logPush } = await import('./push.js'); await logPush({ to: u, n: 1, src: 'reward' }) } catch (_) {} } }
} catch (_) {} }

export async function pointsDispatch({ kind, method, q = {}, body = {}, who, canEdit = false }) {
  const op = (who && who.name) || '積分'
  if ((kind === 'rewardset' || kind === 'redeem') && method !== 'POST') return { status: 405, ok: false, error: '要用 POST' } // 寫入一律 POST（關卡 3 積分第一輪 OpenAI A1）
  // ── 🏆 排行榜（讀；順手補基礎獎勵種子、補發舊券核銷碼）──
  if (kind === 'lb') {
    const [issDoc, rosterL, catsDoc, taskRows, defL, P] = await Promise.all([
      kvGet('sp_finance_pm_sop_issues'), kvGet('sp_crew_kb_roster'), kvGet('sp_team_pm_data'),
      fetch(`${SB_URL}/rest/v1/pm_documents?id=like.sp_team_pm_task_*&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
      kvGet('sp_finance_pm_sop_def'), ptsRead([PTS_KEYS.points, PTS_KEYS.cfg, PTS_KEYS.rewards, PTS_KEYS.redeem], op)])
    const namesL = gdNames(rosterL)
    const ptsDoc = P[PTS_KEYS.points] || { list: [], carry: {} }
    const { rank, stars5, taskBreak, balance, month: monthP, list } = computePointsBoard({ issDoc, catsDoc, taskRows, ptsDoc, names: namesL })
    const isAdmL = isAdmOf(who, defL)
    let rwDoc = P[PTS_KEYS.rewards]
    if (!rwDoc || !(rwDoc.list || []).length) rwDoc = await ptsTx(PTS_KEYS.rewards, (cur) => (cur && (cur.list || []).length) ? { write: false, value: cur } : { write: true, doc: { list: clone(REWARDS_SEED) }, value: { list: clone(REWARDS_SEED) } }, '基礎獎勵種子', op)
    let rdDoc = P[PTS_KEYS.redeem] || { list: [] }
    if ((rdDoc.list || []).some(r => r.status === 'approved' && !r.code)) { // 🎟 補發核銷碼（v4.57 前通過的可用券沒碼）：重讀最新再補
      rdDoc = await ptsTx(PTS_KEYS.redeem, (cur) => { const d = cur || { list: [] }; const used = new Set((d.list || []).filter(x => x.code).map(x => x.code)); let chg = false; for (const r of (d.list || [])) if (r.status === 'approved' && !r.code) { r.code = genCodeFrom(used); chg = true } return chg ? { write: true, doc: d, value: d } : { write: false, value: d } }, '補發核銷碼(舊券)', op)
    }
    const meNameL = who ? who.name : null
    const myRedeems = meNameL ? (rdDoc.list || []).filter(r => r.person === meNameL).slice(0, 40) : []
    const pendingRedeems = isAdmL ? (rdDoc.list || []).filter(r => r.status === 'pending' || r.status === 'approving') : null // 核准中（上次沒做完）也列出來，再按一次核准會冪等做完
    const checkersL = (((defL || {}).ground || {}).checkers) || []
    const isCheckerL = !!(who && (isAdmL || checkersL.includes(who.name)))
    const checkinQueue = isCheckerL ? (rdDoc.list || []).filter(r => r.status === 'approved' && r.code).map(r => ({ id: r.id, code: r.code, person: r.person, rewardName: r.rewardName, ts: r.decTs || r.ts })) : null
    let myLedger = []
    if (meNameL) { let run = Number((ptsDoc.carry || {})[meNameL] || 0); const withBal = (ptsDoc.list || []).filter(e => e.person === meNameL).map(e => { run += Number(e.pts || 0); return { date: e.date, ts: e.ts, act: e.act, type: e.type, pts: e.pts, bal: Math.round(run * 10) / 10, note: e.note || '', by: e.by || '' } }); myLedger = withBal.slice(-120).reverse() }
    return { ok: true, me: who ? { name: who.name, role: who.role, approver: isAdmL } : null, facets: FACETS, rank, stars5, issues: list, issueCats: ((issDoc || {}).cats && issDoc.cats.length) ? issDoc.cats : ['App問題', '現場流程', '物料', '工作站系統', '客人問題'], names: namesL, month: monthP, ptsRules: pointsRules(P[PTS_KEYS.cfg]), isAdmin: isAdmL, rewards: rwDoc.list, myBalance: Math.round((balance[meNameL] || 0) * 10) / 10, myRedeems, pendingRedeems, myLedger, taskBreak, isChecker: isCheckerL, checkinQueue, checkers: isAdmL ? checkersL : null }
  }
  // ── 🏦 積分規則表：GET 規則＋近期流水；POST set／del／adjust ──
  if (kind === 'cfg') {
    const defP = await kvGet('sp_finance_pm_sop_def')
    if (method !== 'POST') { const P = await ptsRead([PTS_KEYS.cfg, PTS_KEYS.points], op); const ledg = (P[PTS_KEYS.points] || {}).list || []; return { ok: true, rules: pointsRules(P[PTS_KEYS.cfg]), custom: (P[PTS_KEYS.cfg] || {}).behavior || {}, recent: isAdmOf(who, defP) ? ledg.slice(-80).reverse() : [], isAdmin: isAdmOf(who, defP) } }
    if (!who || !canEdit) return { status: 403, ok: false, error: 'NOPERM' }
    if (!isAdmOf(who, defP)) return { status: 403, ok: false, error: '只有管理者/主管能改積分規則' }
    if (body.op === 'set' || body.op === 'del') {
      const act = body.op === 'set' ? String(body.act || '').trim().replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) : String(body.act || '')
      if (body.op === 'set' && !act) return { status: 400, ok: false, error: '動作代碼只能用英數底線' }
      const cfg = await ptsTx(PTS_KEYS.cfg, (cur) => { const c = cur || { behavior: {} }; c.behavior = c.behavior || {}
        if (body.op === 'set') { const cu = c.behavior[act] || {}; c.behavior[act] = { ...cu, ...(body.label != null ? { label: String(body.label).slice(0, 20) } : {}), ...(body.pts != null ? { pts: Math.max(0, Math.round(Number(body.pts) || 0)) } : {}), ...(body.cap != null ? { cap: Math.max(0, Math.round(Number(body.cap) || 0)) } : {}), ...(body.off != null ? { off: !!body.off } : {}) } }
        else delete c.behavior[act]
        return { write: true, doc: c, value: c } }, '積分規則(' + who.name + ' ' + body.op + (body.op === 'set' ? ' ' + act : '') + ')', op)
      return { ok: true, rules: pointsRules(cfg) }
    }
    if (body.op === 'adjust') { // 管理者抽查加/扣分（原子寫入；同一次操作編號不重複加扣）
      const person = String(body.person || '').trim().slice(0, 20); const pts = Math.round(Number(body.pts) || 0)
      if (!person || !pts) return { status: 400, ok: false, error: '要選人＋填加扣分數' }
      const ref = body.cid ? 'adj:' + String(body.cid).slice(0, 60) : ''
      try { await pointsCas(doc => { doc.list = doc.list || []; if (ref && doc.list.some(e => e.act === 'adjust' && e.ref === ref)) return { write: false, value: 'dup' }; doc.list.push({ id: 'pt' + Date.now().toString(36) + '_adj', person, date: twDate(), ts: twHm(), type: 'adjust', act: 'adjust', pts, ref, by: who.name, note: String(body.note || '').slice(0, 60) }); return { write: true, value: 'ok' } }, '積分加扣(' + who.name + '→' + person + ' ' + pts + ')', op) }
      catch (e) { return { status: 503, ok: false, error: '積分存檔失敗，請再按一次：' + String(e && e.message || e).slice(0, 80) } }
      const P = await ptsRead([PTS_KEYS.cfg], op); return { ok: true, rules: pointsRules(P[PTS_KEYS.cfg]) }
    }
    return { status: 400, ok: false }
  }
  // ── 🎁 獎勵主檔管理（管理者）──
  if (kind === 'rewardset') {
    if (!who || !canEdit) return { status: 403, ok: false, error: 'NOPERM' }
    const defW = await kvGet('sp_finance_pm_sop_def'); if (!isAdmOf(who, defW)) return { status: 403, ok: false, error: '只有管理者/主管能改獎勵' }
    if (body.op === 'set') { const nm = String(body.name || '').trim().slice(0, 30); const cost = Math.max(1, Math.round(Number(body.cost) || 0)); if (!nm || !cost) return { status: 400, ok: false, error: '名稱和點數要填' } }
    else if (body.op !== 'del') return { status: 400, ok: false }
    const newId = 'rw' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') // 加亂數：同一毫秒兩人新增不撞號（v4.71.136 實測抓到）
    const doc = await ptsTx(PTS_KEYS.rewards, (cur) => { const d = cur || { list: [] }; d.list = d.list || []
      if (body.op === 'set') {
        const nm = String(body.name || '').trim().slice(0, 30); const cost = Math.max(1, Math.round(Number(body.cost) || 0))
        const stock = (body.stock === '' || body.stock == null) ? null : Math.max(0, Math.round(Number(body.stock)))
        const it = body.id ? d.list.find(x => x.id === body.id) : null
        if (it) { it.name = nm; it.cost = cost; it.stock = stock; it.desc = String(body.desc || '').slice(0, 80); if (body.off != null) it.off = !!body.off; if (body.ord != null) it.ord = Number(body.ord) || 0 }
        else d.list.push({ id: newId, name: nm, cost, stock, desc: String(body.desc || '').slice(0, 80), off: !!body.off, ord: (d.list.length + 1) })
      } else d.list = d.list.filter(x => x.id !== body.id)
      return { write: true, doc: d, value: d } }, '獎勵設定(' + who.name + ')', op)
    return { ok: true, rewards: doc.list }
  }
  // ── 🎁 兌換：request／checkin／setcheckers／decide／done ──
  if (kind === 'redeem') {
    if (!who || !canEdit) return { status: 403, ok: false, error: 'NOPERM' }
    const defR = await kvGet('sp_finance_pm_sop_def'); const aprR = aprOf(defR); const isAdmR = isAdmOf(who, defR)
    const checkersR = [...new Set([...aprR, ...((((defR || {}).ground || {}).checkers) || [])])]
    const isCheckerR = isAdmR || checkersR.includes(who.name)
    const nowR = twNowR()
    if (body.op === 'request') {
      const rid0 = body.cid ? 'rd' + crypto.createHash('sha256').update(who.name + '|' + String(body.cid)).digest('hex').slice(0, 20) : null
      if (rid0) { const ex0 = (((await ptsRead([PTS_KEYS.redeem], op))[PTS_KEYS.redeem] || {}).list || []).find(x => x.id === rid0); if (ex0 && ex0.person === who.name) return { ok: true, item: ex0 } } // 同一次申請重送：先回原單，不再檢查庫存與餘額（關卡 3 積分第二輪 A4）
      const P = await ptsRead([PTS_KEYS.rewards, PTS_KEYS.points], op)
      const rw = ((P[PTS_KEYS.rewards] || {}).list || []).find(x => x.id === body.rewardId && !x.off)
      if (!rw) return { status: 404, ok: false, error: '找不到這個獎勵' }
      if (rw.stock != null && rw.stock <= 0) return { status: 400, ok: false, error: '這個獎勵庫存沒了' }
      const bal = balOf(who.name, P[PTS_KEYS.points]); if (bal < rw.cost) return { status: 400, ok: false, error: `點數不夠（你有 ${bal}、需要 ${rw.cost}）` }
      const rid = rid0 || ('rd' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex')) // 同一個人同一次申請（cid）重送＝同一張；編號綁申請人（關卡 3 積分第一輪 OpenAI A4）（cid）重送不重建
      const it = { id: rid, person: who.name, rewardId: rw.id, rewardName: rw.name, cost: rw.cost, ts: nowR, status: 'pending' }
      const got = await ptsTx(PTS_KEYS.redeem, (cur) => { const d = cur || { list: [] }; d.list = d.list || []; const ex = d.list.find(x => x.id === rid); if (ex) return { write: false, value: { made: false, item: ex } }; d.list = trimRedeem([it, ...d.list]); return { write: true, doc: d, value: { made: true, item: it } } }, '兌換申請(' + who.name + '→' + rw.name + ')', op)
      if (got.item.person !== who.name) return { status: 409, ok: false, error: '申請編號衝突，請重新整理再試' }
      if (got.made) await notify(aprR, '🎁 有人要兌換獎勵', `${who.name} 想換「${rw.name}」（${rw.cost} 點），到排行榜審核`)
      return { ok: true, item: got.item }
    }
    if (body.op === 'checkin') {
      if (!isCheckerR) return { status: 403, ok: false, error: '你不是授權核銷人，不能核銷' }
      const code = String(body.code || '').trim().toUpperCase(); let err = null, hit = null
      await ptsTx(PTS_KEYS.redeem, (cur) => { err = null; hit = null; const d = cur || { list: [] }; d.list = d.list || []
        const vit = body.id ? d.list.find(x => x.id === body.id) : (code ? d.list.find(x => x.code && x.code === code) : null)
        if (!vit) { err = { status: 404, ok: false, error: '找不到這張券（核銷碼可能錯了）' }; return { write: false } }
        if (vit.status === 'used') { err = { status: 400, ok: false, error: `這張已經核銷過了（${vit.usedBy || '?'}・${vit.usedAt || ''}）` }; return { write: false } }
        if (vit.status !== 'approved') { err = { status: 400, ok: false, error: '這張不是可用券（可能還沒通過審核）' }; return { write: false } }
        vit.status = 'used'; vit.usedBy = who.name; vit.usedAt = nowR; hit = { ...vit }; return { write: true, doc: d } }, '兌換核銷(' + who.name + ')', op)
      if (err) return err
      await notify([hit.person], '🎟 券已核銷', `你的「${hit.rewardName}」已由 ${who.name} 核銷（${nowR}）`)
      return { ok: true, item: { id: hit.id, person: hit.person, rewardName: hit.rewardName, usedBy: hit.usedBy, usedAt: hit.usedAt } }
    }
    if (body.op === 'setcheckers') return { status: 400, ok: false, error: 'setcheckers 由呼叫端處理（寫 SOP 設定）' }
    if (!isAdmR) return { status: 403, ok: false, error: '只有管理者/主管能審核兌換' }
    const id = String(body.id || '')
    if (body.op === 'decide') {
      const note = body.note ? String(body.note).slice(0, 80) : ''
      if (!body.pass) {
        // 退回（關卡 3 積分第七輪）：① 先看是不是待審 ② 流水帳同一交易：若已有這張單的扣點（過期執行者殘留）就退點一次＋把這張單的兌換關卡關閉（之後任何世代都扣不到點）
        //   ③ 成功才標不通過 ④ 通知。② 失敗＝回「再按一次」（仍是待審，重按會重做，退點以 ref 去重）
        const cur0 = ((await ptsRead([PTS_KEYS.redeem], op))[PTS_KEYS.redeem] || {}).list || []; const it0 = cur0.find(x => x.id === id)
        if (!it0) return { status: 404, ok: false }
        if (it0.status !== 'pending') return { status: 400, ok: false, error: '這筆已經處理過了' }
        let refunded = false
        try { await pointsCas(ptsDoc => { ptsDoc.list = ptsDoc.list || []; ptsDoc.rdGate = ptsDoc.rdGate || {}; let w = false
          const ded = ptsDoc.list.find(e => e.act === 'redeem' && e.ref === id)
          if (ded && !ptsDoc.list.some(e => e.act === 'redeem_refund' && e.ref === id)) { ptsDoc.list.push({ id: 'pt' + Date.now().toString(36) + '_rf', person: ded.person, date: twDate(), ts: twHm(), type: 'redeem', act: 'redeem_refund', pts: Math.abs(Number(ded.pts) || 0), ref: id, by: who.name, note: '兌換未通過退點' }); refunded = true; w = true }
          if (ptsDoc.rdGate[id] !== RD_CLOSED) { ptsDoc.rdGate[id] = RD_CLOSED; w = true }
          return { write: w, value: 'ok' } }, '兌換退回關卡(' + id + ')', op) }
        catch (e) { return { status: 503, ok: false, error: '退回沒存進去，請再按一次：' + String(e && e.message || e).slice(0, 60) } }
        let err = null, it = null
        await ptsTx(PTS_KEYS.redeem, (cur) => { err = null; const d = cur || { list: [] }; it = (d.list || []).find(x => x.id === id); if (!it) { err = { status: 404, ok: false }; return { write: false } } if (it.status === 'rejected') return { write: false }; if (it.status !== 'pending') { err = { status: 400, ok: false, error: '這筆已經處理過了' }; return { write: false } } it.status = 'rejected'; it.decBy = who.name; it.decTs = nowR; if (note) it.note = note; return { write: true, doc: d } }, '兌換審核(' + who.name + ' 不通過)', op)
        if (err) return err
        await notify([it.person], '❌ 兌換未通過', `你換的「${it.rewardName}」未通過${note ? '（' + note.slice(0, 40) + '）' : ''}，${refunded ? '已退回扣掉的點數' : '點數沒扣'}`)
        return { ok: true }
      }
      // 核准（v4.71.136 可安全重做的順序；跨三份文件不是同一交易，每一步都冪等）：
      //   ① 兌換單 pending→approving（認領；別人不能再審或退回）② 預留庫存（同兌換單只扣一次，記在獎勵 stockIds；缺貨＝退回 pending）
      //   ③ 扣點（同兌換單 ref 只扣一次；不足＝放回庫存、退回 pending）④ approving→approved＋核銷碼 ⑤ 都存好才通知
      //   中途失敗：兌換單停在 approving，再按一次核准會從頭冪等做完
      //   執行權（關卡 3 積分第二輪 A2）：認領時記 runId＋runAt，10 分鐘內只有持有者能往下做；超過 10 分鐘（上一個執行中斷）才能接手。補償（放回庫存＋退回待審）與完成都要持有執行權
      const runId = crypto.randomUUID(); const LEASE = 10 * 60e3 // 10 分鐘＞GD 函式最長執行時間（vercel.json 沒另設＝平台預設 300 秒，到時強制結束）：過期時舊執行者一定已經不在（關卡 3 積分第三輪 A2）
      let err = null, it = null, myGen = 0
      await ptsTx(PTS_KEYS.redeem, (cur) => { err = null; const d = cur || { list: [] }; it = (d.list || []).find(x => x.id === id); if (!it) { err = { status: 404, ok: false }; return { write: false } }
        if (it.status === 'approving' && it.runId && Date.now() - Date.parse(it.runAt || 0) < LEASE) { err = { status: 409, ok: false, error: '這筆正在核准中（' + (it.decBy || '') + '），請稍候再看' }; return { write: false } }
        if (it.status !== 'pending' && it.status !== 'approving') { err = { status: 400, ok: false, error: '這筆已經處理過了' }; return { write: false } }
        myGen = (Number(it.runGen) || 0) + 1; it.runGen = myGen // 執行世代：每次認領／接手 +1（在兌換單的版本比對交易內，單調遞增）
        it.status = 'approving'; it.decBy = who.name; it.decTs = nowR; it.runId = runId; it.runAt = new Date().toISOString(); if (note) it.note = note; return { write: true, doc: d } }, '兌換核准中(' + who.name + ')', op)
      if (err) return err
      const mine = (x) => x && x.status === 'approving' && x.runId === runId
      const failRun = async (out) => { try { await ptsTx(PTS_KEYS.redeem, (cur) => { const d = cur || { list: [] }; const x = (d.list || []).find(y => y.id === id); if (!mine(x)) return { write: false }; delete x.runId; delete x.runAt; return { write: true, doc: d } }, '兌換核准中斷(釋放執行權)', op) } catch (_) { /* 釋放不了＝5 分鐘後自動過期 */ } return out } // 中途失敗：釋放執行權（仍停在核准中），再按一次馬上能接手
      // ② 預留庫存（同兌換單只扣一次；缺貨＝退回待審；寫不進去＝停在核准中、回「再按一次」）（關卡 3 積分第一輪 OpenAI A2：原本扣庫存失敗被吞、會超賣）
      let stockErr = null
      try { await ptsTx(PTS_KEYS.rewards, (cur) => { stockErr = null; const d = cur || { list: [] }; const rw = (d.list || []).find(x => x.id === it.rewardId); if (!rw || rw.stock == null) return { write: false }; rw.stockIds = rw.stockIds || []; rw.stockRun = rw.stockRun || {}; const sr = rw.stockRun[it.id]; const srGen = sr && typeof sr === 'object' ? Number(sr.gen) || 0 : 0; if (srGen > myGen || (srGen === myGen && sr && sr.released)) { stockErr = 'stale'; return { write: false } } if (rw.stockIds.includes(it.id)) { if (srGen === myGen && sr.id === runId) return { write: false }; rw.stockRun[it.id] = { gen: myGen, id: runId }; return { write: true, doc: d } } if (!(rw.stock > 0)) { stockErr = 'out'; return { write: false } } rw.stock = rw.stock - 1; rw.stockIds = [...rw.stockIds, it.id]; rw.stockRun[it.id] = { gen: myGen, id: runId }; return { write: true, doc: d } }, '兌換預留庫存', op) } // 預留綁執行世代：只接受較新（或同）世代改寫；舊世代連覆寫都不行、放回也不行（資源端 fencing；關卡 3 積分第四、五輪 A2）
      catch (e) { return failRun({ status: 503, ok: false, error: '庫存存檔失敗，請再按一次核准（不會重複扣）：' + String(e && e.message || e).slice(0, 60) }) }
      const backToPending = (why) => ptsTx(PTS_KEYS.redeem, (cur) => { const d = cur || { list: [] }; const x = (d.list || []).find(y => y.id === id); if (!mine(x)) return { write: false }; x.status = 'pending'; delete x.decBy; delete x.decTs; delete x.runId; delete x.runAt; return { write: true, doc: d, value: true } }, '兌換退回待審(' + why + ')', op).then((v) => !!v).catch((e) => { console.error('[points] 退回待審失敗（停在核准中）', id, String(e && e.message || e).slice(0, 60)); return false })
      if (stockErr === 'stale') return { status: 409, ok: false, error: '這筆已被別人接手核准，請重新整理' } // 我是過期的執行者：什麼都不做
      if (stockErr === 'out') { const back = await backToPending('缺貨'); return back ? { status: 400, ok: false, error: '這個獎勵庫存沒了，無法核准（已退回待審）' } : failRun({ status: 400, ok: false, error: '這個獎勵庫存沒了，無法核准；退回待審沒存進去，請再按一次（會重做退回）' }) }
      // ③ 扣點（同兌換單 ref 只扣一次；點數不足＝放回預留的庫存、退回待審）
      let rdOk
      try {
        rdOk = await pointsCas(ptsDoc => { ptsDoc.list = ptsDoc.list || []; ptsDoc.rdGate = ptsDoc.rdGate || {}; if ((Number(ptsDoc.rdGate[it.id]) || 0) > myGen) return { write: false, value: 'stale' }; // 兌換關卡：較新世代已到或已關閉＝我過期，扣不到（扣點端 fencing；關卡 3 積分第七輪 A2）
           if (ptsDoc.list.some(e => e.act === 'redeem' && e.ref === it.id)) return { write: false, value: 'dup' }; if (balOf(it.person, ptsDoc) < it.cost) { if ((Number(ptsDoc.rdGate[it.id]) || 0) === myGen) return { write: false, value: 'short' }; ptsDoc.rdGate[it.id] = myGen; return { write: true, value: 'short' } } ptsDoc.list.push({ id: 'pt' + Date.now().toString(36) + '_rd', person: it.person, date: twDate(), ts: twHm(), type: 'redeem', act: 'redeem', pts: -Math.abs(it.cost), ref: it.id, by: who.name, note: it.rewardName }); ptsDoc.rdGate[it.id] = myGen; return { write: true, value: 'ok' } }, '兌換扣點(' + it.person + ' -' + it.cost + ')', op) // 點數不足或扣點時都把關卡推到我的世代（同一交易）：之後較舊世代一律扣不到
      } catch (e) { return failRun({ status: 503, ok: false, error: '積分存檔失敗，請再按一次核准（不會重複扣點）：' + String(e && e.message || e).slice(0, 80) }) }
      if (rdOk === 'stale') { // 扣點被關卡擋（較新世代已到或已退回）：放回我自己剛預留的庫存（世代與編號都是我的才放）後結束，不碰兌換單
        try { await ptsTx(PTS_KEYS.rewards, (cur) => { const d = cur || { list: [] }; const rw = (d.list || []).find(x => x.id === it.rewardId); const sr = (rw && rw.stockRun || {})[it.id]; if (!rw || !(rw.stockIds || []).includes(it.id) || !(sr && typeof sr === 'object' && Number(sr.gen) === myGen && sr.id === runId)) return { write: false }; rw.stock = (Number(rw.stock) || 0) + 1; rw.stockIds = rw.stockIds.filter(x => x !== it.id); rw.stockRun[it.id] = { gen: myGen, id: runId, released: true }; return { write: true, doc: d } }, '兌換放回庫存(過期執行者)', op) } catch (e) { console.error('[points] 過期執行者放回庫存失敗（請人工核對庫存）', it.id, String(e && e.message || e).slice(0, 60)) }
        return { status: 409, ok: false, error: '這筆已被別人接手或已退回，請重新整理' }
      }
      if (rdOk === 'short') { // 補償：確認仍持有執行權 → 放回預留庫存 → 成功才退回待審；放回失敗＝停在核准中（再按一次會重做補償）
        const cur0 = ((await ptsRead([PTS_KEYS.redeem], op))[PTS_KEYS.redeem] || {}).list || []; if (!mine(cur0.find(y => y.id === id))) return { status: 409, ok: false, error: '這筆狀態剛被改了，請重新整理' }
        try { await ptsTx(PTS_KEYS.rewards, (cur) => { const d = cur || { list: [] }; const rw = (d.list || []).find(x => x.id === it.rewardId); const sr = (rw && rw.stockRun || {})[it.id]; if (!rw || !(rw.stockIds || []).includes(it.id) || !(sr && typeof sr === 'object' && Number(sr.gen) === myGen && sr.id === runId)) return { write: false }; rw.stock = (Number(rw.stock) || 0) + 1; rw.stockIds = rw.stockIds.filter(x => x !== it.id); rw.stockRun[it.id] = { gen: myGen, id: runId, released: true }; return { write: true, doc: d } }, '兌換放回庫存(點數不足)', op) } catch (e) { return failRun({ status: 503, ok: false, error: '對方點數不足；放回庫存沒存進去，請再按一次核准（會重做放回）：' + String(e && e.message || e).slice(0, 60) }) } // 放回後保留世代墓碑：較舊世代之後才到的預留仍會被擋（關卡 3 積分第六輪 A2）
        const back = await backToPending('點數不足'); return back ? { status: 400, ok: false, error: '對方點數不足（可能剛被扣），無法核准（已退回待審）' } : failRun({ status: 400, ok: false, error: '對方點數不足，庫存已放回；退回待審沒存進去，請再按一次（點數夠了就會核准，不夠會再退回）' }) }
      let fin = null, already = false
      try { await ptsTx(PTS_KEYS.redeem, (cur) => { fin = null; already = false; const d = cur || { list: [] }; d.list = d.list || []; const x = d.list.find(y => y.id === id); if (!x) return { write: false }; if (x.status === 'approved') { fin = x; already = true; return { write: false } } if (!mine(x)) return { write: false }; const used = new Set(d.list.filter(y => y.code).map(y => y.code)); x.status = 'approved'; x.code = x.code || genCodeFrom(used); delete x.runId; delete x.runAt; fin = x; return { write: true, doc: d } }, '兌換審核(' + who.name + ')', op) }
      catch (e) { return failRun({ status: 503, ok: false, error: '點數已扣，券還沒存好，請再按一次核准（不會重複扣點）：' + String(e && e.message || e).slice(0, 60) }) }
      if (!fin) return { status: 409, ok: false, error: '這筆狀態剛被改了（可能別人接手核准），請重新整理' }
      if (already) return { ok: true } // 別人（或上一次）已完成核准：不重發通知
      await notify([fin.person], '✅ 兌換通過，券已進券包', `你換的「${fin.rewardName}」已核准（扣 ${fin.cost} 點）。到排行榜「我的獎勵券包」出示 QR 給核銷人，或報核銷碼 ${fin.code}`)
      await notify(checkersR, '🎟 有券待核銷', `${fin.person} 換「${fin.rewardName}」。現場請掃對方 QR 或輸核銷碼 ${fin.code}（到排行榜「現場核銷」）`)
      return { ok: true }
    }
    if (body.op === 'done') {
      let err = null
      await ptsTx(PTS_KEYS.redeem, (cur) => { err = null; const d = cur || { list: [] }; const x = (d.list || []).find(y => y.id === id); if (!x) { err = { status: 404, ok: false }; return { write: false } } if (x.status === 'done') return { write: false }; if (x.status !== 'approved' && x.status !== 'used') { err = { status: 400, ok: false, error: '這筆還沒核准，不能標已給' }; return { write: false } } x.status = 'done'; x.doneTs = nowR; return { write: true, doc: d } }, '兌換已給(' + who.name + ')', op)
      return err || { ok: true }
    }
    return { status: 400, ok: false }
  }
  // ── 📜 兌換核銷歷史（管理者／主管）──
  if (kind === 'redeemlog') {
    if (!who) return { status: 403, ok: false, error: 'NOPERM' }
    const defRl = await kvGet('sp_finance_pm_sop_def'); if (!isAdmOf(who, defRl)) return { status: 403, ok: false, error: '只有管理者/主管能看兌換核銷紀錄' }
    const rdDocL = (await ptsRead([PTS_KEYS.redeem], op))[PTS_KEYS.redeem] || { list: [] }
    const rows = (rdDocL.list || []).map(r => ({ id: r.id, person: r.person, rewardName: r.rewardName, cost: r.cost, status: r.status, code: r.code || '', ts: r.ts || '', decBy: r.decBy || '', decTs: r.decTs || '', usedBy: r.usedBy || '', usedAt: r.usedAt || '', note: r.note || '' }))
    const sum = { total: rows.length, pending: 0, approved: 0, used: 0, rejected: 0, usedPts: 0 }
    for (const r of rows) { sum[r.status] = (sum[r.status] || 0) + 1; if (r.status === 'used' || r.status === 'approved') sum.usedPts += Number(r.cost || 0) }
    return { ok: true, rows, sum }
  }
  // ── 📒 積分存摺（他人：管理者／主管；本人走 lb 的 myLedger）──
  if (kind === 'ledger') {
    if (!who) return { status: 403, ok: false, error: 'NOPERM' }
    const defLg = await kvGet('sp_finance_pm_sop_def'); const isAdmLg = isAdmOf(who, defLg)
    const nm = String(q.who || who.name).slice(0, 20)
    if (nm !== who.name && !isAdmLg) return { status: 403, ok: false, error: '只能查自己的' }
    const ptsDoc = (await ptsRead([PTS_KEYS.points], op))[PTS_KEYS.points] || { list: [], carry: {} }
    let run = Number((ptsDoc.carry || {})[nm] || 0)
    const withBal = (ptsDoc.list || []).filter(e => e.person === nm).map(e => { run += Number(e.pts || 0); return { date: e.date, ts: e.ts, act: e.act, type: e.type, pts: e.pts, bal: Math.round(run * 10) / 10, note: e.note || '', by: e.by || '' } })
    return { ok: true, who: nm, balance: Math.round(run * 10) / 10, ledger: withBal.slice(-200).reverse() }
  }
  return { status: 400, ok: false, error: '不認識的操作' }
}
