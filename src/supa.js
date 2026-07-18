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

// 資料「讀取」用 client：不帶 session、不刷新權杖、不過 auth 鎖 → 17 個請求可真正並發，載入快。
// 讀取走 RLS 的「anon 可 SELECT」政策，所以沒登入也能看（訪客瀏覽）。
const dataClient = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null

// 資料「寫入」一律走帶 session 的 supabase（登入者＝authenticated 角色）→ RLS 才擋得住外人亂改。
// 沒登入時這個 client 是 anon 角色，RLS 會擋下寫入（本來訪客就不能改，符合預期）。
const writeDB = () => supabase || dataClient

export const CLIENT_ID =
  Math.random().toString(36).slice(2) + Date.now().toString(36)

// shared=true → 全體協作者共用（Supabase）；shared=false → 本機個人（localStorage）
async function getShared(k) {
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

async function setShared(k, value) {
  if (!dataClient) { try { localStorage.setItem(k, value) } catch (_) {} ; return }
  try {
    const { error } = await writeDB().from('pm_documents').upsert({
      id: k,
      data: { v: value },
      editor: CLIENT_ID,
      updated_at: new Date().toISOString(),
    })
    if (error) console.warn('[storage] 寫入失敗', k, error.message || error) // RLS 擋下或未登入時會在這
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
  if (!dataClient) throw new Error('Supabase 未設定');
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await dataClient.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data } = dataClient.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}
export async function deletePhotoFile(path) {
  if (!dataClient || !path) return;
  try { await dataClient.storage.from(PHOTO_BUCKET).remove([path]); } catch (_) {}
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
      if (shared && dataClient) {
        try { await writeDB().from('pm_documents').delete().eq('id', key) } catch (_) {}
      } else { try { localStorage.removeItem(key) } catch (_) {} }
    },
  }
}
