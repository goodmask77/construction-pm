// ── AI 中樞（張良 2026-10-10「ChatGPT、Claude、Gemini 三家都接，不同功能各選一家，先都接上再選」）──
// 設計原則：
//  1. 全 App 所有 AI 呼叫都走這裡（D哥／行銷大師文案／翻譯／摘要／主App顧問／AI生圖），不再各檔各寫 fetch。
//  2. 每個「功能」(route) 可在 /prep 設定頁各選一家＋模型，存 KV sp_finance_pm_ai_cfg；沒設就吃這裡的預設。
//  3. fail-safe：選的那家壞了（沒金鑰／額度／模型下架）自動退回備援，D哥永遠不會啞掉。
//  4. 訊息格式三家統一：messages=[{role:'user'|'assistant', content: 字串 | [{type:'text',text}|{type:'image',media_type,data(base64)}]}]
//  5. 金鑰只在伺服器端（env），前端永遠拿不到。
import { kvGet, kvSet } from './_onboard.js'

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
      return { ...r, provider: c.provider, model: c.model, tried }
    } catch (e) {
      lastErr = e; tried.push({ provider: c.provider, model: c.model, err: String(e.message || e).slice(0, 200) })
      console.log('[ai]', route, c.provider, c.model, 'failed:', String(e.message || e).slice(0, 200))
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
      return { mime: im.inlineData.mimeType || 'image/png', data: im.inlineData.data, note: ps.map(p => p.text).filter(Boolean).join(' ').slice(0, 300) }
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
      if (it.b64_json) return { mime: 'image/png', data: it.b64_json }
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
    try { const r = await imageOnce(c, opts); return { ...r, provider: c.provider, model: c.model, tried } }
    catch (e) { lastErr = e; tried.push({ provider: c.provider, model: c.model, err: String(e.message || e).slice(0, 200) }); console.log('[ai-img]', c.provider, c.model, 'failed:', String(e.message || e).slice(0, 200)) }
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

// ── 設定頁總覽：每功能目前設定＋三家金鑰狀態 ──
export async function aiOverview() {
  const cfg = await aiCfgGet()
  const providers = {}; for (const [k, v] of Object.entries(AI_PROVIDERS)) providers[k] = { label: v.label, hasKey: hasKey(k), image: !!v.image, env: v.env }
  const routes = Object.entries(AI_ROUTES).map(([key, R]) => ({ key, label: R.label, where: R.where, kind: R.kind, def: R.def, fb: R.fb || null, cur: (cfg.routes || {})[key] || null }))
  const defaults = { text: {}, image: {} }; for (const k of Object.keys(AI_PROVIDERS)) { defaults.text[k] = defaultModel(k, 'text'); defaults.image[k] = defaultModel(k, 'image') }
  return { providers, routes, defaults }
}
