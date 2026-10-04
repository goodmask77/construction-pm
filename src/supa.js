// 共用後端 + window.storage 墊片
// 新版 App 大量使用 claude.ai 的 window.storage API。這裡用 Supabase（共享資料，
// 公開協作）+ localStorage（個人設定，如 pm_role）提供相同介面，讓 App 幾乎原封不動就能跑。
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// auth.lock：用「同分頁內排隊」的記憶體鎖，取代瀏覽器跨分頁 Web Lock。
// 好處：① 同一分頁的權杖刷新會排隊、不會同時搶著刷新而打架 ② 不跨分頁，所以某個卡住的分頁不會鎖死其他分頁。
let _authChain = Promise.resolve()
const inTabLock = (_name, _acquireTimeout, fn) => {
  const run = _authChain.then(() => fn(), () => fn())
  _authChain = run.then(() => {}, () => {})
  return run
}
// 登入用 client（帶 session / 權杖，給帳號/權限）
export const supabase = url && key ? createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: inTabLock,
  },
}) : null

// ── 登入權杖快取（RLS 上鎖準備，2026-07-18）─────────────────────────────────
// RLS 上鎖後「沒登入＝讀不到」，所以讀取請求必須帶登入者的權杖。
// 這裡把主 client 的 session 權杖快取一份：讀取 client 每個請求都帶上（登入者），沒登入＝退回 anon。
let _token = null
let _resolveRestored = () => {}
// 開站第一批讀取要等「session 從瀏覽器還原完」再發，否則已登入的人第一批會用 anon 打（上鎖後=空白）。
// 保險絲：2.5 秒沒還原完就照常發（避免 auth 卡住整站白畫面）。
const sessionRestored = supabase
  ? Promise.race([new Promise(r => { _resolveRestored = r }), new Promise(r => setTimeout(r, 2500))])
  : Promise.resolve()
if (supabase) supabase.auth.onAuthStateChange((_e, s) => { _token = s?.access_token || null; _resolveRestored() })
export const hasSession = () => !!_token
export const getToken = () => _token // v4.44.0 推播金鑰洞修補：/api/push 改驗登入權杖，前端取 JWT 用

// 資料「讀取」用 client：不過 auth 鎖 → 請求可真正並發，載入快。
// accessToken：每個請求動態帶登入權杖（authenticated 角色）；沒登入回 null＝退回 anon key。
const dataClient = url && key ? createClient(url, key, {
  accessToken: async () => { await sessionRestored; return _token },
}) : null

// 圖片上傳專用 client：維持純 anon（bucket 政策不動，登入與否上傳行為一致）
const mediaClient = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null

// 資料「寫入」一律走帶 session 的 supabase（登入者＝authenticated 角色）→ RLS 才擋得住外人亂改。
// 沒登入時這個 client 是 anon 角色，RLS 會擋下寫入（本來訪客就不能改，符合預期）。
const writeDB = () => supabase || dataClient

export const CLIENT_ID =
  Math.random().toString(36).slice(2) + Date.now().toString(36)


// ── OPS 代理模式（2026-10-02 /prep×任務中心整併）：window.__OPS_PROXY__={key,token} 有設時，
// 共用儲存全改走 mail-sync?kvproxy（OPS金鑰＋綁定者守門），讓無登入的 /prep 也能跑主App元件；主App沒旗標＝原路不動 ──
const _OPS = () => (typeof window !== 'undefined' && window.__OPS_PROXY__) || null
async function _opsKV(body) {
  const o = _OPS()
  const r = await fetch('/api/mail-sync?kvproxy=' + encodeURIComponent(o.key), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, token: o.token }) })
  return await r.json().catch(() => ({ ok: false }))
}

// shared=true → 全體協作者共用（Supabase）；shared=false → 本機個人（localStorage）
async function getShared(k) {
  if (_OPS()) { const r = await _opsKV({ op: 'get', key: k }); return r && r.value != null ? { value: r.value } : null }
  if (!dataClient) {
    const v = localStorage.getItem(k)
    return v != null ? { value: v } : null
  }
  try {
    const { data } = await dataClient
      .from('pm_documents').select('data').eq('id', k).maybeSingle()
    if (data && data.data && typeof data.data.v === 'string') return { value: data.data.v }
  } catch (_) {}
  return null
}

