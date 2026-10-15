import './_qpatch.js' // v4.71.10 DD 推播統一補額度尾巴
// ── Pinterest 圖版 → 行銷大師素材庫（v4.71.5，張良 2026-10-12「行銷大師能不能串 pinterest 我要的圖直接存進來」→「做 存＆貼連結」）──
// 不用 Pinterest API（要申請＋審核 2~4 週）：公開釘圖／圖版的網頁本身內嵌 __PWS_INITIAL_PROPS__，裡面有每張釘圖的原圖網址＋ image_signature（圖片指紋）。
// 做法：貼連結（單張釘圖／整個圖版）立刻抓；登記的圖版每小時自動看一次，只抓沒看過的（釘圖編號＋圖片指紋兩道去重）。
// 資料：KV sp_finance_pm_pinterest = { boards:[{id,url,name,user,slug,addedAt,addedBy,lastAt,lastNew,total,err}], seen:{pinId:{sig,url,at,board}}, sigs:{sig:pinId} }
// 圖檔：Supabase photos 桶 social/pin/<pinId>.<ext>（跟素材庫上傳同桶）；素材庫列表 sp_finance_pm_social_assets 多欄 src:'pinterest', pin, pinUrl, board
import { kvGet, kvPut, socTx, socRun, socGate } from './_socialkv.js' // v4.71.146 社群域依歸屬版本比對讀寫（其他鍵照舊 GD）

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const SB_URL = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
export const PIN_KEY = 'sp_finance_pm_pinterest'
const AST_KEY = 'sp_finance_pm_social_assets'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const PIN_URL = (id) => `https://www.pinterest.com/pin/${id}/`

export async function pinDoc() { const d = (await kvGet(PIN_KEY)) || {}; d.boards = d.boards || []; d.seen = d.seen || {}; d.sigs = d.sigs || {}; return d }
// v4.71.146：寫回改「重讀最新再合併」（釘圖紀錄 seen／sigs 合併；圖版只更新這次動到的、新增這次加的；刪除另走 boardDel）——圖片已上傳（固定路徑、可覆寫），只重做寫入
async function pinSave(d, { addBoardId } = {}) {
  await socTx(PIN_KEY, (cur) => { const c = cur || {}; const out = { ...c, seen: { ...(c.seen || {}), ...(d.seen || {}) }, sigs: { ...(c.sigs || {}), ...(d.sigs || {}) } }
    const cb = Array.isArray(c.boards) ? c.boards.map(b => ({ ...b })) : []
    for (const b of (d.boards || [])) { const i = cb.findIndex(x => x.id === b.id); if (i >= 0) cb[i] = { ...cb[i], lastAt: b.lastAt, lastNew: b.lastNew, total: b.total, err: b.err, name: b.name }; else if (b.id === addBoardId && !cb.some(x => x.url === b.url)) cb.push({ ...b }) }
    out.boards = cb; return { write: true, doc: out } }, 'Pinterest')
}

// 連結分類：{kind:'pin',id} ／ {kind:'board',url,user,slug} ／ null
export async function parseUrl(raw) {
  let u = String(raw || '').trim(); if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  let url; try { url = new URL(u) } catch (_) { return null }
  if (/^pin\.it$/i.test(url.hostname)) { // 短網址 → 跟到真正位置
    try { const r = await fetch(url.href, { method: 'GET', redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) }); if (r.url && r.url !== url.href) return parseUrl(r.url) } catch (_) {}
    return null
  }
  if (!/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) return null
  const p = url.pathname.replace(/\/+$/, '')
  let m = p.match(/^\/pin\/(\d{6,})/); if (m) return { kind: 'pin', id: m[1] }
  m = p.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_%.-]+)(?:\/([A-Za-z0-9_%.-]+))?$/) // /user/board 或 /user/board/section
  if (m && !/^(pin|search|ideas|today|settings|business|login)$/i.test(m[1])) return { kind: 'board', url: `https://www.pinterest.com/${m[1]}/${m[2]}/${m[3] ? m[3] + '/' : ''}`, user: m[1], slug: decodeURIComponent(m[2]) + (m[3] ? '/' + decodeURIComponent(m[3]) : '') }
  return null
}

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(20000) })
  if (!r.ok) throw new Error('Pinterest 回 ' + r.status)
  return await r.text()
}
function props(html) {
  const m = /<script id="__PWS_INITIAL_PROPS__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch (_) { return null }
}
// 從頁面初始資料取釘圖：{id, url(原圖), w, h, sig, title}
function pinsFrom(pr) {
  const out = [], pins = (pr && pr.initialReduxState && pr.initialReduxState.pins) || {}
  for (const [id, p] of Object.entries(pins)) {
    const o = p && p.images && p.images.orig; if (!o || !o.url || !/^\d{6,}$/.test(id)) continue
    out.push({ id, url: o.url, w: o.width || 0, h: o.height || 0, sig: p.image_signature || '', title: String(p.grid_title || p.title || '').trim().slice(0, 60) })
  }
  return out
}
function boardFrom(pr, fallback) {
  const bs = (pr && pr.initialReduxState && pr.initialReduxState.boards) || {}
  for (const b of Object.values(bs)) { if (b && b.name) return { name: String(b.name).slice(0, 60), count: Number(b.pin_count) || 0, id: b.id || '' } }
  return { name: fallback || '', count: 0, id: '' }
}
function ogImage(html) { const m = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/.exec(html) || /<meta[^>]*content="([^"]+)"[^>]*property="og:image"/.exec(html); return m ? m[1] : '' }
function ogTitle(html) { const m = /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/.exec(html) || /<meta[^>]*content="([^"]*)"[^>]*property="og:title"/.exec(html); return m ? m[1].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').slice(0, 60) : '' }

