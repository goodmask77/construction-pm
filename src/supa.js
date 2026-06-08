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

// 資料讀寫用 client：不帶 session、不刷新權杖、不過 auth 鎖 → 17 個請求可真正並發，載入快。
// （pm_documents 沒有 RLS，用公鑰即可讀寫；登入相關仍走上面的 supabase。）
const dataClient = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null

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
    await dataClient.from('pm_documents').upsert({
      id: k,
      data: { v: value },
      editor: CLIENT_ID,
      updated_at: new Date().toISOString(),
    })
  } catch (_) {}
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
export function installStorageShim() {
  if (typeof window === 'undefined') return
  window.storage = {
    async get(key, shared = true) {
      return shared ? await getShared(key) : getLocal(key)
    },
    async set(key, value, shared = true) {
      if (shared) await setShared(key, value)
      else setLocal(key, value)
    },
    async delete(key, shared = true) {
      if (shared && dataClient) {
        try { await dataClient.from('pm_documents').delete().eq('id', key) } catch (_) {}
      } else { try { localStorage.removeItem(key) } catch (_) {} }
    },
  }
}
