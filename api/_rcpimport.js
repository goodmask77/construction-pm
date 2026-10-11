// ── 食譜 AI 匯入（v4.70.66，2026-10-12；張良「新增食譜讓我直接截圖／丟檔案／連結，app 幫我讀取新增；既有物料、半成品直接連接，沒有的給我確認按鈕」）──
//   流程：截圖（≤4 張）／文字（CSV、貼上）／連結（Google 試算表→CSV、網頁→純文字、圖片網址）→ AI 讀成結構（名稱、產量、材料行、步驟）
//         → 伺服器端把每行材料對到「半成品食譜（阿桑 /recipes＋自建）」或「物料卡（供應品代碼）」：完全相同自動對；相近給候選；對不到＝待補
//         → 回前端審核：人改對應／按「新增為半成品」／確認 → 才真的建草稿（本檔不寫任何資料，只讀＋算）
//   規格邊界：物料卡的供應品來自阿桑主檔（§3），這裡不能憑空建物料卡；對不到的原料只能標「待補」留在草稿，發布時會被擋（既有規則）。
import { buildRecipes } from './_recipe.js'
import { buildCards } from './_matcard.js'
import { aiCall } from './_ai.js'

const MAX_IMG = 4, MAX_TEXT = 40000
const toHalf = s => String(s || '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ')
export const nk = s => toHalf(s).toLowerCase().replace(/[\s\-_–—·・,，。.()（）\[\]【】/／\\'"`*＊+＋&＆:：;；!！?？#＃%％~～]/g, '')
const stripParen = s => String(s || '').replace(/[（(][^（）()]*[)）]/g, '').trim()
const bigrams = s => { const o = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); o.set(g, (o.get(g) || 0) + 1) } return o }
function dice (a, b) {
  if (!a || !b) return 0; if (a === b) return 1
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const A = bigrams(a), B = bigrams(b); let hit = 0
  for (const [g, n] of A) if (B.has(g)) hit += Math.min(n, B.get(g))
  return (2 * hit) / ((a.length - 1) + (b.length - 1))
}
function score (q, cand) { // q、cand 都已 nk
  if (!q || !cand) return 0
  if (q === cand) return 1
  if (cand.includes(q) || q.includes(cand)) { const r = Math.min(q.length, cand.length) / Math.max(q.length, cand.length); return 0.72 + 0.26 * r }
  return dice(q, cand) * 0.95
}

// ── 候選目錄：半成品食譜＋物料卡（含每個供應品的品名／代碼／料號）──
async function catalog ({ kvGet, months }) {
  const [t, cards] = await Promise.all([buildRecipes({ kvGet, months, light: true }), buildCards({ kvGet, months })])
  const out = [] // { kind:'recipe'|'card', code, label, sub, keys:[nk…], cardId?, recipeKey? }
  for (const r of t.recipes || []) { if (!r.code && !r.key) continue; out.push({ kind: 'recipe', code: r.code || r.key, label: r.name, sub: (r.type === 'dish' ? '餐點' : '半成品') + (r.station ? '・' + r.station : '') + (r.src === 'own' ? '・自建' : ''), recipeKey: r.key, keys: [nk(r.name), nk(stripParen(r.name)), nk(r.code)].filter(Boolean) }) }
  const sup = k => (cards.supplies || {})[k]
  for (const c of cards.cards || []) {
    if (c.status === '停用') continue
    const pri = sup(c.primary) || sup((c.supplies || [])[0]) || {}
    const code = pri.code || c.displaySku; if (!code) continue
    const keys = [nk(c.name), nk(stripParen(c.name)), nk(c.displaySku)]
    for (const k of c.supplies || []) { const s = sup(k); if (s) keys.push(nk(s.name), nk(stripParen(s.name)), nk(s.code), nk(s.sku)) }
    out.push({ kind: 'card', code, label: c.name, sub: '物料卡 ' + (c.displaySku || '') + (pri.supplier ? '・' + pri.supplier : '') + (c.baseUnit ? '・' + c.baseUnit : ''), cardId: c.id, baseUnit: c.baseUnit || '', keys: [...new Set(keys.filter(Boolean))] })
  }
  return out
}
export function matchName (name, cat) {
  const q1 = nk(name), q2 = nk(stripParen(name))
  const scored = []
  for (const c of cat) { let best = 0; for (const k of c.keys) { best = Math.max(best, score(q1, k), q2 !== q1 ? score(q2, k) * 0.97 : 0) }; if (best >= 0.4) scored.push({ ...c, keys: undefined, score: Math.round(best * 100) / 100 }) }
  scored.sort((a, b) => b.score - a.score || (a.kind === 'recipe' ? -1 : 1))
  const top = scored.slice(0, 5)
  const auto = top[0] && top[0].score >= 0.86 && (!top[1] || top[1].score < top[0].score - 0.03 || top[1].code === top[0].code) ? top[0] : null
  return { match: auto, candidates: top }
}