export async function fetchPin(id) {
  const html = await fetchHtml(PIN_URL(id))
  const pr = props(html); const hit = pinsFrom(pr).find(p => p.id === id)
  if (hit) return hit
  const og = ogImage(html); if (!og) throw new Error('這張釘圖讀不到圖片（可能是私密或已刪）')
  return { id, url: og.replace(/\/\d+x\//, '/originals/'), url2: og, w: 0, h: 0, sig: (og.match(/\/([a-f0-9]{32})\.[a-z]+$/i) || [])[1] || '', title: ogTitle(html) }
}
export async function fetchBoard(url, slug) {
  const html = await fetchHtml(url)
  const pr = props(html); if (!pr) throw new Error('圖版頁面讀不到資料（可能是私密圖版）')
  const list = pinsFrom(pr); const seen = new Set(); const pins = list.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
  return { board: boardFrom(pr, slug), pins }
}

async function download(p) {
  // 原圖抓不到／太大（>12MB，serverless 記憶體）→ 退 1200x 再退 736x（縮圖一律 .jpg，原圖是 .png 也一樣）
  const jpg = (sz) => p.url.replace('/originals/', '/' + sz + '/').replace(/\.\w+$/, '.jpg')
  for (const u of [p.url, p.url2, jpg('1200x'), jpg('736x')].filter(Boolean)) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA, referer: 'https://www.pinterest.com/' }, signal: AbortSignal.timeout(30000) })
      if (!r.ok) continue
      const ct = (r.headers.get('content-type') || '').split(';')[0].trim()
      if (!/^image\//.test(ct)) continue
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1000 || buf.length > 12 * 1024 * 1024) continue
      return { buf, ct, from: u }
    } catch (_) {}
  }
  return null
}
async function upload(buf, ct, path) {
  if (!SB_URL || !SB_KEY) throw new Error('沒有圖片儲存設定')
  const r = await fetch(`${SB_URL}/storage/v1/object/photos/${path}`, { method: 'POST', headers: { authorization: `Bearer ${SB_KEY}`, 'content-type': ct, 'x-upsert': 'true' }, body: buf })
  if (!r.ok) throw new Error('上傳失敗(' + r.status + ')')
  return `${SB_URL}/storage/v1/object/public/photos/${path}`
}

// 把一批釘圖存進素材庫（兩道去重：釘圖編號、圖片指紋）。回 {added:[...], dup, failed}
export async function savePins(pins, { who, board, d, addBoardId } = {}) {
  d = d || await pinDoc()
  const added = [], failed = []; let dup = 0
  for (const p of pins.slice(0, 60)) { // 一次最多 60 張（serverless 時間）
    if (d.seen[p.id] || (p.sig && d.sigs[p.sig])) { dup++; continue }
    const got = await download(p)
    if (!got) { failed.push(p.id); continue }
    const ext = (got.ct.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '')
    let url; try { url = await upload(got.buf, got.ct, `social/pin/${p.id}.${ext}`) } catch (e) { failed.push(p.id); continue }
    d.seen[p.id] = { sig: p.sig || '', url, at: new Date().toISOString(), board: board || '' }; if (p.sig) d.sigs[p.sig] = p.id
    added.push({ url, type: 'image', name: (p.title || '').slice(0, 40), addedAt: new Date().toISOString(), addedBy: who || 'Pinterest', src: 'pinterest', pin: p.id, pinUrl: PIN_URL(p.id), board: board || '', w: p.w || 0, h: p.h || 0 })
  }
  if (added.length) await socTx(AST_KEY, (cur) => { const L = (cur && cur.list) || []; const have = new Set(L.map(x => x.url)); const add = added.filter(x => !have.has(x.url)); if (!add.length) return { write: false }; return { write: true, doc: { ...(cur || {}), list: [...add, ...L].slice(0, 300) } } }, 'Pinterest素材') // 以網址去重合併（重做不重複加）
  await pinSave(d, { addBoardId })
  return { added, dup, failed }
}

