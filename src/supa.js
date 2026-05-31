// 共用後端：Supabase。資料存在 pm_documents 表（單一共用文件，公開協作）。
// 若未設定環境變數，退回瀏覽器 localStorage（單機模式），App 仍可運作。
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && key ? createClient(url, key) : null

// 每個分頁一個 ID，用來在 Realtime 中忽略自己的寫入（避免回音/乒乓）
export const CLIENT_ID =
  Math.random().toString(36).slice(2) + Date.now().toString(36)

const KEY_DATA = 'pm_data'
const KEY_CHAT = 'pm_chat'

async function readDoc(id, fallback) {
  if (!supabase) {
    try {
      const v = localStorage.getItem(id)
      return v ? JSON.parse(v) : fallback
    } catch (_) { return fallback }
  }
  const { data } = await supabase
    .from('pm_documents')
    .select('data')
    .eq('id', id)
    .maybeSingle()
  return data?.data ?? fallback
}

async function writeDoc(id, value) {
  if (!supabase) {
    try { localStorage.setItem(id, JSON.stringify(value)) } catch (_) {}
    return
  }
  await supabase.from('pm_documents').upsert({
    id,
    data: value,
    editor: CLIENT_ID,
    updated_at: new Date().toISOString(),
  })
}

export const loadData = () => readDoc(KEY_DATA, null)
export const saveData = (cats) => writeDoc(KEY_DATA, cats)
export const loadGlobalChat = () => readDoc(KEY_CHAT, [])
export const saveGlobalChat = (msgs) => writeDoc(KEY_CHAT, msgs)

export const DOC_KEYS = { data: KEY_DATA, chat: KEY_CHAT }