// 一次抓多個 key（用 id in (...)）→ 把開啟時十幾個請求合併成「一個」請求，大幅減少往返與伺服器負擔。
export async function getSharedMany(keys) {
  if (!dataClient) {
    const out = {}; keys.forEach(k => { const v = localStorage.getItem(k); if (v != null) out[k] = v; }); return out;
  }
  try {
    const { data } = await dataClient.from('pm_documents').select('id,data').in('id', keys);
    const out = {};
    (data || []).forEach(row => { if (row && row.data && typeof row.data.v === 'string') out[row.id] = row.data.v; });
    return out;
  } catch (_) { return {}; }
}

// 前綴掃描：一次抓「prefix 開頭」的所有文件（逐筆存集合用：一筆交易/任務＝一份文件）
export async function getSharedPrefix(prefix) {
  if (_OPS()) { const r = await _opsKV({ op: 'getPrefix', key: prefix }); return (r && r.rows) || {} }
  if (!dataClient) {
    const out = {}
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) out[k] = localStorage.getItem(k) } } catch (_) {}
    return out
  }
  try {
    // SQL LIKE 的 _ 也是萬用字元（2026-07-18 遷移實測抓到：pm_task_% 誤匹配 pm_tasks）→ 底線要跳脫
    const pattern = prefix.replace(/[\\%_]/g, (m) => '\\' + m) + '%'
    const { data } = await dataClient.from('pm_documents').select('id,data').like('id', pattern)
    const out = {}
    ;(data || []).forEach(row => { if (row && row.data && typeof row.data.v === 'string') out[row.id] = row.data.v })
    return out
  } catch (_) { return {} }
}

// 批次寫入（逐筆遷移/批量匯入用）：一次 upsert 多筆，分包避免單一請求過大。回傳是否全部成功。
export async function setSharedMany(pairs) {
  if (!pairs?.length) return true
  if (_OPS()) { for (const [k, v] of pairs) { const r = await _opsKV({ op: 'set', key: k, value: v }); if (!r || !r.ok) return false } return true }
  if (!dataClient) { try { pairs.forEach(([k, v]) => localStorage.setItem(k, v)) } catch (_) {} ; return true }
  const now = new Date().toISOString()
  for (let i = 0; i < pairs.length; i += 100) {
    const rows = pairs.slice(i, i + 100).map(([k, v]) => ({ id: k, data: { v }, editor: CLIENT_ID, updated_at: now }))
    try {
      const { error } = await writeDB().from('pm_documents').upsert(rows)
      if (error) { console.warn('[storage] 批次寫入失敗', error.message || error); return false }
    } catch (e) { console.warn('[storage] 批次寫入例外', e?.message); return false }
  }
  return true
}

// 全部文件 id 清單（AI 資料總目錄用）；帶登入權杖，上鎖後照常可用
export async function listSharedIds() {
  if (!dataClient) return []
  try {
    const { data } = await dataClient.from('pm_documents').select('id').order('id')
    return (data || []).map(r => r.id)
  } catch (_) { return [] }
}

async function setShared(k, value) {
  if (_OPS()) { await _opsKV({ op: 'set', key: k, value }); return }
  if (!dataClient) { try { localStorage.setItem(k, value) } catch (_) {} ; return }
  try {
    const { error } = await writeDB().from('pm_documents').upsert({
      id: k,
      data: { v: value },
      editor: CLIENT_ID,
      updated_at: new Date().toISOString(),
    })
    if (error) console.warn('[storage] 寫入失敗', k, error.message || error) // RLS 擋下或未登入時會在這
    else announce(k, false) // 寫入成功 → 廣播給其他開著的人即時更新
  } catch (e) { console.warn('[storage] 寫入例外', k, e?.message) }
}

function getLocal(k) {
  const v = localStorage.getItem(k)
  return v != null ? { value: v } : null
}
function setLocal(k, value) {
  try { localStorage.setItem(k, value) } catch (_) {}
}

// ── 圖片儲存（Supabase Storage，bucket: photos）──────────────────────────────
const PHOTO_BUCKET = 'photos';
export async function uploadPhoto(file) {
  if (!mediaClient) throw new Error('Supabase 未設定');
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await mediaClient.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data } = mediaClient.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}
export async function deletePhotoFile(path) {
  if (!mediaClient || !path) return;
  try { await mediaClient.storage.from(PHOTO_BUCKET).remove([path]); } catch (_) {}
}

