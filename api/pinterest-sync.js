// 每小時 :35 自動看登記的 Pinterest 圖版，新圖存進素材庫（v4.71.5）；手動：?run=<OPS_BOARD_KEY>
import { syncAll, boardAdd, importUrl } from './_pinterest.js'
export const config = { maxDuration: 120 }
export default async function handler(req, res) {
  try {
    const q = req.query || {}
    const isCron = (req.headers['user-agent'] || '').startsWith('vercel-cron') || (process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`)
    const ok2 = (process.env.OPS_BOARD_KEY || '').trim()
    if (!isCron && !(ok2 && String(q.run || '') === ok2)) return res.status(403).json({ ok: false })
    if (!isCron && q.add) { const r = /\/pin\/\d+/.test(String(q.add)) ? await importUrl(String(q.add), 'CC') : await boardAdd(String(q.add), 'CC'); return res.status(200).json({ ok: true, found: r.found, added: (r.added || []).length, dup: r.dup, failed: r.failed, board: r.board || null }) } // 管理口：?run=金鑰&add=<圖版或釘圖連結>（首批匯入用）
    const r = await syncAll({ notify: q.quiet ? false : true })
    return res.status(200).json(r)
  } catch (e) { return res.status(500).json({ ok: false, error: String(e.message || e) }) }
}
