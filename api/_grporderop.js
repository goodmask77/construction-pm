// 團體訂餐店家操作分派（v4.71.132 從 mail-sync ?grporder 抽出；GD 舊頁與新殼（經代發口 gorder_op）共用同一份，內容照搬）
// 呼叫端負責驗身分（who：name／rid）與編輯權限（canEdit＝GD 權限表「團體訂餐」分頁）；回傳物件，status 欄＝HTTP 狀態（沒有＝200）
import * as GO from './_grporder.js'
import { kvGet } from './_onboard.js'
export async function grporderDispatch({ method, op, q = {}, body = {}, who, canEdit }) {
  if (method !== 'POST') {
    if (op === 'list') return { ok: true, ver: GO.GO_VER, me: { name: who.name, canEdit }, list: await GO.listOrders(), cfg: await GO.loadCfg(), menu: await GO.loadMenu() }
    if (op === 'get') { const o = await GO.getOrder(String(q.id || '')); if (!o) return { status: 404, ok: false, error: '找不到這張單' }; return { ok: true, order: o, menu: await GO.loadMenu(), cfg: await GO.loadCfg(), link: GO.linkOf(o.id), me: { name: who.name, canEdit } } }
    if (op === 'cfg') return { ok: true, cfg: await GO.loadCfg() }
    return { status: 400, ok: false, error: '不認識的操作' }
  }
  if (!canEdit) return { status: 403, ok: false, error: '沒有「團體訂餐」的編輯權限（請主管在權限頁開）' }
  if (op === 'create') return GO.createOrder({ who, ...body })
  if (op === 'save') return GO.saveOrder({ who, id: String(body.id || ''), patch: body.patch || {} })
  if (op === 'status') return GO.setStatus({ who, id: String(body.id || ''), status: String(body.status || '') })
  if (op === 'parse') return GO.parseText({ text: body.text })
  if (op === 'cfg') return GO.saveCfg(body.cfg || {}, who)
  if (op === 'imgsave') return GO.saveImgs({ who, id: String(body.id || ''), p1: body.p1, p2: body.p2 })
  if (op === 'invoice') return GO.invoiceIssue({ who, id: String(body.id || ''), taxId: body.taxId, title: body.title, addr: body.addr, email: body.email, phone: body.phone }) // 🧾 v4.71.3 手動開發票
  if (op === 'invoicevoid') return GO.invoiceVoid({ who, id: String(body.id || ''), reason: body.reason })
  if (op === 'sendimgs' || op === 'sendlink') {
    const IB = await import('./_inbox.js')
    const [def, pm] = await Promise.all([kvGet('sp_finance_pm_sop_def'), kvGet('sp_finance_pm_prep_perm')])
    const mgr = IB.isMgr(who, (((def || {}).ground || {}).approvers || ['張良瑋']), pm)
    const a = { who, mgr, cfgIB: await IB.loadCfg(), IB, id: String(body.id || '') }
    return IB.ibAs(who.name, () => (op === 'sendimgs' ? GO.sendImgs(a) : GO.sendLink(a))) // 收件匣存檔以操作者姓名執行
  }
  return { status: 400, ok: false, error: '不認識的操作' }
}
