// 🤖 DD 代查：會員（query_member）與團體訂餐（query_grporder）｜v4.70.90（2026-10-12 張良「繼續」）
// 唯讀。會員＝個資：外部群（moneyOK=false）整段擋；完整手機只給 secretOK（操作者／審核人）其他遮罩。資料來源同 GD App（api/_member.js／api/_grporder.js）。
const mask = (p) => p ? String(p).replace(/^(\d{4})\d+(\d{3})$/, '$1***$2') : ''
const tw = (iso) => { try { return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) } catch (_) { return String(iso || '').slice(5, 16) } }
export async function queryMember ({ kw, secretOK }) {
  const MB = await import('./_member.js')
  kw = String(kw || '').trim()
  try {
    if (!kw) { const [st, list] = await Promise.all([MB.stats(), MB.listMembers({ limit: 20 })]); return `【會員總覽（GROUN:D 自建會員）】會員 ${st.members} 人｜今日入點 +${st.todayEarn}／兌換 −${st.todayUsed}｜未用點數合計 ${st.outstanding}\n最近加入 ${list.length} 人：` + list.map(m => `${m.name || '—'}（${m.mno}）${m.balance} 點${m.src === 'line' ? '' : '・店員建'}`).join('；') + '\n（要查某人：{"type":"query_member","kw":"姓名或手機末碼或會員號碼"}）' }
    const list = await MB.listMembers({ q: kw, limit: 5 })
    if (!list.length) return `【會員查詢「${kw}」】找不到這位會員（名字／手機／會員號碼都對不到）。`
    const out = []
    for (const m of list.slice(0, 3)) { const d = await MB.getMember({ id: m.id, mgr: !!secretOK }); if (!d.ok) continue; const mm = d.member
      out.push(`▸ ${mm.name}（會員號碼 ${mm.mno}）${mm.hasLine ? 'LINE 已綁' : '店員建、沒綁 LINE'}・${mm.status === 'active' ? '正常' : mm.status}・手機 ${secretOK ? (mm.phone || '—') : (mask(mm.phone) || '—')}・加入 ${String(mm.created_at).slice(0, 10)}\n  可用 ${d.balance} 點（累計得 ${d.earned}、用 ${d.used}）\n  最近流水：` + (d.ledger || []).slice(0, 8).map(l => `${tw(l.created_at)} ${({ earn: '累點', spend: '兌換', adjust: '調整', welcome: '入會禮', game: '遊戲', reverse: '沖回' })[l.kind] || l.kind} ${l.pts > 0 ? '+' : ''}${l.pts}${l.amount ? '（消費 ' + l.amount + '）' : ''}${l.note ? ' ' + l.note : ''}`).join('；') + (d.coupons && d.coupons.length ? `\n  券：` + d.coupons.slice(0, 5).map(c => `${c.name}${c.status === 'issued' ? '(可用)' : c.status === 'redeemed' ? '(已用)' : '(' + c.status + ')'}`).join('、') : ''))
    }
    return `【會員查詢「${kw}」】找到 ${list.length} 筆${list.length > 3 ? '（只列前 3）' : ''}：\n` + out.join('\n')
  } catch (e) { return `【會員查詢】${String(e.message || e).slice(0, 120)}` }
}
export async function queryGrporder ({ kw, id, status }) {
  const GO = await import('./_grporder.js'); const C = await import('../public/ops/js/grporder-calc.js')
  try {
    const menu = await GO.loadMenu(); const L = C.STATUS_LABEL
    if (id) { const o = await GO.getOrder(String(id)); if (!o) return `【團體訂餐】找不到單號 ${id}`; const t = C.totals(menu, o)
      return `【團體訂餐 ${o.company || o.custName}（單號 ${o.id}）】狀態 ${L[o.status] || o.status}｜取餐 ${o.when || '待定'}（${o.mode || ''}）｜截單 ${o.deadline || '—'}｜統編 ${o.taxId || '—'}｜聯絡 ${o.contact || ''}\n全單 ${t.total}（個人 ${t.people}＋共用 ${t.shared}${t.disc ? '－折扣 ' + t.disc : ''}）｜${t.n} 人、${t.nDone} 人按點好、套餐 ${t.sets} 組${t.pend ? '｜待確認 ' + t.pend + ' 項' : ''}\n` + (o.rows || []).map((r, i) => `${i + 1}. ${r.name || '—'}${r.src === 'line' ? '' : '(手打)'}：` + (r.lines || []).map(l => C.lineLabel(menu, l)).join('；') + ` ＝ ${C.priceRow(menu, r, o.frozen).total}`).join('\n') + ((o.shared || []).length ? `\n共用：` + o.shared.map(s => C.labelOf(menu, s)).join('、') : '') + `\n客人連結 ${GO.linkOf(o.id)}` }
    let list = await GO.listOrders()
    if (status) list = list.filter(x => x.status === status)
    if (kw) { const k = String(kw).toLowerCase(); list = list.filter(x => String(x.company || '').toLowerCase().includes(k) || String(x.custName || '').toLowerCase().includes(k) || String(x.when || '').includes(k)) }
    if (!list.length) return `【團體訂餐】沒有符合的單${kw ? '（關鍵字 ' + kw + '）' : ''}。`
    return `【團體訂餐 ${kw ? '「' + kw + '」' : '全部'} ${list.length} 張（新→舊，最多 20）】\n` + list.slice(0, 20).map(x => `• ${x.company || x.custName || '—'}｜${L[x.status] || x.status}｜取餐 ${x.when || '待定'}｜${x.n} 人｜暫計 ${x.total}｜負責 ${x.assignee || '—'}｜單號 ${x.id}`).join('\n') + '\n（要看某張明細：{"type":"query_grporder","id":"單號"}）'
  } catch (e) { return `【團體訂餐查詢】${String(e.message || e).slice(0, 120)}` }
}
