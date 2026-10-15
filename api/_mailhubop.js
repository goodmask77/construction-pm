// 信箱中樞操作分派（v4.71.108 從 mail-sync ?mailhub 抽出；GD 舊頁與新殼（經代發口 mailhub_op）共用同一份）
// 呼叫端負責：驗身分與主管資格（who）、給 kvGet／kvPut（用 _mailhubkv.js 的 mhKv，依資料歸屬自動走 GD 或新殼）
import * as MH from './_mailhub.js'
export async function mailhubDispatch({ method, op, q = {}, body = {}, who, kvGet, kvPut, guard = null }) { // guard：mhKv 給的搬信前檢查
  if (method !== 'POST') {
    if (op === 'list') return { ...(await MH.overview({ kvGet })), me: { name: who.name } }
    if (op === 'scan') return await MH.scanBox({ kvGet, kvPut, id: String(q.box || ''), days: Math.min(60, +q.days || 7), who })
    if (op === 'preview') return await MH.previewRule({ kvGet, ruleId: String(q.rule || ''), boxId: String(q.box || '') || null })
    if (op === 'scanget') return { ok: true, scan: await MH.loadScan(kvGet, String(q.box || '')) }
    return { ok: false, error: '不認得的操作' }
  }
  if (op === 'boxadd') return await MH.boxAdd({ kvGet, kvPut, body, who })
  if (op === 'boxset') return await MH.boxSet({ kvGet, kvPut, body, who })
  if (op === 'boxdel') return await MH.boxDel({ kvGet, kvPut, body, who })
  if (op === 'boxtest') { const hubT = await MH.loadHub(kvGet); const bxT = MH.boxById(hubT, String(body.id || '')); if (!bxT) return { ok: false, error: '找不到這個信箱' }; return await MH.testBox(bxT) }
  if (op === 'ruleadd') return await MH.ruleAdd({ kvGet, kvPut, body, who })
  if (op === 'ruleset') return await MH.ruleSet({ kvGet, kvPut, body, who })
  if (op === 'ruledel') return await MH.ruleDel({ kvGet, kvPut, body, who })
  if (op === 'preview') return await MH.previewRule({ kvGet, ruleId: body.id, rule: body.rule, boxId: body.box || null })
  if (op === 'apply') {
    const daysA = Math.min(60, +body.days || 7), idsA = Array.isArray(body.ids) && body.ids.length ? body.ids : null
    if (!body.box || body.box === '*') { if (idsA) return { ok: false, error: '指定規則執行要選一個信箱' }; return await MH.applyAll({ kvGet, kvPut, days: daysA, dry: !!body.dry, who, guard }) } // 全部信箱不支援指定規則（原本會默默忽略；關卡 3 mailhub 第一輪 OpenAI A5）
    return await MH.applyBox({ kvGet, kvPut, id: String(body.box), days: daysA, dry: !!body.dry, onlyIds: idsA, who, requireConfirmed: !idsA, guard }) // 手動指定規則＝人在現場按＝不必先勾「已確認」
  }
  return { ok: false, error: '不認得的操作' }
}
