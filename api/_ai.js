// ── AI 中樞（張良 2026-10-10「ChatGPT、Claude、Gemini 三家都接，不同功能各選一家，先都接上再選」）──
// 設計原則：
//  1. 全 App 所有 AI 呼叫都走這裡（D哥／行銷大師文案／翻譯／摘要／主App顧問／AI生圖），不再各檔各寫 fetch。
//  2. 每個「功能」(route) 可在 /prep 設定頁各選一家＋模型，存 KV sp_finance_pm_ai_cfg；沒設就吃這裡的預設。
//  3. fail-safe：選的那家壞了（沒金鑰／額度／模型下架）自動退回備援，D哥永遠不會啞掉。
//  4. 訊息格式三家統一：messages=[{role:'user'|'assistant', content: 字串 | [{type:'text',text}|{type:'image',media_type,data(base64)}]}]
//  5. 金鑰只在伺服器端（env），前端永遠拿不到。
import { kvGet, kvSet, notifyOps } from './_onboard.js'

export const AI_CFG_KEY = 'sp_finance_pm_ai_cfg'
const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()

export const AI_PROVIDERS = {
  anthropic: { label: 'Claude',  env: 'ANTHROPIC_API_KEY', text: 1, image: 0, vision: 1 },
  openai:    { label: 'ChatGPT', env: 'OPENAI_API_KEY',    text: 1, image: 1, vision: 1 },
  gemini:    { label: 'Gemini',  env: 'GEMINI_API_KEY',    text: 1, image: 1, vision: 1 },
}
export const keyOf = (p) => clean(process.env[(AI_PROVIDERS[p] || {}).env || ''])
export const hasKey = (p) => !!keyOf(p)

