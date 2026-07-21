// ── DD 互動卡片模組（2026-07-22 張良拍板 A+B+C）──
// A. 私訊丟照片給 DD → 問「這是什麼文件」(按鈕) → 存本人名冊私密檔案欄（私有桶，不經 AI）
// B. 「回饋」→ Flex 選人卡 → 選標籤卡 → 一鍵寫回 kb_feedback（積分照算）；「補充 …」可追加一句話
// C. 「投票」→ 未投的投票卡，點選項即投（一人一票照防）；操作者可「推播投票」「推播回饋卡」給全體綁定夥伴
// 全部走固定指令/postback，不經 AI；答案直接寫回 App 同一份資料（資料一致鐵則）。
import { kvGet, kvSet, linePush, loadRoster, saveRoster, uploadPrivate, SB_URL, svc, BUCKET } from './_onboard.js'

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').replace(/^[A-Za-z0-9_]+=/, '').trim()
const LINE_TOKEN = clean(process.env.LINE_CHANNEL_ACCESS_TOKEN)

// 標籤清單（與 src/crew/CrewViews.jsx 的 FB_POS_TAGS/FB_CON_TAGS 同步；改那邊記得改這邊）
export const POS_TAGS = ['服務暖心', '救火英雄', '執行力強', '細心可靠', '思慮周全', '帶人有耐心', '正能量', '神隊友', '出餐快又準', '臨危不亂']
export const CON_TAGS = ['可多主動溝通', '記得多確認細節', '建議提早備料', '開會多分享想法']
const ALL_TAGS = [...POS_TAGS, ...CON_TAGS]

// ── LINE 傳送（文字/Flex 通用）──
async function lineSend(replyToken, messages) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ replyToken, messages }),
    })
    return r.ok
  } catch (_) { return false }
}
export async function pushMessages(to, messages) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ to, messages }),
    })
    return r.ok
  } catch (_) { return false }
}
const txt = (t) => ({ type: 'text', text: String(t).slice(0, 4900) })

// ── Flex 建卡 ──
const btn = (label, data, display) => ({ type: 'button', style: 'secondary', height: 'sm', margin: 'xs', action: { type: 'postback', label: String(label).slice(0, 20), data: String(data).slice(0, 290), displayText: display || label } })
const bubble = (title, sub, buttons, color = '#C13A22') => ({
  type: 'bubble', size: 'kilo',
  header: { type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '12px', contents: [
    { type: 'text', text: title, color: '#ffffff', weight: 'bold', size: 'md' },
    ...(sub ? [{ type: 'text', text: sub, color: '#ffe8e2', size: 'xs', margin: 'xs', wrap: true }] : []),
  ] },
  body: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: buttons },
})
const flex = (altText, contents) => ({ type: 'flex', altText: String(altText).slice(0, 390), contents })
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// 選人卡：依部門分組（內場/外場/管理/其他），每組一張卡
function personPickerFlex(people, meId, dataPrefix, title, sub) {
  const order = ['內場', '外場', '管理']
  const groups = {}
  people.filter(p => p.id !== meId && (p.status || '在職') === '在職' && !p.onboarding).forEach(p => {
    const g = order.includes(p.dept) ? p.dept : '其他'
    ;(groups[g] = groups[g] || []).push(p)
  })
  const bubbles = []
  for (const g of [...order, '其他']) {
    if (!groups[g]?.length) continue
    for (const part of chunk(groups[g], 10)) {
      bubbles.push(bubble(`${title}｜${g}`, sub, part.map(p => btn(`${p.name}${p.nick ? `（${p.nick}）` : ''}`, `${dataPrefix}|${p.id}`, `選 ${p.name}`))))
      if (bubbles.length >= 10) break
    }
  }
  return flex(title, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 10) })
}
// 標籤卡：正向 + 建設性（postback 帶標籤索引）
function tagFlex(toId, toName) {
  const mk = (t) => btn(t, `fb|tag|${toId}|${ALL_TAGS.indexOf(t)}`, `${t} → ${toName}`)
  return flex(`給 ${toName} 的回饋標籤`, {
    type: 'bubble', size: 'kilo',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#C13A22', paddingAll: '12px', contents: [
      { type: 'text', text: `給 ${toName} 的回饋`, color: '#ffffff', weight: 'bold', size: 'md' },
      { type: 'text', text: '點一個標籤直接送出（+2分）', color: '#ffe8e2', size: 'xs', margin: 'xs' },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '10px', contents: [
      { type: 'text', text: '👍 正向', size: 'xs', color: '#8a8172', margin: 'sm' },
      ...POS_TAGS.map(mk),
      { type: 'text', text: '💡 建設性建議', size: 'xs', color: '#8a8172', margin: 'md' },
      ...CON_TAGS.map(mk),
    ] },
  })
}
// 投票卡：人物票依部門分組、一般選項直接列
function pollFlex(poll, people) {
  const sub = '點一下就完成投票（一人一票）'
  if (poll.peoplePoll) return personPickerFlex(people, '__none__', `poll|${poll.id}`, `🗳 ${poll.title}`, sub)
  const bubbles = chunk(poll.options, 10).map(part => bubble(`🗳 ${poll.title}`, sub, part.map(o => btn(o.label, `poll|${poll.id}|${o.id}`, `投給「${o.label}」`))))
  return flex(`投票：${poll.title}`, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 10) })
}
// 文件歸類卡（A：丟照片後問這是什麼）
function docClassifyFlex(tmpPath) {
  const kinds = [['idDoc', '身分證影本'], ['bankDoc', '存摺影本'], ['contractDoc', '勞動契約'], ['docs', '其他文件']]
  return flex('這是什麼文件？', bubble('收到照片 📷', '要歸到哪個文件欄？（會存進你的私密人事檔案，只有主管與你本人看得到）', [
    ...kinds.map(([k, l]) => btn(l, `doc|${k}|${tmpPath}`, `歸類為「${l}」`)),
    btn('❌ 不是文件，取消', `doc|cancel|${tmpPath}`, '取消'),
  ], '#4A4234'))
}

