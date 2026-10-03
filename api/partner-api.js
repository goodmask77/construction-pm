// partner-api v1 —— 給阿桑（A Beach OPS 系統）的唯讀互通 API（2026-10-03 張良拍板：兩邊互通、全明細全歷史）
// 對等於阿桑給我們的 boss-api：只有 GET、Bearer 金鑰、無 CORS（server-to-server）、{data,count,next,from,to} 外殼
// 路徑：/partner/v1/<ep>（vercel.json rewrite）或 /api/partner-api?ep=<ep>
// 驗證：Authorization: Bearer <PARTNER_API_KEY>（或 x-api-key 標頭）
// 端點：ping / revenue/daily / revenue/items / orders / orders/prices / reservations / reservations/summary
//       / hr/schedule / hr/staff / sop/defs / sop/daily / sop/issues
// 名冊刻意不回機密欄（薪資/身分證/銀行/保險…黑名單制，與 rosterprobe 同一套）；其餘全明細。

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

async function kvGet(id) {
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  const rows = r.ok ? await r.json() : []
  try { return rows[0]?.data?.v ? JSON.parse(rows[0].data.v) : null } catch (_) { return null }
}
async function kvGetMany(ids) {
  if (!ids.length) return {}
  const r = await fetch(`${SB_URL}/rest/v1/pm_documents?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
  const rows = r.ok ? await r.json() : []
  const out = {}
  for (const row of rows) { try { out[row.id] = row.data?.v ? JSON.parse(row.data.v) : null } catch (_) { out[row.id] = null } }
  return out
}

const tpeToday = (off = 0) => new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10)
const daysDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3)
const monthsBetween = (from, to) => { // ['YYYY-MM', …] 含頭含尾
  const out = []
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const end = to.slice(0, 7)
  while (true) { const s = `${y}-${String(m).padStart(2, '0')}`; out.push(s); if (s >= end) break; m++; if (m > 12) { m = 1; y++ } }
  return out
}
const tpeDateOf = (ts) => { try { return new Date(Date.parse(ts) + 8 * 3600e3).toISOString().slice(0, 10) } catch (_) { return '' } }

// 統一外殼：排序後依 cursor(offset) 切頁
function page(res, rows, q, extra) {
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 100))
  let off = 0
  if (q.cursor) {
    try { off = Number(Buffer.from(String(q.cursor), 'base64').toString('utf8').replace(/^o:/, '')) } catch (_) { off = NaN }
    if (!Number.isInteger(off) || off < 0) return res.status(400).json({ error: 'invalid cursor' })
  }
  const slice = rows.slice(off, off + limit)
  const next = off + limit < rows.length ? Buffer.from('o:' + (off + limit)).toString('base64') : null
  return res.status(200).json({ data: slice, count: slice.length, next, ...extra })
}

// 區間參數：預設窗 defBack 天、上限 maxDays 天
function range(q, defBack, maxDays) {
  const from = q.from, to = q.to
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return { err: 'from/to must be YYYY-MM-DD' }
  const t = to || tpeToday()
  const f = from || addDays(t, -defBack)
  if (f > t) return { err: 'from is after to' }
  if (daysDiff(f, t) + 1 > maxDays) return { err: `range longer than ${maxDays} days` }
  return { from: f, to: t }
}

// 狀態碼對照＝api/_inline.js STATE_TXT 實測（v4.34.0 修正）：有效訂位＝code 不在 {2,5}
const INLINE_ST = { 1: 'confirmed', 2: 'cancelled', 3: 'pending', 4: 'seated', 5: 'cancelled', 6: 'confirmed' }
const SCOPES = ['revenue', 'orders', 'reservations', 'hr', 'sop']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })
  const want = (process.env.PARTNER_API_KEY || '').trim()
  const got = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-api-key'] || '').trim()
  if (!want || !got || got !== want) return res.status(401).json({ error: 'unauthorized' })

  const ep = String(req.query?.ep || '').replace(/^\/+|\/+$/g, '')
  const q = req.query || {}
  try {
    if (ep === 'ping') return res.status(200).json({ ok: true, scopes: SCOPES, rate_limit_per_min: 60, note: 'GROUN:D 營業/叫貨 + AB inline 訂位 + GD 班表/名冊/SOP；GET only；建議循序呼叫' })

    // ── 營收：sp_finance_pm_pos.entries（GROUN:D 喬亞 + A Beach Eats365 都在；store 參數可濾）
    if (ep === 'revenue/daily') {
      const r = range(q, 30, 366); if (r.err) return res.status(400).json({ error: r.err })
      const skOf = (n) => /groun/i.test(n || '') ? 'ground' : 'abeach'
      const doc = (await kvGet('sp_finance_pm_pos')) || { entries: [] }
      let rows = (doc.entries || []).filter(e => e.date >= r.from && e.date <= r.to)
      if (q.store) rows = rows.filter(e => skOf(e.store) === String(q.store))
      rows = rows.map(e => ({
        date: e.date, store: skOf(e.store), store_name: e.store,
        net_sales: e.revenue ?? null, gross_sales: e.grossSales ?? null, discount: e.discount ?? null,
        service_fee: e.serviceFee ?? null, tx_count: e.txCount ?? null, guests: e.guests ?? null,
        cash: e.cash ?? null, card: e.card ?? null, linepay: e.linepay ?? null, pay_other: e.payOther ?? null,
        kiosk: e.kiosk ?? null, uber: e.uber ?? null, dine_tx: e.dineTx ?? null, take_tx: e.takeTx ?? null,
        source: e.source || null,
      })).sort((a, b) => (a.date === b.date ? (a.store < b.store ? -1 : 1) : (a.date < b.date ? 1 : -1)))
      return page(res, rows, q, { from: r.from, to: r.to })
    }

    // ── 品項明細：sp_finance_pm_pos_d_<月>.days['date::store'].sheets → 攤平（sheet=原始分頁名、section=分類）
    if (ep === 'revenue/items') {
      const r = range(q, 30, 92); if (r.err) return res.status(400).json({ error: r.err })
      const docs = await kvGetMany(monthsBetween(r.from, r.to).map(m => 'sp_finance_pm_pos_d_' + m))
      const rows = []
      for (const doc of Object.values(docs)) {
        for (const [dk, day] of Object.entries(doc?.days || {})) {
          const date = (day?.date || dk.slice(0, 10))
          if (date < r.from || date > r.to) continue
          const store = /groun/i.test(day?.store || dk) ? 'ground' : 'abeach'
          for (const [sheet, secs] of Object.entries(day?.sheets || {})) {
            for (const sec of (Array.isArray(secs) ? secs : [])) {
              for (const row of (sec?.rows || [])) {
                rows.push({ date, store, sheet, section: sec.title || '', name: row[0] ?? '', qty: row[1] === '' ? null : Number(row[1]) || 0, pct: row[2] || null, amount: row[3] === '' ? null : Number(row[3]) || 0 })
              }
            }
          }
        }
      }
      rows.sort((a, b) => (a.date === b.date ? 0 : (a.date < b.date ? 1 : -1)))
      return page(res, rows, q, { from: r.from, to: r.to, note: 'section=「總結」是分類彙總列，別跟單品重複加總；「付款方式」「時段」等 sheet 也原樣攤平在內' })
    }

    // ── 叫貨單：sp_supply_pm_orders（單頭含明細 items、驗收 check；滾動保留約600筆）
    if (ep === 'orders') {
      const r = range(q, 3650, 3660); if (r.err) return res.status(400).json({ error: r.err })
      const list = (await kvGet('sp_supply_pm_orders')) || []
      const rows = (Array.isArray(list) ? list : []).filter(o => { const d = tpeDateOf(o.ts); return d >= r.from && d <= r.to })
        .map(o => ({
          order_id: o.id, created_at: o.ts, vendor: o.vendorName || '', dept: o.dept || '', need_date: o.needDate || null,
          via: o.via || null, status: o.status || null, note: o.text || null,
          items: (o.items || []).map((it, i) => ({ line: i, name: it.name, spec: it.spec || null, unit: it.unit || null, qty: it.qty ?? null, price: it.price ?? null, check: o.check?.items?.[i]?.st || null })),
          checked_at: o.check?.ts || null, checked_by: o.check?.by || null,
        })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return page(res, rows, q, { from: r.from, to: r.to })
    }

    // ── 進價流水：sp_supply_pm_ph_<月>.rows
    if (ep === 'orders/prices') {
      const r = range(q, 30, 366); if (r.err) return res.status(400).json({ error: r.err })
      const docs = await kvGetMany(monthsBetween(r.from, r.to).map(m => 'sp_supply_pm_ph_' + m))
      const rows = []
      for (const doc of Object.values(docs)) for (const x of (doc?.rows || [])) {
        if (x.d >= r.from && x.d <= r.to) rows.push({ date: x.d, vendor: x.vendor || '', item: x.item || '', unit: x.unit || null, price: x.p ?? null, qty: x.q ?? null, src: x.src || null })
      }
      rows.sort((a, b) => (a.date < b.date ? 1 : -1))
      return page(res, rows, q, { from: r.from, to: r.to })
    }

    // ── AB inline 訂位：sp_finance_pm_inline_<月>.days（全史 2021-02 起；一次最多 92 天）
    if (ep === 'reservations') {
      const r = range(q, 30, 92); if (r.err) return res.status(400).json({ error: r.err })
      const docs = await kvGetMany(monthsBetween(r.from, r.to).map(m => 'sp_finance_pm_inline_' + m))
      const rows = []
      for (const doc of Object.values(docs)) for (const [day, list] of Object.entries(doc?.days || {})) {
        if (day < r.from || day > r.to) continue
        for (const x of (Array.isArray(list) ? list : [])) rows.push({
          date: day, time: x.t || null, reservation_id: x.id || null, name: x.name || null, phone: x.phone || null,
          guests: x.n ?? null, status: INLINE_ST[x.st] || String(x.st ?? ''), status_code: x.st ?? null, kids_chair: x.kc ?? null,
          note: x.note || null, internal_note: x.inote || null, source: x.src || null, ref: x.ref || null,
          created_at: x.created || null, cancelled_at: x.canceled || null, seated_at: x.seated || null, waitlist: x.waitlist ?? null,
        })
      }
      rows.sort((a, b) => (a.date === b.date ? String(a.time).localeCompare(String(b.time)) : (a.date < b.date ? 1 : -1)))
      return page(res, rows, q, { from: r.from, to: r.to })
    }
    if (ep === 'reservations/summary') { // 全史月彙總（{months:{'YYYY-MM':{days,resv,guests}}}；guests 不含取消）
      const ov = (await kvGet('sp_finance_pm_inline')) || {}
      return res.status(200).json({ data: ov, count: 1, next: null })
    }

    // ── GD 班表：sp_finance_pm_shift_g.list（/prep 班表分頁同一份）
    if (ep === 'hr/schedule') {
      const r = range(q, 7, 366); if (r.err) return res.status(400).json({ error: r.err })
      const doc = (await kvGet('sp_finance_pm_shift_g')) || { list: [] }
      const rows = (doc.list || []).filter(x => x.date >= r.from && x.date <= r.to)
        .map(x => ({ date: x.date, name: x.name, start: x.start || null, end: x.end || null, break_min: x.break ?? null, role: x.role || x.pos || null }))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
      return page(res, rows, q, { from: r.from, to: r.to })
    }

    // ── 名冊：sp_crew_kb_roster（黑名單擋機密欄：薪資/身分證/銀行/保險…；與 rosterprobe 同規則）
    if (ep === 'hr/staff') {
      const rd = (await kvGet('sp_crew_kb_roster')) || {}
      const BLOCK = /身分證|銀行|薪轉|保險|投保|勞保|健保|團保|生日碼|本薪|薪資|補助|津貼/
      const fs2 = (Array.isArray(rd.fields) ? rd.fields : []).filter(f => f.type !== 'file' && !BLOCK.test(f.label || ''))
      const rows = (Array.isArray(rd.people) ? rd.people : []).map(p => {
        const o = { staff_id: p.id, name: p.name, nick: p.nick || '', status: p.status || '', gd: p.gd ? true : false, gd_role: p.gdRole || null, start_date: p.startDate || null, end_date: p.endDate || null }
        fs2.forEach(f => { const v = p[f.key] ?? p.fields?.[f.key]; if (v != null && String(v).trim()) o[f.key] = v })
        return o
      })
      return page(res, rows, q, { fields: fs2.map(f => ({ key: f.key, label: f.label })) })
    }

    // ── SOP：定義＋每日完成＋問題回報
    if (ep === 'sop/defs') {
      const def = (await kvGet('sp_finance_pm_sop_def')) || {}
      const rows = []
      for (const [store, d] of Object.entries(def)) for (const it of (d?.items || [])) rows.push({ store, sop_id: it.id, station: it.st || null, title: it.title, due: it.due || null, need_photo: !!it.photo })
      return page(res, rows, q, {})
    }
    if (ep === 'sop/daily') {
      const r = range(q, 6, 31); if (r.err) return res.status(400).json({ error: r.err })
      const dates = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) dates.push(d)
      const [def, ...docs] = await Promise.all([kvGet('sp_finance_pm_sop_def'), ...dates.map(d => kvGet('sp_finance_pm_sop_g_' + d))])
      const meta = {}; for (const [store, d] of Object.entries(def || {})) for (const it of (d?.items || [])) meta[it.id] = { store, station: it.st || null, title: it.title, due: it.due || null }
      const rows = []
      dates.forEach((date, i) => { for (const [id, x] of Object.entries(docs[i]?.items || {})) rows.push({ date, sop_id: id, ...(meta[id] || {}), done: !!x.done, done_at: x.ts || null, by: x.by || null, photo: typeof x.photo === 'string' && !x.photo.startsWith('data:') ? x.photo : (x.photo ? '(photo)' : null) }) })
      rows.sort((a, b) => (a.date < b.date ? 1 : -1))
      return page(res, rows, q, { from: r.from, to: r.to })
    }
    if (ep === 'sop/issues') {
      const r = range(q, 3650, 3660); if (r.err) return res.status(400).json({ error: r.err })
      const doc = (await kvGet('sp_finance_pm_sop_issues')) || { list: [] }
      const rows = (doc.list || []).filter(x => { const d = tpeDateOf(x.ts); return d >= r.from && d <= r.to })
        .map(x => ({ issue_id: x.id, created_at: x.ts, store: x.store || null, by: x.name || null, text: x.text || null, kind: x.kind || null, status: x.status || null, claimed_by: x.claimBy || null, claimed_at: x.claimAt || null, photos: (x.photos || []).filter(u => typeof u === 'string' && !u.startsWith('data:')) }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return page(res, rows, q, { from: r.from, to: r.to })
    }

    return res.status(404).json({ error: 'unknown endpoint: ' + ep })
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