// 功能路由登記表：label=人看的名稱、where=用在哪、def=預設、fb=備援（預設失敗時）、kind=text|image
// 新功能要用 AI 一律先登記在這裡（設定頁會自動長出來）
export const AI_ROUTES = {
  dd:        { label: 'D哥 LINE 機器人', where: '私訊／群組回答、動作引擎', kind: 'text',
               def: { provider: 'anthropic', model: 'claude-opus-4-8' }, fb: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  social:    { label: '行銷大師 AI 文案', where: '一鍵生成 5 版／分品牌各寫一版（會看圖）', kind: 'text',
               def: { provider: 'anthropic', model: 'claude-sonnet-4-6' }, fb: { provider: 'anthropic', model: 'claude-opus-4-8' } },
  image:     { label: 'AI 生圖', where: '行銷大師素材庫「AI 生圖」（Claude 不會生圖，只能選 Gemini／ChatGPT）', kind: 'image',
               def: { provider: 'gemini', model: 'gemini-nano-banana-2.1' }, fb: { provider: 'gemini', model: 'gemini-3.1-flash-image' } },
  translate: { label: '即時翻譯', where: 'DD 群組「翻譯模式」每句雙向翻', kind: 'text',
               def: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, fb: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  summary:   { label: '對話摘要', where: 'DD 舊對話滾動濃縮（省錢用小模型即可）', kind: 'text',
               def: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, fb: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  app:       { label: '主 App AI 顧問', where: '工程主 App 的 /api/ai（callAI）', kind: 'text',
               def: { provider: 'anthropic', model: 'claude-sonnet-4-6' }, fb: { provider: 'anthropic', model: 'claude-opus-4-8' } },
}

// ── 設定讀寫 ──
export async function aiCfgGet() { try { return (await kvGet(AI_CFG_KEY)) || { routes: {} } } catch (_) { return { routes: {} } } }
export async function aiCfgSet(route, sel, who) {
  if (!AI_ROUTES[route]) throw new Error('未知功能 ' + route)
  const cfg = await aiCfgGet(); cfg.routes = cfg.routes || {}
  if (!sel || !sel.provider) delete cfg.routes[route] // 清掉＝回預設
  else {
    if (!AI_PROVIDERS[sel.provider]) throw new Error('未知供應商 ' + sel.provider)
    if (AI_ROUTES[route].kind === 'image' && !AI_PROVIDERS[sel.provider].image) throw new Error(AI_PROVIDERS[sel.provider].label + ' 不支援生圖')
    cfg.routes[route] = { provider: sel.provider, model: String(sel.model || '').trim().slice(0, 80), by: who || '', at: new Date().toISOString() }
  }
  await kvSet(AI_CFG_KEY, cfg)
  return cfg
}
// 解析某功能現在該用哪家：使用者設定 → 預設；model 空＝該家預設模型
function resolve(route, cfg, override) {
  const R = AI_ROUTES[route] || AI_ROUTES.app
  const cur = override || (cfg && cfg.routes && cfg.routes[route]) || null
  const chain = []
  if (cur && cur.provider) chain.push({ provider: cur.provider, model: cur.model || defaultModel(cur.provider, R.kind) })
  chain.push(R.def); if (R.fb) chain.push(R.fb)
  // 同家備援：使用者選了 X 家但模型壞 → 先試 X 家預設模型，再退到登記的備援
  if (cur && cur.provider && cur.model && cur.model !== defaultModel(cur.provider, R.kind)) chain.splice(1, 0, { provider: cur.provider, model: defaultModel(cur.provider, R.kind) })
  // 去重
  const seen = new Set(); return chain.filter(c => { const k = c.provider + '|' + c.model; if (seen.has(k)) return false; seen.add(k); return true })
}
export function defaultModel(p, kind) {
  if (kind === 'image') return p === 'openai' ? 'gpt-image-2' : p === 'gemini' ? 'gemini-nano-banana-2.1' : '' // 2026-10-10 實測：Gemini 2.5 系列已對新用戶關閉，官方建議 3.8-flash；生圖最新 Nano Banana 2.1
  return p === 'openai' ? 'gpt-5.5' : p === 'gemini' ? 'gemini-3.8-flash' : 'claude-sonnet-4-6'
}

// ── 內容格式轉換 ──
const toArr = (c) => typeof c === 'string' ? [{ type: 'text', text: c }] : (Array.isArray(c) ? c : [{ type: 'text', text: String(c ?? '') }])
const sysText = (s) => Array.isArray(s) ? s.map(x => x.text || '').join('\n') : String(s || '')

function toAnthropic(system, messages, cache) {
  const msgs = messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: toArr(m.content).map(b => b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.media_type, data: b.data } } : { type: 'text', text: b.text || '' }) }))
  const st = sysText(system)
  const sys = st ? (cache ? [{ type: 'text', text: st, cache_control: { type: 'ephemeral' } }] : st) : undefined
  return { sys, msgs }
}
function toOpenAI(system, messages) {
  const out = []
  const st = sysText(system); if (st) out.push({ role: 'system', content: st })
  for (const m of messages) {
    const arr = toArr(m.content)
    const simple = arr.every(b => b.type === 'text')
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: simple ? arr.map(b => b.text || '').join('') : arr.map(b => b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.media_type};base64,${b.data}` } } : { type: 'text', text: b.text || '' }) })
  }
  return out
}
function toGemini(system, messages) {
  const st = sysText(system)
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toArr(m.content).map(b => b.type === 'image' ? { inlineData: { mimeType: b.media_type, data: b.data } } : { text: b.text || '' }) }))
  return { systemInstruction: st ? { parts: [{ text: st }] } : undefined, contents }
}

// ── 三家文字呼叫（單次，不含備援） ──
async function callOnce({ provider, model }, { system, messages, maxTokens, cache, timeoutMs }) {
  const key = keyOf(provider); if (!key) throw Object.assign(new Error(AI_PROVIDERS[provider].label + ' 尚未設定金鑰（' + AI_PROVIDERS[provider].env + '）'), { nokey: true })
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs || 120000)
  try {
    if (provider === 'anthropic') {
      const { sys, msgs } = toAnthropic(system, messages, cache)
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: maxTokens || 3000, ...(sys ? { system: sys } : {}), messages: msgs }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('Claude HTTP ' + r.status)), { status: r.status })
      return { text: (d.content || []).map(b => b.text || '').join('').trim(), usage: d.usage, stop: d.stop_reason, raw: d }
    }
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, max_completion_tokens: maxTokens || 3000, messages: toOpenAI(system, messages) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('ChatGPT HTTP ' + r.status)), { status: r.status })
      const c = d.choices && d.choices[0]
      return { text: String((c && c.message && c.message.content) || '').trim(), usage: d.usage, stop: c && c.finish_reason, raw: d }
    }
    if (provider === 'gemini') {
      const g = toGemini(system, messages)
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ ...(g.systemInstruction ? { systemInstruction: g.systemInstruction } : {}), contents: g.contents, generationConfig: { maxOutputTokens: maxTokens || 3000 } }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('Gemini HTTP ' + r.status)), { status: r.status })
      const cand = d.candidates && d.candidates[0]
      const text = (((cand || {}).content || {}).parts || []).map(p => p.text || '').join('').trim()
      if (!text && cand && cand.finishReason && cand.finishReason !== 'STOP') throw new Error('Gemini 沒有回內容（' + cand.finishReason + '）')
      return { text, usage: d.usageMetadata, stop: cand && cand.finishReason, raw: d }
    }
    throw new Error('未知供應商 ' + provider)
  } finally { clearTimeout(tm) }
}

// ── 對外：文字呼叫（含設定解析＋備援鏈）──
// aiCall('social', { system, messages, maxTokens, cache }) → { text, provider, model, usage, tried:[...] }
// opts.override={provider,model} 直接指定（測試／本機腳本用，跳過 KV 設定）；opts.noFallback=true 不退備援（測試用）
export async function aiCall(route, opts = {}) {
  const cfg = opts.override ? null : await aiCfgGet()
  const chain = opts.noFallback && opts.override ? [opts.override] : resolve(route, cfg, opts.override)
  const tried = []; let lastErr = null
  for (const c of chain) {
    if (!c.model) continue
    try {
      const r = await callOnce(c, opts)
      if (!opts.noLog) await logUsage({ route, provider: c.provider, model: c.model, usage: r.usage, cfg })
      return { ...r, provider: c.provider, model: c.model, tried }
    } catch (e) {
      lastErr = e; tried.push({ provider: c.provider, model: c.model, err: String(e.message || e).slice(0, 200) })
      console.log('[ai]', route, c.provider, c.model, 'failed:', String(e.message || e).slice(0, 200))
      if (!opts.noLog && !e.nokey) await logUsage({ route, provider: c.provider, model: c.model, err: 1, cfg })
    }
  }
  throw Object.assign(new Error((lastErr && lastErr.message) || 'AI 全部失敗'), { tried })
}

// ── 生圖：aiImage('image', { prompt, refImages:[{media_type,data}], aspect:'1:1'|'3:4'|'4:3'|'9:16'|'16:9' }) → { mime, data(base64), provider, model } ──
async function imageOnce({ provider, model }, { prompt, refImages, aspect, timeoutMs }) {
  const key = keyOf(provider); if (!key) throw Object.assign(new Error(AI_PROVIDERS[provider].label + ' 尚未設定金鑰（' + AI_PROVIDERS[provider].env + '）'), { nokey: true })
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeoutMs || 170000)
  try {
    if (provider === 'gemini') {
      const parts = [...(refImages || []).map(im => ({ inlineData: { mimeType: im.media_type, data: im.data } })), { text: prompt }]
      const body = (withAspect) => ({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(withAspect && aspect ? { imageConfig: { aspectRatio: aspect } } : {}) } })
      let r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(true)) })
      let d = await r.json().catch(() => ({}))
      if (!r.ok && aspect && r.status === 400) { // 舊模型不認 imageConfig → 拿掉再試一次
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(false)) })
        d = await r.json().catch(() => ({}))
      }
      if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('Gemini HTTP ' + r.status)), { status: r.status })
      const ps = ((((d.candidates || [])[0] || {}).content || {}).parts || [])
      const im = ps.find(p => p.inlineData && p.inlineData.data)
      if (!im) throw new Error('Gemini 沒有回圖片' + (ps.map(p => p.text).filter(Boolean).join(' ') ? '：' + ps.map(p => p.text).filter(Boolean).join(' ').slice(0, 200) : ''))
      return { mime: im.inlineData.mimeType || 'image/png', data: im.inlineData.data, note: ps.map(p => p.text).filter(Boolean).join(' ').slice(0, 300), usage: d.usageMetadata }
    }
    if (provider === 'openai') {
      const size = aspect === '3:4' || aspect === '9:16' ? '1024x1536' : aspect === '4:3' || aspect === '16:9' ? '1536x1024' : '1024x1024'
      let r
      if (refImages && refImages.length) { // 有參考圖 → edits（多部分表單）
        const fd = new FormData()
        fd.append('model', model); fd.append('prompt', prompt); fd.append('size', size); fd.append('n', '1')
        refImages.slice(0, 4).forEach((im, i) => fd.append('image[]', new Blob([Buffer.from(im.data, 'base64')], { type: im.media_type }), 'ref' + i + '.' + (im.media_type.split('/')[1] || 'png').replace('jpeg', 'jpg')))
        r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal: ctl.signal, headers: { authorization: 'Bearer ' + key }, body: fd })
      } else {
        r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model, prompt, size, n: 1 }) })
      }
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error((d.error && d.error.message) || ('ChatGPT HTTP ' + r.status)), { status: r.status })
      const it = (d.data || [])[0] || {}
      if (it.b64_json) return { mime: 'image/png', data: it.b64_json, usage: d.usage }
      if (it.url) { const ir = await fetch(it.url); const buf = Buffer.from(await ir.arrayBuffer()); return { mime: ir.headers.get('content-type') || 'image/png', data: buf.toString('base64') } }
      throw new Error('ChatGPT 沒有回圖片')
    }
    throw new Error(AI_PROVIDERS[provider] ? AI_PROVIDERS[provider].label + ' 不支援生圖' : '未知供應商 ' + provider)
  } finally { clearTimeout(tm) }
}
export async function aiImage(route, opts = {}) {
  const cfg = opts.override ? null : await aiCfgGet()
  const chain = (opts.noFallback && opts.override ? [opts.override] : resolve(route, cfg, opts.override)).filter(c => AI_PROVIDERS[c.provider] && AI_PROVIDERS[c.provider].image)
  const tried = []; let lastErr = null
  for (const c of chain) {
    if (!c.model) continue
    try { const r = await imageOnce(c, opts); if (!opts.noLog) await logUsage({ route, provider: c.provider, model: c.model, usage: r.usage, img: 1, cfg }); return { ...r, provider: c.provider, model: c.model, tried } }
    catch (e) { lastErr = e; tried.push({ provider: c.provider, model: c.model, err: String(e.message || e).slice(0, 200) }); console.log('[ai-img]', c.provider, c.model, 'failed:', String(e.message || e).slice(0, 200)); if (!opts.noLog && !e.nokey) await logUsage({ route, provider: c.provider, model: c.model, img: 1, err: 1, cfg }) }
  }
  throw Object.assign(new Error((lastErr && lastErr.message) || '生圖全部失敗'), { tried })
}

// ── 列模型（設定頁下拉用，直接問各家現在有哪些）──
export async function aiListModels(provider, kind = 'text') {
  const key = keyOf(provider); if (!key) return { ok: false, error: '尚未設定金鑰', models: [] }
  try {
    if (provider === 'anthropic') {
      if (kind === 'image') return { ok: true, models: [] }
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
      const d = await r.json().catch(() => ({})); if (!r.ok) return { ok: false, error: (d.error && d.error.message) || ('HTTP ' + r.status), models: [] }
      return { ok: true, models: (d.data || []).map(m => ({ id: m.id, label: m.display_name || m.id, at: m.created_at })).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))) }
    }
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + key } })
      const d = await r.json().catch(() => ({})); if (!r.ok) return { ok: false, error: (d.error && d.error.message) || ('HTTP ' + r.status), models: [] }
      const all = (d.data || []).map(m => m.id)
      const isImg = id => /image|dall-e/i.test(id)
      const isText = id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/realtime|audio|tts|transcri|embed|moderation|search|instruct|image|dall|whisper|codex-mini|computer-use|preview-\d/i.test(id)
      const ids = all.filter(kind === 'image' ? isImg : isText).sort((a, b) => b.localeCompare(a))
      return { ok: true, models: ids.map(id => ({ id, label: id })) }
    }
    if (provider === 'gemini') {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })
      const d = await r.json().catch(() => ({})); if (!r.ok) return { ok: false, error: (d.error && d.error.message) || ('HTTP ' + r.status), models: [] }
      const ms = (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini/.test(m.name))
      const pick = ms.filter(m => kind === 'image' ? /image|nano-banana/i.test(m.name) : !/image|nano-banana|tts|audio|embedding|live|transcribe|robotics|computer-use/i.test(m.name))
      return { ok: true, models: pick.map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name })).sort((a, b) => b.id.localeCompare(a.id)) }
    }
    return { ok: false, error: '未知供應商', models: [] }
  } catch (e) { return { ok: false, error: e.message || '連線失敗', models: [] } }
}


// ══════════════════════════════════════════════════════════════════════
// 用量記帳（v4.70.30 張良 2026-10-10「每個 AI API 能不能顯示即時用量與額度」）
// 各家官方沒有可靠的「剩餘額度」API → 自己算：每次呼叫記 token → 單價表估金額 → 張良填「儲值」→ 估剩多少／撐幾天；剩 20%/10% D哥私訊提醒
// 月檔 pm_ai_usage_YYYY-MM = { days: { 'YYYY-MM-DD': { 'provider|model|route': { n, it, ot, cr, cw, img, usd, err } } } }（每日聚合，小而快）
// 單價表 AI_PRICES（USD／百萬 token；img＝每張）：預設值＝依公開定價估，可在設定頁改（cfg.prices 覆蓋）；匯率 cfg.usdTwd 預設 32
// ══════════════════════════════════════════════════════════════════════
export const AI_PRICES = { // key 用「前綴」比對（最長前綴優先）；cr=快取讀、cw=快取寫（沒填＝cr 0.1×in、cw 1.25×in）
  'claude-opus-4':    { in: 5,    out: 25 },
  'claude-sonnet-4':  { in: 3,    out: 15 },
  'claude-haiku-4':   { in: 1,    out: 5 },
  'gpt-5.5':          { in: 1.25, out: 10 },
  'gpt-5':            { in: 1.25, out: 10 },
  'gpt-5-mini':       { in: 0.25, out: 2 },
  'gpt-5-nano':       { in: 0.05, out: 0.4 },
  'gpt-4.1':          { in: 2,    out: 8 },
  'gpt-4o':           { in: 2.5,  out: 10 },
  'gemini-3.8-flash': { in: 0.3,  out: 2.5 },
  'gemini-3.5-flash': { in: 0.3,  out: 2.5 },
  'gemini-3.1-flash-lite': { in: 0.1, out: 0.4 },
  'gemini-3.1-pro':   { in: 2,    out: 12 },
  'gemini-2.5-flash': { in: 0.3,  out: 2.5 },
  'gemini-2.5-pro':   { in: 1.25, out: 10 },
  'gemini-nano-banana-2.1': { in: 1.5, out: 0, img: 0.04 },
  'gemini-3.1-flash-image': { in: 0.3, out: 0, img: 0.04 },
  'gemini-3-pro-image':     { in: 2,   out: 0, img: 0.13 },
  'gemini-2.5-flash-image': { in: 0.3, out: 0, img: 0.039 },
  'gpt-image-2':      { in: 5, out: 0, img: 0.04 },
  'gpt-image-1':      { in: 5, out: 0, img: 0.04 },
}
const PROV_DEFAULT_PRICE = { anthropic: { in: 3, out: 15 }, openai: { in: 1.25, out: 10 }, gemini: { in: 0.3, out: 2.5 } }
export function priceOf(model, provider, prices) {
  const tbl = { ...AI_PRICES, ...(prices || {}) }
  let best = null
  for (const k of Object.keys(tbl)) if (String(model || '').startsWith(k) && (!best || k.length > best.length)) best = k
  const p = best ? tbl[best] : (PROV_DEFAULT_PRICE[provider] || { in: 1, out: 5 })
  return { key: best || '(預設)', in: +p.in || 0, out: +p.out || 0, cr: p.cr != null ? +p.cr : (+p.in || 0) * 0.1, cw: p.cw != null ? +p.cw : (+p.in || 0) * 1.25, img: +p.img || 0 }
}
// 三家 usage 轉成統一 {it, ot, cr, cw}
function normUsage(provider, u) {
  u = u || {}
  if (provider === 'anthropic') return { it: +u.input_tokens || 0, ot: +u.output_tokens || 0, cr: +u.cache_read_input_tokens || 0, cw: +u.cache_creation_input_tokens || 0 }
  if (provider === 'openai') { const cr = +((u.prompt_tokens_details || {}).cached_tokens) || 0; return { it: Math.max(0, (+u.prompt_tokens || +u.input_tokens || 0) - cr), ot: +u.completion_tokens || +u.output_tokens || 0, cr, cw: 0 } }
  if (provider === 'gemini') { const cr = +u.cachedContentTokenCount || 0; return { it: Math.max(0, (+u.promptTokenCount || 0) - cr), ot: (+u.candidatesTokenCount || 0) + (+u.thoughtsTokenCount || 0), cr, cw: 0 } }
  return { it: 0, ot: 0, cr: 0, cw: 0 }
}
const tpeDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10)
const usageKey = (ym) => 'pm_ai_usage_' + ym
export function estUsd(provider, model, n, imgN, prices) {
  const pr = priceOf(model, provider, prices)
  return (n.it * pr.in + n.ot * pr.out + n.cr * pr.cr + n.cw * pr.cw) / 1e6 + (imgN || 0) * pr.img
}
// 記一筆（成功或失敗都記；失敗 usd=0）。await 它（約 100ms），serverless 不能 fire-and-forget
async function logUsage({ route, provider, model, usage, img, err, cfg }) {
  try {
    const n = normUsage(provider, usage)
    const usd = err ? 0 : estUsd(provider, model, n, img ? 1 : 0, (cfg || {}).prices)
    const day = tpeDate(); const ym = day.slice(0, 7); const key = usageKey(ym)
    const doc = (await kvGet(key)) || { days: {} }
    doc.days = doc.days || {}; const d = doc.days[day] = doc.days[day] || {}
    const k = provider + '|' + model + '|' + route
    const c = d[k] = d[k] || { n: 0, it: 0, ot: 0, cr: 0, cw: 0, img: 0, usd: 0, err: 0 }
    c.n++; c.it += n.it; c.ot += n.ot; c.cr += n.cr; c.cw += n.cw; if (img && !err) c.img++; c.usd += usd; if (err) c.err++
    doc.updatedAt = new Date().toISOString()
    await kvSet(key, doc)
    if (!err && usd > 0) await budgetAlert(provider, cfg)
  } catch (e) { console.log('[ai-usage] log failed', e.message) }
}
// 讀 N 個月的用量（含本月），回每月檔
async function readUsageMonths(months = 3) {
  const now = new Date(Date.now() + 8 * 3600e3); const out = {}
  for (let i = 0; i < months; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); const ym = d.toISOString().slice(0, 7); out[ym] = (await kvGet(usageKey(ym))) || { days: {} } } // 用 UTC 建月份避免本機時區退一天
  return out
}
// 某家自 since 起累計花費（USD）
function spentSince(monthsDoc, provider, since) {
  let usd = 0
  for (const doc of Object.values(monthsDoc)) for (const [day, m] of Object.entries(doc.days || {})) { if (since && day < since) continue; for (const [k, c] of Object.entries(m)) if (k.split('|')[0] === provider) usd += c.usd || 0 }
  return usd
}
// 剩 20%／10% 各提醒一次（旗標存 cfg.budget[p].alerted；加值改 since/amount 時會重置）
async function budgetAlert(provider, cfg) {
  try {
    cfg = cfg || await aiCfgGet()
    const b = (cfg.budget || {})[provider]; if (!b || !(+b.amount > 0)) return
    const rate = +cfg.usdTwd || 32
    const months = await readUsageMonths(3)
    const spentUsd = spentSince(months, provider, b.since)
    const spent = b.currency === 'USD' ? spentUsd : spentUsd * rate
    const left = +b.amount - spent; const ratio = left / +b.amount
    const lvl = ratio <= 0.1 ? 10 : ratio <= 0.2 ? 20 : 0
    if (!lvl || (b.alerted || 0) <= lvl && b.alerted) return
    b.alerted = lvl; cfg.budget[provider] = b; await kvSet(AI_CFG_KEY, cfg)
    const nm = (AI_PROVIDERS[provider] || {}).label || provider
    await notifyOps(`AI 額度提醒：${nm} 的 API 儲值估計只剩 ${Math.round(ratio * 100)}%（約 ${b.currency === 'USD' ? 'US$' : 'NT$'}${Math.round(left)}）。用完 App 會自動退到備援家，但建議提早加值。加值後到 /prep 設定 →「AI 模型」更新儲值金額。`)
  } catch (_) {}
}
// 設定頁儀表板：本月／今天 每家每功能 次數＋估算費用、儲值與估剩、撐幾天
export async function aiUsageSummary() {
  const cfg = await aiCfgGet(); const rate = +cfg.usdTwd || 32
  const months = await readUsageMonths(3)
  const today = tpeDate(); const ym = today.slice(0, 7)
  const cur = months[ym] || { days: {} }
  const byProv = {}, byRoute = {}, byModel = {}, todayP = {}
  const add = (o, k, c) => { const t = o[k] = o[k] || { n: 0, usd: 0, it: 0, ot: 0, img: 0, err: 0 }; t.n += c.n; t.usd += c.usd; t.it += c.it + (c.cr || 0) + (c.cw || 0); t.ot += c.ot; t.img += c.img || 0; t.err += c.err || 0 }
  const daysUsed = Object.keys(cur.days || {}).length
  for (const [day, m] of Object.entries(cur.days || {})) for (const [k, c] of Object.entries(m)) { const [p, model, r] = k.split('|'); add(byProv, p, c); add(byRoute, r, c); add(byModel, p + '|' + model, c); if (day === today) add(todayP, p, c) }
  // 近 7 天日均（跨月也算）→ 撐幾天
  const dayTot = {}
  for (const doc of Object.values(months)) for (const [day, m] of Object.entries(doc.days || {})) for (const [k, c] of Object.entries(m)) { const p = k.split('|')[0]; dayTot[p] = dayTot[p] || {}; dayTot[p][day] = (dayTot[p][day] || 0) + (c.usd || 0) }
  const providers = {}
  for (const p of Object.keys(AI_PROVIDERS)) {
    const b = (cfg.budget || {})[p] || null
    const last7 = Object.entries(dayTot[p] || {}).sort((a, b2) => b2[0].localeCompare(a[0])).slice(0, 7)
    const avg7 = last7.length ? last7.reduce((s, x) => s + x[1], 0) / Math.max(1, last7.length) : 0
    let budget = null
    if (b && +b.amount > 0) {
      const spentUsd = spentSince(months, p, b.since)
      const spent = b.currency === 'USD' ? spentUsd : spentUsd * rate
      const left = +b.amount - spent
      const avgIn = b.currency === 'USD' ? avg7 : avg7 * rate
      budget = { amount: +b.amount, currency: b.currency || 'TWD', since: b.since || '', spent: Math.round(spent * 100) / 100, left: Math.round(left * 100) / 100, pct: Math.round(left / +b.amount * 100), daysLeft: avgIn > 0 ? Math.round(left / avgIn) : null }
    }
    providers[p] = { label: AI_PROVIDERS[p].label, month: byProv[p] || { n: 0, usd: 0, it: 0, ot: 0, img: 0, err: 0 }, today: todayP[p] || { n: 0, usd: 0 }, avg7Usd: Math.round(avg7 * 10000) / 10000, budget }
  }
  const routes = {}; for (const [r, c] of Object.entries(byRoute)) routes[r] = { label: (AI_ROUTES[r] || {}).label || r, ...c }
  const models = Object.entries(byModel).map(([k, c]) => { const [p, m] = k.split('|'); const pr = priceOf(m, p, cfg.prices); return { provider: p, model: m, ...c, price: pr } })
  return { ym, today, daysUsed, rate, providers, routes, models, prices: cfg.prices || {}, links: { anthropic: 'https://console.anthropic.com/settings/billing', openai: 'https://platform.openai.com/usage', gemini: 'https://aistudio.google.com/usage' } }
}
// 設定：儲值／單價／匯率（審核人限定，mail-sync 守門）
export async function aiBudgetSet(op, b, who) {
  const cfg = await aiCfgGet()
  if (op === 'budget') {
    if (!AI_PROVIDERS[b.provider]) throw new Error('未知供應商')
    cfg.budget = cfg.budget || {}
    if (!(+b.amount > 0)) delete cfg.budget[b.provider]
    else cfg.budget[b.provider] = { amount: +b.amount, currency: b.currency === 'USD' ? 'USD' : 'TWD', since: /^\d{4}-\d{2}-\d{2}$/.test(b.since || '') ? b.since : tpeDate(), alerted: 0, by: who, at: new Date().toISOString() }
  } else if (op === 'price') {
    const m = String(b.model || '').trim().slice(0, 80); if (!m) throw new Error('缺模型')
    cfg.prices = cfg.prices || {}
    if (b.reset) delete cfg.prices[m]
    else cfg.prices[m] = { in: +b.in || 0, out: +b.out || 0, ...(b.img != null ? { img: +b.img || 0 } : {}) }
  } else if (op === 'rate') {
    if (!(+b.usdTwd > 0)) throw new Error('匯率要大於 0'); cfg.usdTwd = +b.usdTwd
  } else throw new Error('未知操作')
  await kvSet(AI_CFG_KEY, cfg); return cfg
}

// ── 設定頁總覽：每功能目前設定＋三家金鑰狀態 ──
export async function aiOverview() {
  const cfg = await aiCfgGet()
  const providers = {}; for (const [k, v] of Object.entries(AI_PROVIDERS)) providers[k] = { label: v.label, hasKey: hasKey(k), image: !!v.image, env: v.env }
  const routes = Object.entries(AI_ROUTES).map(([key, R]) => ({ key, label: R.label, where: R.where, kind: R.kind, def: R.def, fb: R.fb || null, cur: (cfg.routes || {})[key] || null }))
  const defaults = { text: {}, image: {} }; for (const k of Object.keys(AI_PROVIDERS)) { defaults.text[k] = defaultModel(k, 'text'); defaults.image[k] = defaultModel(k, 'image') }
  return { providers, routes, defaults }
}
