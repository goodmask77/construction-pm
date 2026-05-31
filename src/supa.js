// 共用後端 + window.storage 墊片
// 新版 App 大量使用 claude.ai 的 window.storage API。這裡用 Supabase（共享資料，
// 公開協作）+ localStorage（個人設定，如 pm_role）提供相同介面，讓 App 幾乎原封不動就能跑。
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

export const CLIENT_ID =
  Math.random().toString(36).slice(2) + Date.now().toString(36)

// shared=true → 全體協作者共用（Supabase）；shared=false → 本機個人（localStorage）
async function getShared(k) {
  if (!supabase) {
    const v = localStorage.getItem(k)
    return v != null ? { value: v } : null
  }
  try {
    const { data } = await supabase
      .from('pm_documents').select('data').eq('id', k).maybeSingle()
    if (data && data.data && typeof data.data.v === 'string') return { value: data.data.v }
  } catch (_) {}
  return null
}

async function setShared(k, value) {
  if (!supabase) { try { localStorage.setItem(k, value) } catch (_) {} ; return }
  try {
    await supabase.from('pm_documents').upsert({
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
      if (shared && supabase) {
        try { await supabase.from('pm_documents').delete().eq('id', key) } catch (_) {}
      } else { try { localStorage.removeItem(key) } catch (_) {} }
    },
  }
}