// 貼連結：單張釘圖或整個圖版，馬上抓
export async function importUrl(raw, who) {
  const t = await parseUrl(raw); if (!t) return { ok: false, error: '這不是 Pinterest 的釘圖或圖版連結', url: raw }
  if (t.kind === 'pin') { const p = await fetchPin(t.id); const r = await savePins([p], { who }); return { ok: true, kind: 'pin', ...r, url: raw } }
  const { board, pins } = await fetchBoard(t.url, t.slug)
  const r = await savePins(pins, { who, board: board.name || t.slug })
  return { ok: true, kind: 'board', board: board.name || t.slug, found: pins.length, total: board.count, ...r, url: raw }
}

// 登記圖版（每小時自動抓）
export async function boardAdd(raw, who) {
  const t = await parseUrl(raw); if (!t || t.kind !== 'board') throw new Error('請貼「圖版」連結（像 pinterest.com/帳號/圖版名/），單張釘圖用「貼連結存圖」就好')
  const d = await pinDoc()
  if (d.boards.some(b => b.url === t.url)) throw new Error('這個圖版已經登記過了')
  const { board, pins } = await fetchBoard(t.url, t.slug)
  const b = { id: 'b' + Date.now().toString(36), url: t.url, user: t.user, slug: t.slug, name: board.name || t.slug, addedAt: new Date().toISOString(), addedBy: who || '', lastAt: '', lastNew: 0, total: 0, err: '' }
  d.boards.push(b)
  const r = await savePins(pins, { who, board: b.name, d, addBoardId: b.id }) // savePins 會合併存 d（含新 board）
  const d2 = await pinDoc(); const bb = d2.boards.find(x => x.id === b.id); if (bb) { bb.lastAt = new Date().toISOString(); bb.lastNew = r.added.length; bb.total = Object.values(d2.seen).filter(s => s.board === b.name).length; await pinSave(d2) }
  return { board: b, ...r, found: pins.length }
}
export async function boardDel(id) { return socTx(PIN_KEY, (cur) => { const c = cur || {}; const boards = (c.boards || []).filter(b => b.id !== id); return { write: boards.length !== (c.boards || []).length, doc: { ...c, boards }, value: boards } }, 'Pinterest刪圖版').then(v => v || (async () => (await pinDoc()).boards)()) }

// 每小時：登記的圖版逐一看，只抓新的；有新圖就 LINE 私訊張良一句
export async function syncAll({ notify = true } = {}) {
  const d = await pinDoc(); const out = []
  for (const b of d.boards) {
    try {
      const { board, pins } = await fetchBoard(b.url, b.slug)
      const fresh = pins.filter(p => !d.seen[p.id] && !(p.sig && d.sigs[p.sig]))
      const r = fresh.length ? await savePins(fresh, { who: 'Pinterest 自動', board: b.name, d }) : { added: [], dup: 0, failed: [] }
      b.lastAt = new Date().toISOString(); b.lastNew = r.added.length; b.err = ''; if (board.name) b.name = board.name
      b.total = Object.values(d.seen).filter(s => s.board === b.name).length
      out.push({ board: b.name, found: pins.length, added: r.added.length, failed: r.failed.length })
    } catch (e) { b.lastAt = new Date().toISOString(); b.err = String(e.message || e).slice(0, 120); out.push({ board: b.name, error: b.err }) }
  }
  await pinSave(d)
  const totalNew = out.reduce((s, x) => s + (x.added || 0), 0)
  if (notify && totalNew) await lineBoss(`Pinterest 新進 ${totalNew} 張圖到素材庫：` + out.filter(x => x.added).map(x => `${x.board} ${x.added} 張`).join('、') + '\n（行銷大師 → 素材庫）')
  return { ok: true, boards: out, totalNew }
}
async function lineBoss(text) {
  try { const tk = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN), boss = clean(process.env.LINE_BOSS_USER) || 'Uf7ce4fb9191cd3055247204e0cb6b4fc'; if (tk && boss) await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' }, body: JSON.stringify({ to: boss, messages: [{ type: 'text', text }] }) }) } catch (_) {}
}
