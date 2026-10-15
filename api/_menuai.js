// 菜單 AI 生圖（GD v4.70.32 ?menuai 原程式抽出；v4.71.82 abgd 搬家：GD ?menuai 與新殼代發口 abgd-fx menu_ai_gen 共用同一份）
// 兩段式：文字模型看參考圖＋老闆的話寫英文指令（brief）→ Gemini 照指令畫 n 張；成品存 Supabase photos/menu/raw/ 回公開網址（不寫任何資料文件）
import { aiCall, aiImage } from './_ai.js'
import { SB_URL, svc } from './_onboard.js'

export async function menuAiGen(b) {
  const kind = b.kind === 'art' ? 'art' : 'photo'
  const sub = ['sticker', 'logo', 'slogan'].includes(b.sub) ? b.sub : 'sticker'
  const hint = String(b.hint || '').slice(0, 400), slogan = String(b.slogan || '').slice(0, 60)
  const n = Math.max(1, Math.min(4, Number(b.n) || 2))
  const imgs = (Array.isArray(b.imgs) ? b.imgs : []).slice(0, 3).map(u => { const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(u || '')); return m ? { media_type: m[1].toLowerCase(), data: m[2] } : null }).filter(Boolean)
  const t0 = Date.now()
  try {
    // 第一段：寫指令（Claude／設定頁選的文字模型看圖）
    let brief_en = String(b.brief_en || '').slice(0, 2000), brief_zh = String(b.brief_zh || '').slice(0, 300)
    if (!brief_en) {
      const ask = kind === 'photo'
        ? `你是餐廳菜單的食物攝影指令師。附圖是一張「被上下裁切」的餐點照片（來自我們的菜單）。請用英文寫一段給圖像生成模型的指令，要它「重新畫一份完整、未裁切、同一道餐點的產品照」：精確描述餐點內容（每個元素、數量、由左到右的擺放）、容器／盤子／紙盒、拍攝角度、光線與色調，要求跟原圖一致。不要寫背景要求（系統會自動加）。${hint ? '老闆補充要求：' + hint + '。' : ''}另外用繁體中文 60 字內摘要這段指令給老闆看。回覆格式固定兩段、不要其他文字：\n===EN===\n（英文指令）\n===ZH===\n（中文摘要）`
        : `你是品牌插畫美術指導。${imgs.length ? '附圖是老闆喜歡的風格參考，先分析它的風格（線條粗細、配色、質感、筆觸、時代感、是否有外框／貼紙白邊）。' : '沒有參考圖，請用溫暖活潑、手繪感的扁平插畫風。'}品牌：GROUN:D（海邊的披薩／漢堡／早午餐小店，品牌紅 #CE1611 配奶油色 #F5EADA）。${sub === 'logo' ? '任務：做「Logo 變化版」——以附上的官方 logo 為基礎做風格變化／加小元素，文字 GROUN:D 必須清楚可讀、拼字正確。' : sub === 'slogan' ? `任務：做一張「標語圖」——把文字「${slogan || hint}」原樣畫進圖裡（拼字、標點必須完全正確，不可多字少字），搭配風格化的裝飾。` : '任務：做一個「小插圖」（單一主體、可貼在菜單上的貼紙感）。'}老闆想要的概念／感覺：${hint || '活潑、生動、可愛'}。請用英文寫給圖像生成模型的指令：具體寫出風格、主體、配色、構圖（單一主體置中、四周留白、乾淨）。不要寫背景要求（系統會自動加）。另外用繁體中文 60 字內摘要給老闆看。回覆格式固定兩段、不要其他文字：\n===EN===\n（英文指令）\n===ZH===\n（中文摘要）`
      const content = [...imgs.map(im => ({ type: 'image', media_type: im.media_type, data: im.data })), { type: 'text', text: ask }]
      const r1 = await aiCall('app', { messages: [{ role: 'user', content }], maxTokens: 900, timeoutMs: 60000 })
      const tx = String(r1.text || '')
      const mEn = /===\s*EN\s*===\s*([\s\S]*?)(?:===\s*ZH\s*===|$)/i.exec(tx), mZh = /===\s*ZH\s*===\s*([\s\S]*?)$/i.exec(tx)
      let j = { en: mEn ? mEn[1].trim() : '', zh: mZh ? mZh[1].trim() : '' }
      if (!j.en) { const mj = /\{[\s\S]*\}/.exec(tx); try { j = JSON.parse(mj ? mj[0] : '{}') } catch (_) { j = { en: tx.replace(/```[a-z]*/g, '').slice(0, 1500), zh: '' } } } // 備援：模型硬要回 JSON／純文字
      brief_en = String(j.en || '').replace(/```[a-z]*/g, '').trim().slice(0, 2000); brief_zh = String(j.zh || '').replace(/```/g, '').trim().slice(0, 300)
      if (!brief_en) throw new Error('指令沒寫出來，再試一次')
    }
    // 第二段：畫圖（固定背景規格接在指令後面）
    const tail = kind === 'photo'
      ? ' Isolated on a flat, uniform cream background (#F5EADA) with only a soft natural shadow directly under the dish. Every item fully visible from top to bottom with generous plain margin on all sides. No text, no table surface, no props, no border, no extra items. Professional food product photography.'
      : (sub === 'slogan'
        ? ` Render the exact text "${slogan || hint}" with perfect spelling, centered, as the main element. Flat uniform cream background (#F5EADA), no drop shadow, no border, no watermark, nothing else in the frame.`
        : ' Single centered subject with generous margin, flat uniform cream background (#F5EADA), no drop shadow, no border, no watermark, no extra text. Clean edges suitable for cutting out as a sticker.')
    const prompt = brief_en + tail
    const aspect = kind === 'photo' ? '16:9' : (sub === 'slogan' ? '16:9' : '1:1')
    const size = kind === 'photo' ? '2K' : '1K'
    const refImages = kind === 'photo' ? imgs.slice(0, 1) : imgs
    const outs = await Promise.all(Array.from({ length: n }, () => aiImage('image', { prompt, refImages, aspect, size, timeoutMs: 150000 }).catch(e => ({ err: e.message }))))
    const urls = []
    for (const o of outs) {
      if (!o || o.err || !o.data) continue
      const ext = (o.mime || 'image/png').split('/')[1] === 'jpeg' ? 'jpg' : 'png'
      const path = `menu/raw/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`
      const ur = await fetch(`${SB_URL}/storage/v1/object/photos/${path}`, { method: 'POST', headers: { ...svc, 'content-type': o.mime || 'image/png', 'x-upsert': 'true' }, body: Buffer.from(o.data, 'base64') })
      if (ur.ok) urls.push(`${SB_URL}/storage/v1/object/public/photos/${path}`)
    }
    if (!urls.length) throw new Error('Gemini 沒有回圖：' + (outs.map(o => o && o.err).filter(Boolean)[0] || '未知'))
    return ({ ok: true, ms: Date.now() - t0, brief_en, brief_zh, urls, model: (outs.find(o => o && o.model) || {}).model || '' })
  } catch (e) { return ({ ok: false, ms: Date.now() - t0, error: e.message || '失敗' }) }
}