// ── 資料操作 ──
const FB_KEY = 'sp_crew_kb_feedback', POLL_KEY = 'sp_crew_kb_polls', STATE_KEY = 'pm_dd_state'
const loadStates = async () => (await kvGet(STATE_KEY)) || {}
const saveStates = (s) => kvSet(STATE_KEY, s)
const personByUid = (roster, uid) => roster.people.find(p => p.lineUserId === uid && (p.status || '在職') !== '離職')

async function submitFeedback(fromId, toId, tag) {
  const fb = (await kvGet(FB_KEY)) || { items: [], exclusions: [] }
  const ex = (fb.exclusions || []).some(([a, b]) => (a === fromId && b === toId) || (a === toId && b === fromId))
  if (ex) return { error: '這位夥伴在迴避名單中，無法互相回饋。' }
  const it = { id: 'fb-' + Math.random().toString(36).slice(2, 8), fromId, toId, tags: [tag], text: '', anon: false, ts: new Date().toISOString(), helpful: [], via: 'line' }
  fb.items = [it, ...(fb.items || [])]
  await kvSet(FB_KEY, fb)
  return { ok: true, itemId: it.id }
}
async function appendFbNote(itemId, note) {
  const fb = (await kvGet(FB_KEY)) || { items: [] }
  const it = (fb.items || []).find(x => x.id === itemId)
  if (!it) return false
  it.text = it.text ? it.text + ' ' + note : note
  await kvSet(FB_KEY, fb)
  return true
}
async function castVote(pollId, voterId, choiceId) {
  const d = (await kvGet(POLL_KEY)) || { polls: [], votes: [] }
  const poll = (d.polls || []).find(p => p.id === pollId)
  if (!poll) return { error: '這個投票已經不存在了。' }
  if ((d.votes || []).some(v => v.pollId === pollId && v.voterId === voterId)) return { error: '你已經投過這場了（一人一票）。' }
  const valid = poll.peoplePoll ? true : (poll.options || []).some(o => o.id === choiceId)
  if (!valid) return { error: '選項不存在。' }
  d.votes = [...(d.votes || []), { pollId, voterId, choiceId, ts: new Date().toISOString() }]
  await kvSet(POLL_KEY, d)
  const n = d.votes.filter(v => v.pollId === pollId).length
  return { ok: true, title: poll.title, n }
}
async function moveObject(src, dst) {
  const r = await fetch(`${SB_URL}/storage/v1/object/move`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: src, destinationKey: dst }),
  })
  return r.ok
}
async function deleteObject(key) {
  try { await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${key}`, { method: 'DELETE', headers: svc }) } catch (_) {}
}
const FIELD_LABEL = { idDoc: '身分證影本', bankDoc: '存摺影本', contractDoc: '勞動契約', docs: '其他文件' }

// 給外部（推播/測試）直接組卡用
export const buildFbPicker = (people, meId) => personPickerFlex(people, meId, 'fb|to', '💬 給誰回饋？', '點名字 → 選標籤 → 完成（+2分）')
export const buildPollCard = (poll, people) => pollFlex(poll, people)

// ── 主入口：回 true＝已消化（webhook 跳過 AI）──
export async function handleDDCards(ev, operators) {
  if (ev.source?.type !== 'user') return false
  const uid = ev.source.userId
  const reply = (msgs) => lineSend(ev.replyToken, Array.isArray(msgs) ? msgs : [msgs])

  // ── postback（卡片按鈕）──
  if (ev.type === 'postback') {
    const data = String(ev.postback?.data || '')
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    const [kind, a, b, c] = data.split('|')
    if (kind === 'fb') {
      if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）再給回饋。')); return true }
      if (a === 'to') { const to = roster.people.find(p => p.id === b); if (!to) { await reply(txt('找不到這位夥伴。')); return true } await reply(tagFlex(to.id, to.name)); return true }
      if (a === 'tag') {
        const to = roster.people.find(p => p.id === b)
        const tag = ALL_TAGS[Number(c)]
        if (!to || !tag) { await reply(txt('資料對不上，請重新輸入「回饋」再來一次。')); return true }
        const out = await submitFeedback(me.id, to.id, tag)
        if (out.error) { await reply(txt(out.error)); return true }
        const states = await loadStates()
        states[uid] = { mode: 'fbnote', itemId: out.itemId, toName: to.name, ts: Date.now() }
        await saveStates(states)
        await reply(txt(`✅ 已送出回饋給 ${to.name}：「${tag}」（+2分，App 回饋牆看得到）\n想補一句話就輸入：補充 你想說的話`))
        return true
      }
    }
    if (kind === 'poll') {
      if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）再投票。')); return true }
      const out = await castVote(a, me.id, b)
      await reply(txt(out.error ? out.error : `🗳 投好了！「${out.title}」目前 ${out.n} 票。結果在 App 投票區看得到。`))
      return true
    }
    if (kind === 'doc') {
      if (!me) { await reply(txt('請先報到綁定。')); return true }
      if (a === 'cancel') { await deleteObject(b + (c ? '|' + c : '')); await reply(txt('好，已取消，照片沒有存檔。')); return true }
      const tmp = [b, c].filter(Boolean).join('|')
      if (!FIELD_LABEL[a] || !tmp.startsWith(`roster/${me.id}/`)) { await reply(txt('資料對不上，請重傳照片。')); return true }
      const ext = tmp.split('.').pop()
      const dst = `roster/${me.id}/${a}-${Date.now().toString(36)}.${ext}`
      const ok = await moveObject(tmp, dst)
      if (!ok) { await reply(txt('歸檔失敗，請重傳照片。')); return true }
      const p2 = (await loadRoster()); const meNow = p2.people.find(x => x.id === me.id)
      meNow[a] = [...(Array.isArray(meNow[a]) ? meNow[a] : []), { name: FIELD_LABEL[a] + '(LINE上傳)', path: dst, private: true, ts: new Date().toISOString(), by: me.name }]
      await saveRoster(p2)
      await reply(txt(`✅ 已存入你的「${FIELD_LABEL[a]}」（私密人事檔案）。入職進度會同步更新，可到 App 名冊自己的卡片確認。`))
      return true
    }
    return false
  }

  // ── 照片（A：綁定者丟照片 → 上傳暫存 → 問歸類）──
  if (ev.type === 'message' && ev.message?.type === 'image') {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) return false // 沒綁定的人丟圖 → 不處理（交還原本行為＝忽略）
    const r = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, { headers: { authorization: `Bearer ${LINE_TOKEN}` } })
    if (!r.ok) { await reply(txt('照片下載失敗，請再傳一次。')); return true }
    const buf = Buffer.from(await r.arrayBuffer())
    const type = r.headers.get('content-type') || 'image/jpeg'
    const ext = /png/.test(type) ? 'png' : 'jpg'
    const tmp = `roster/${me.id}/dd-tmp-${Date.now().toString(36)}.${ext}`
    const ok = await uploadPrivate(tmp, buf, type)
    if (!ok) { await reply(txt('照片儲存失敗，請再傳一次。')); return true }
    await reply(docClassifyFlex(tmp))
    return true
  }

  if (ev.type !== 'message' || ev.message?.type !== 'text') return false
  const text = (ev.message.text || '').trim()

  // 「補充 …」→ 追加到最近一筆 LINE 回饋（24小時內）
  const mNote = text.match(/^補充[\s:：]+([\s\S]+)/)
  if (mNote) {
    const states = await loadStates()
    const st = states[uid]
    if (st?.mode === 'fbnote' && Date.now() - st.ts < 86400000) {
      const ok = await appendFbNote(st.itemId, mNote[1].trim().slice(0, 300))
      delete states[uid]; await saveStates(states)
      await reply(txt(ok ? `已補上這句話給 ${st.toName} 👍` : '找不到剛剛那筆回饋（可能已被刪除）。'))
    } else await reply(txt('目前沒有可補充的回饋。先輸入「回饋」給夥伴一個回饋吧。'))
    return true
  }

  // 「回饋」→ 選人卡
  if (/^(回饋|給回饋)$/.test(text)) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）。')); return true }
    await reply(personPickerFlex(roster.people, me.id, 'fb|to', '💬 給誰回饋？', '點名字 → 選標籤 → 完成（+2分）'))
    return true
  }

  // 「投票」→ 我還沒投的進行中投票
  if (/^投票$/.test(text)) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）。')); return true }
    const d = (await kvGet(POLL_KEY)) || { polls: [], votes: [] }
    const todo = (d.polls || []).filter(p => !(d.votes || []).some(v => v.pollId === p.id && v.voterId === me.id))
    if (!todo.length) { await reply(txt((d.polls || []).length ? '進行中的投票你都投完了 👍' : '目前沒有進行中的投票。')); return true }
    await reply(todo.slice(0, 3).map(p => pollFlex(p, roster.people)))
    return true
  }

  // 「上班」「下班」→ LINE 備援打卡（打卡站掃不了時用；未經站點驗證，負責人要在 App 出勤頁審核）
  const mPunch = text.match(/^(上班|下班)$/)
  if (mPunch) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）。')); return true }
    const { recordPunch } = await import('./punch.js')
    const out = await recordPunch(me, 'line', false, mPunch[1] === '上班' ? 'in' : 'out')
    const hhmm = new Date(out.ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
    await reply(txt(`⏱ 已記錄「${mPunch[1]}」${hhmm}（LINE 備援打卡，會請負責人補審核）。\n今日累計 ${out.todayHours} 小時。平常請優先掃店內打卡站 QR。`))
    return true
  }

  // 「心得 …」→ 記錄每日心得（夥伴主動傳＝回覆免費，不扣推播額度）
  const mJournal = text.match(/^(?:心得|今日心得|下班心得)[\s:：]+([\s\S]+)/)
  if (mJournal) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）。')); return true }
    const d = (await kvGet('sp_crew_kb_journal')) || { items: [] }
    d.items = [{ id: 'jn-' + Math.random().toString(36).slice(2, 8), personId: me.id, name: me.name, text: mJournal[1].trim().slice(0, 500), ts: new Date().toISOString(), via: 'line' }, ...(d.items || [])].slice(0, 1000)
    await kvSet('sp_crew_kb_journal', d)
    await reply(txt(`📝 收到，${me.name} 的今日心得記下來了！老闆看得到、也會成為改善的參考。辛苦了 👏`))
    return true
  }
  if (/^我的心得$/.test(text)) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定。')); return true }
    const d = (await kvGet('sp_crew_kb_journal')) || { items: [] }
    const mine = (d.items || []).filter(i => i.personId === me.id).slice(0, 5)
    await reply(txt(mine.length ? '你最近的心得：\n' + mine.map(i => `・${i.ts.slice(5, 10)} ${i.text.slice(0, 60)}`).join('\n') : '還沒有心得紀錄。輸入「心得 你想說的」隨時記一筆。'))
    return true
  }

  // 操作者指令：推播給全體綁定夥伴（會逐人計 LINE 則數，量力而為）
  const isOp = !!operators?.[uid]
  if (isOp && /^推播回饋卡$/.test(text)) {
    const roster = await loadRoster()
    const bound = roster.people.filter(p => p.lineUserId && (p.status || '在職') !== '離職')
    for (const p of bound) await pushMessages(p.lineUserId, [personPickerFlex(roster.people, p.id, 'fb|to', '💬 給誰回饋？', '花30秒鼓勵一位夥伴（+2分）')])
    await reply(txt(`已推播回饋卡給 ${bound.length} 位綁定夥伴（計 ${bound.length} 則）。`))
    return true
  }
  const mPushPoll = isOp && text.match(/^推播投票[\s:：]*(.*)$/)
  if (mPushPoll) {
    const roster = await loadRoster()
    const d = (await kvGet(POLL_KEY)) || { polls: [] }
    const kw = (mPushPoll[1] || '').trim()
    const poll = kw ? (d.polls || []).find(p => (p.title || '').includes(kw)) : (d.polls || [])[0]
    if (!poll) { await reply(txt((d.polls || []).length ? `找不到標題含「${kw}」的投票。現有：${d.polls.map(p => p.title).join('、')}` : '目前沒有投票。先到 App 投票區發起一場。')); return true }
    const bound = roster.people.filter(p => p.lineUserId && (p.status || '在職') !== '離職')
    let n = 0
    for (const p of bound) { if (!(d.votes || []).some(v => v.pollId === poll.id && v.voterId === p.id)) { await pushMessages(p.lineUserId, [pollFlex(poll, roster.people)]); n++ } }
    await reply(txt(`已推播「${poll.title}」給 ${n} 位還沒投的綁定夥伴（計 ${n} 則）。`))
    return true
  }
  // 操作者：看心得彙整（回覆免費）
  const mSeeJ = isOp && text.match(/^看心得[\s]*(\d*)$/)
  if (mSeeJ) {
    const days = Number(mSeeJ[1]) || 7
    const d = (await kvGet('sp_crew_kb_journal')) || { items: [] }
    const since = Date.now() - days * 86400000
    const list = (d.items || []).filter(i => new Date(i.ts).getTime() >= since).slice(0, 30)
    await reply(txt(list.length ? `📝 近${days}天心得（${list.length}則）：\n` + list.map(i => `・${i.ts.slice(5, 10)} ${i.name}：${i.text.slice(0, 80)}`).join('\n') : `近${days}天沒有心得紀錄。可用「推播心得提醒」邀大家寫（會扣推播額度）。`))
    return true
  }
  // 操作者：推播心得提醒（扣額度，回報則數）
  if (isOp && /^推播心得提醒$/.test(text)) {
    const roster = await loadRoster()
    const bound = roster.people.filter(p => p.lineUserId && (p.status || '在職') !== '離職')
    for (const p of bound) await pushMessages(p.lineUserId, [txt(`${p.nick || p.name}，下班辛苦了 🌙 今天有什麼心得或想法嗎？\n直接回覆「心得 你想說的話」就記錄囉（一兩句就好）。`)])
    await reply(txt(`已推播心得提醒給 ${bound.length} 位綁定夥伴（計 ${bound.length} 則）。`))
    return true
  }
  // 操作者：測試卡片（推給自己）
  if (isOp && /^測試卡片$/.test(text)) {
    const roster = await loadRoster()
    const d = (await kvGet(POLL_KEY)) || { polls: [] }
    const msgs = [personPickerFlex(roster.people, (personByUid(roster, uid) || {}).id || '__none__', 'fb|to', '💬 給誰回饋？', '點名字 → 選標籤 → 完成（+2分）')]
    if (d.polls?.length) msgs.push(pollFlex(d.polls[0], roster.people))
    await reply(msgs.slice(0, 5))
    return true
  }
  return false
}