// ── 來源整理：連結 → 文字或圖片 ──
async function fetchUrl (url) {
  let u = String(url || '').trim(); if (!/^https?:\/\//i.test(u)) throw new Error('連結要以 http(s):// 開頭')
  const gs = u.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  if (gs) { const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1]; u = `https://docs.google.com/spreadsheets/d/${gs[1]}/export?format=csv${gid ? '&gid=' + gid : ''}` }
  const gd = u.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/)
  if (gd) u = `https://docs.google.com/document/d/${gd[1]}/export?format=txt`
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (GD-prep recipe import)' } })
    if (!r.ok) throw new Error('連結打不開（HTTP ' + r.status + '）' + (gs || gd ? '：Google 檔案要先設「知道連結的人可檢視」' : ''))
    const ct = String(r.headers.get('content-type') || '').toLowerCase()
    if (ct.startsWith('image/')) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 5e6) throw new Error('圖片太大（>5MB），請截圖後貼上'); return { img: { media_type: ct.split(';')[0], data: buf.toString('base64') } } }
    let text = await r.text()
    if (ct.includes('html')) {
      if (/accounts\.google\.com|ServiceLogin/i.test(r.url || '')) throw new Error('Google 檔案要登入才看得到：請把分享設成「知道連結的人可檢視」，或直接截圖貼上')
      text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(tr|p|div|li|h\d|br)>/gi, '\n').replace(/<\/(td|th)>/gi, '\t').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
    }
    if (!text.trim()) throw new Error('連結裡讀不到文字')
    return { text: text.slice(0, MAX_TEXT), src: gs ? 'Google 試算表' : gd ? 'Google 文件' : '網頁' }
  } finally { clearTimeout(tm) }
}
const parseDataUrl = s => { const m = String(s || '').match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i); return m ? { media_type: m[1].toLowerCase().replace('jpg', 'jpeg'), data: m[2] } : null }

const SYS = `你是餐飲中央廚房的食譜資料員。使用者會給你食譜的截圖、試算表文字或網頁內容（繁體中文為主，可能夾英文）。
請把它整理成一份食譜的結構化 JSON，只輸出 JSON，不要任何說明或 markdown 圍欄：
{
 "name": "食譜名稱（表頭或標題；沒有就用最像的）",
 "type": "dish 或 prep（dish＝出餐餐點／組裝一份給客人；prep＝備料半成品／醬料／一批做很多）",
 "station": "工作站或品類（Pizza／內場／吧台／沙拉…看得出來才填，否則空字串）",
 "yieldQty": 數字或null（prep＝整批產量／每份總重；dish 通常 1）,
 "yieldUnit": "g／ml／份／個…（看表上的單位）",
 "items": [ { "name": "材料名稱（原文照抄，保留括號註記）", "qty": 數字, "unit": "g／ml／片／個／半片…原文單位", "costHint": 表上若有成本金額就填數字否則null } ],
 "steps": [ { "title": "一句話標題（≤20字）", "desc": "完整說明（原文）", "timerSec": 若步驟明確寫計時幾分幾秒就換算成秒否則0 } ],
 "notes": "備註／保存說明／其他看到但放不進上面的資訊",
 "confidence": 0到1
}
規則：
- 「每份總重／每份成本／合計」那種總結列不是材料，拿掉；總重可當 yieldQty。
- 數量只填數字（"1/2" 寫 0.5）；單位保留原文（「半片」就寫「半片」，qty 填 1）。
- 步驟若是「1. …」「2. …」編號文字，一條一個；沒有步驟就給空陣列。不要自己編造材料或步驟。
- 同一材料出現兩次（例如「另附」）各自保留一行。`

