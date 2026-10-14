// abgd 搬家（成本模組 F13）：把文件的物件鍵排成 Postgres jsonb 的順序（鍵長度短→長、同長度依位元組），再交給成本算法
// 原因：成本算法有些結果跟「讀到的列順序」有關（同分時取第一筆、樣本、主要來源…）；GD 讀到的是阿桑寫入順序、新殼讀到的是 jsonb 順序，
// 兩邊統一成 jsonb 順序 → 同一份資料算出同一個數字（也讓 GD 自己的結果不再跟寫入順序漂移）
const cmpKey = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length !== y.length ? x.length - y.length : Buffer.compare(x, y) } // 長度是位元組數（中文一字 3 位元組）
export function jsonbOrder (v) {
  if (Array.isArray(v)) return v.map(jsonbOrder)
  if (!v || typeof v !== 'object') return v
  const out = {}
  for (const k of Object.keys(v).sort(cmpKey)) out[k] = jsonbOrder(v[k])
  return out
}
export const orderedKvGet = (kvGet) => async (k) => jsonbOrder(await kvGet(k))