// ── 畫面即時同步（2026-07-18）────────────────────────────────────────────────
// 做法：誰寫入成功就在共用廣播頻道喊一聲「key 變了」（只送 key 名，不送內容，量極小）；
// 其他開著的裝置聽到後「重新抓那個 key」再更新畫面。不用 postgres_changes（免貼 SQL、
// 不會把整包大 JSON 廣播給所有人）。自己這台寫的（CLIENT_ID 相同）不理會。
let _syncCh = null, _syncReady = false
const _watchers = new Set()          // { pattern, cb }；pattern 結尾 '*' ＝前綴比對
const _remoteT = new Map()           // key → debounce timer（連續變更收斂成一次重抓）
function ensureSync() {
  if (_syncCh || !supabase) return
  try {
    _syncCh = supabase.channel('pm-doc-sync', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'doc' }, ({ payload }) => {
        if (!payload?.key || payload.editor === CLIENT_ID) return
        _handleRemote(payload.key)
      })
      .subscribe((status) => { _syncReady = status === 'SUBSCRIBED' })
  } catch (_) {}
}
function announce(key, deleted) {
  try { if (_syncReady && _syncCh) _syncCh.send({ type: 'broadcast', event: 'doc', payload: { key, deleted: !!deleted, editor: CLIENT_ID } }) } catch (_) {}
}
function _handleRemote(key) {
  if (![..._watchers].some(w => w.pattern.endsWith('*') ? key.startsWith(w.pattern.slice(0, -1)) : key === w.pattern)) return
  clearTimeout(_remoteT.get(key))
  _remoteT.set(key, setTimeout(async () => {
    _remoteT.delete(key)
    if (_pend.has(key)) return // 自己正在編這個 key（還沒存完）→ 不讓遠端蓋掉手上的輸入
    const r = await getShared(key)
    const v = r ? r.value : null // null＝被刪除
    _watchers.forEach(w => { try { if (w.pattern.endsWith('*') ? key.startsWith(w.pattern.slice(0, -1)) : key === w.pattern) w.cb(key, v) } catch (_) {} })
  }, 300))
}
// 訂閱：pattern＝完整 key，或 'prefix*'（逐筆存集合）。回呼收 (key, 字串值|null=已刪)。回傳退訂函式。
export function onSharedChange(pattern, cb) {
  if (_OPS()) return () => {} // OPS 模式先無即時訂閱（重整拿最新）
  const w = { pattern, cb }
  _watchers.add(w)
  return () => _watchers.delete(w)
}
// 手動廣播（批次寫入後用；一次太多鍵就不廣播，避免洗頻道——對方重整就會看到）
export function announceShared(keys) {
  if (_OPS()) return
  if (!Array.isArray(keys) || keys.length > 20) return
  keys.forEach(k => announce(k, false))
}

// 安裝 window.storage 墊片（在 App 掛載前呼叫）
// 寫入防抖（2026-07-18 治本）：全 App 有 21 處輸入欄「每敲一鍵就 set 一次」→
// 統一在這層收斂：同一個 key 停止寫入 800ms 後，才真正上傳「最後一版」到 Supabase。
// get() 若該 key 有排隊中的新值，直接回新值（不會讀到舊資料）；關頁/切背景立刻 flush，不漏資料。
const _pend = new Map() // key → { value, timer }
function _flushAllPending() {
  for (const [key, p] of [..._pend.entries()]) {
    clearTimeout(p.timer); _pend.delete(key); setShared(key, p.value)
  }
}
export function installStorageShim() {
  if (typeof window === 'undefined') return
  ensureSync() // 即時同步廣播頻道（收到別台的變更 → 重抓該 key 更新畫面）
  window.addEventListener('pagehide', _flushAllPending)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _flushAllPending() })
  window.storage = {
    async get(key, shared = true) {
      if (shared && _pend.has(key)) return { value: _pend.get(key).value } // 排隊中的最新值優先
      return shared ? await getShared(key) : getLocal(key)
    },
    async set(key, value, shared = true) {
      if (!shared) { setLocal(key, value); return }
      const prev = _pend.get(key); if (prev) clearTimeout(prev.timer)
      const timer = setTimeout(() => { const p = _pend.get(key); if (p) { _pend.delete(key); setShared(key, p.value) } }, 800)
      _pend.set(key, { value, timer })
    },
    async delete(key, shared = true) {
      const p = _pend.get(key); if (p) { clearTimeout(p.timer); _pend.delete(key) } // 刪除前先取消排隊中的寫入，避免死而復生
      if (_OPS()) { await _opsKV({ op: 'del', key }); return }
      if (shared && dataClient) {
        try { await writeDB().from('pm_documents').delete().eq('id', key); announce(key, true) } catch (_) {}
      } else { try { localStorage.removeItem(key) } catch (_) {} }
    },
  }
}