export async function importRecipe ({ kvGet, months, body, who }) {
  const content = []
  const imgs = (Array.isArray(body.imgs) ? body.imgs : []).slice(0, MAX_IMG).map(parseDataUrl).filter(Boolean)
  let text = String(body.text || '').slice(0, MAX_TEXT), srcNote = []
  if (body.url) { const f = await fetchUrl(body.url); if (f.img) imgs.push(f.img); else { text = (text ? text + '\n\n' : '') + '【' + f.src + '內容】\n' + f.text; srcNote.push(f.src) } }
  if (!imgs.length && !text.trim()) throw new Error('請貼截圖、選檔案、貼文字或連結其中一種')
  for (const im of imgs) content.push({ type: 'image', media_type: im.media_type, data: im.data })
  content.push({ type: 'text', text: (text.trim() ? '以下是食譜內容：\n' + text + '\n\n' : '') + (imgs.length ? `上面 ${imgs.length} 張圖是食譜截圖，請整張看完（表格每一列都要）。` : '') + (body.hint ? '\n使用者補充：' + String(body.hint).slice(0, 300) : '') + '\n請輸出 JSON。' })
  const r = await aiCall('rcpimport', { system: SYS, messages: [{ role: 'user', content }], maxTokens: 4000, timeoutMs: 90000 })
  let parsed = null
  try { const t = String(r.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''); parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch (_) { throw new Error('AI 讀出來的不是可用格式，請換清楚一點的截圖再試一次') }
  const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 80).map(i => ({ name: String(i.name || '').trim().slice(0, 80), qty: Number(i.qty) || 0, unit: String(i.unit || '').trim().slice(0, 10), costHint: i.costHint == null ? null : Number(i.costHint) })).filter(i => i.name)
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 60).map(s => ({ title: String(s.title || '').trim().slice(0, 80), desc: String(s.desc || '').trim().slice(0, 1500), timerSec: Math.max(0, Math.min(86400, Number(s.timerSec) || 0)) })).filter(s => s.title || s.desc)
  const cat = await catalog({ kvGet, months })
  const myName = nk(parsed.name || '')
  for (const it of items) { const m = matchName(it.name, cat.filter(c => !(c.kind === 'recipe' && c.keys.includes(myName) && myName))); it.match = m.match; it.candidates = m.candidates }
  const dup = cat.find(c => c.kind === 'recipe' && myName && c.keys.includes(myName))
  return {
    ok: true,
    parsed: { name: String(parsed.name || '').slice(0, 80), type: parsed.type === 'prep' ? 'prep' : 'dish', station: String(parsed.station || '').slice(0, 30), yieldQty: parsed.yieldQty == null ? null : Number(parsed.yieldQty), yieldUnit: String(parsed.yieldUnit || '').slice(0, 10), items, steps, notes: String(parsed.notes || '').slice(0, 600), confidence: Number(parsed.confidence) || null },
    dupOf: dup ? { key: dup.recipeKey, label: dup.label } : null,
    src: { imgs: imgs.length, text: text.trim().length, note: srcNote.join('、') },
    ai: { provider: r.provider, model: r.model },
    stats: { matched: items.filter(i => i.match).length, suggest: items.filter(i => !i.match && i.candidates.length).length, none: items.filter(i => !i.match && !i.candidates.length).length }
  }
}
