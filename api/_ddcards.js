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
// ── 工作日誌（張良 2026-08-20）：私訊＋群組都能記、可附照片；全店在夥伴中心看得到 ──
// 語法：「日誌 [問題|改善|求助] [AB|GD] 內容」——類型/店別可省略（省略＝一般心得/通用）；心得/今日心得/下班心得 同義
const JOURNAL_KEY = 'sp_crew_kb_journal'
export async function handleJournalText(ev) {
  if (ev.type !== 'message' || ev.message?.type !== 'text') return null
  const text = (ev.message.text || '').trim()
  const m = text.match(/^(?:心得|日誌|工作日誌|今日心得|下班心得)[\s:：]+([\s\S]+)/)
  if (!m) return null
  const uid = ev.source?.userId || ''
  const isDM = ev.source?.type === 'user'
  const reply = (t) => ev.replyToken ? lineSend(ev.replyToken, [txt(t)]) : Promise.resolve()
  const roster = await loadRoster()
  const me = personByUid(roster, uid)
  // 未綁定：私訊提示；群組保持安靜（外部群安靜原則——廠商打「日誌 …」不理不回）
  if (!me) { if (isDM) { await reply('請先報到綁定（輸入「你的本名＋報到」），日誌才記得到你名下。'); return { consumed: true } } return null }
  let body = m[1].trim()
  // 開頭 token 解析（順序不拘、各最多一個）：類型與店別
  let kind = 'note', store = null
  for (let i = 0; i < 2; i++) {
    const mK = body.match(/^(問題|改善|求助|要幫忙|幫忙)[\s:：]+/); if (mK && kind === 'note') { kind = mK[1] === '問題' ? 'issue' : mK[1] === '改善' ? 'improve' : 'help'; body = body.slice(mK[0].length); continue }
    const mS = body.match(/^(AB|ab|A店|海灘|beach|GD|gd|G店|ground|GROUND)[\s:：]+/); if (mS && !store) { store = /^(GD|gd|G店|ground|GROUND)/.test(mS[1]) ? 'ground' : 'abeach'; body = body.slice(mS[0].length); continue }
    break
  }
  const d = (await kvGet(JOURNAL_KEY)) || { items: [] }
  const item = { id: 'jn-' + Math.random().toString(36).slice(2, 8), personId: me.id, name: me.name, text: body.slice(0, 500), ts: new Date().toISOString(), via: isDM ? 'line' : 'line-group', kind, store, likes: [], photos: [], ...(kind === 'help' || kind === 'issue' ? { status: 'open' } : {}) } // 問題/求助帶狀態＝看板可追蹤到結案
  d.items = [item, ...(d.items || [])].slice(0, 1000)
  await kvSet(JOURNAL_KEY, d)
  const kindTag = { note: '📝 心得', issue: '⚠️ 問題', improve: '🔧 改善', help: '🙋 要幫忙' }[kind]
  const storeTag = store === 'ground' ? '（GROUN:D）' : store === 'abeach' ? '（A Beach）' : ''
  await reply(kind === 'help'
    ? `🙋 收到${storeTag}，已標記「要幫忙」——夥伴中心大家都看得到，有人解決會標記。15分鐘內傳照片會自動附上。`
    : `${kindTag} 收到${storeTag}，${me.name} 的工作日誌記下來了！大家在夥伴中心都看得到、一起參考。15分鐘內傳照片會自動附上 👏`)
  return { consumed: true, itemId: item.id, uid }
}
// 該夥伴 15 分鐘內最新一則日誌（附照片窗口）；urls 空＝只查不寫。回 item 或 null（沒近期日誌＝照片走原本檔案庫流程）
export async function attachJournalPhotos(uid, urls) {
  const roster = await loadRoster()
  const me = personByUid(roster, uid)
  if (!me) return null
  const d = (await kvGet(JOURNAL_KEY)) || { items: [] }
  const it = (d.items || []).find(i => i.personId === me.id && Date.now() - new Date(i.ts).getTime() < 15 * 60 * 1000)
  if (!it) return null
  if (urls && urls.length) { it.photos = [...(it.photos || []), ...urls].slice(0, 6); await kvSet(JOURNAL_KEY, d) }
  return it
}

export const buildFbPicker = (people, meId) => personPickerFlex(people, meId, 'fb|to', '💬 給誰回饋？', '點名字 → 選標籤 → 完成（+2分）')
export const buildPollCard = (poll, people) => pollFlex(poll, people)

// ── 任務提醒卡（2026-09-08 張良：提醒訊息要能直接按 完成/延1天/改日期/取消，別叫我打字）──
// buildTaskCards 是純函式（today 由外面傳，selftest 會驗）；按鈕走下面 tk| postback 分支，不經 AI。
const SP_CODE = { '工程': '工', '團隊': '團', '夥伴': '夥', '財務': '財' }
const TK_PFX = { '工': 'pm_task_', '團': 'sp_team_pm_task_', '夥': 'sp_crew_pm_task_', '財': 'sp_finance_pm_task_' }
const TK_SP = { '工': '工程', '團': '團隊', '夥': '夥伴', '財': '財務' }
const dtbtn = (label, data, initial) => ({ type: 'button', style: 'secondary', height: 'sm', margin: 'xs', action: { type: 'datetimepicker', label: String(label).slice(0, 20), data: String(data).slice(0, 290), mode: 'date', ...(initial ? { initial } : {}) } })
export function buildTaskCards(tasks, title, today) {
  const bubbles = tasks.slice(0, 10).map(t => {
    const code = SP_CODE[t.sp] || '工'
    const late = t.due && t.due < today
    const sub = [t.sp, t.owner, t.due ? `截止 ${t.due}${late ? '（逾期）' : ''}` : '沒設截止日'].filter(Boolean).join('｜')
    const short = String(t.title).slice(0, 12)
    return bubble(String(t.title).slice(0, 40), sub, [
      btn('✅ 完成', `tk|done|${code}|${t.id}`, `${short} 完成`),
      btn('⏭ 延 1 天', `tk|d1|${code}|${t.id}`, `${short} 延 1 天`),
      dtbtn('📅 改日期', `tk|pick|${code}|${t.id}`, t.due && /^\d{4}-\d{2}-\d{2}$/.test(t.due) && t.due >= today ? t.due : today),
      btn('🗑 取消任務', `tk|del|${code}|${t.id}`, `取消 ${short}`),
    ], late ? '#B42318' : '#2A5CAA')
  })
  return flex(title, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles })
}
// 確認卡（2026-09-08：改資料/金額類操作不用打「確認」，按按鈕就好）：cf|ok / cf|no 由 webhook 主檔處理（那邊有 executeActions）
export function buildConfirmCard(sub) {
  return flex('要執行這些操作嗎？', bubble('要執行嗎？', String(sub || '').slice(0, 100), [
    btn('✅ 確認執行', 'cf|ok', '確認'),
    btn('❌ 取消', 'cf|no', '取消'),
  ], '#2A5CAA'))
}
const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10)
const delRow = async (key) => { try { await fetch(`${SB_URL}/rest/v1/pm_documents?id=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: svc }) } catch (_) {} }

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
    // ── 任務卡按鈕：完成/延1天/改日期/取消（只限授權操作者；直接寫 App 同一份任務資料）──
    if (kind === 'tk') {
      if (!operators?.[uid]) { await reply(txt('這些任務按鈕只有授權操作者能用喔。')); return true }
      const pfx = TK_PFX[b]
      if (!pfx || !c) { await reply(txt('按鈕資料對不上，等下一次提醒再操作。')); return true }
      const key = pfx + c
      const rec = await kvGet(key)
      // 工程空間可能還是舊版整包 pm_tasks —— 兩種都支援
      let legacy = null, legIdx = -1
      if (!rec && b === '工') { legacy = await kvGet('pm_tasks'); legIdx = Array.isArray(legacy) ? legacy.findIndex(t => t && t.id === c) : -1 }
      const task = rec || (legIdx >= 0 ? legacy[legIdx] : null)
      if (!task) { await reply(txt('找不到這件任務（可能已經被刪掉或銷掉了）。')); return true }
      const save = async (patch) => { const nx = { ...task, ...patch, updatedAt: new Date().toISOString() }; if (rec) await kvSet(key, nx); else { legacy[legIdx] = nx; await kvSet('pm_tasks', legacy) } }
      const showT = `「${task.title}」（${TK_SP[b]}${task.due ? '｜原截止 ' + task.due : ''}）`
      // 操作留痕到該空間的活動紀錄（App 活動面板看得到；與 D哥 動作引擎同一格式）
      const act = async (label, detail) => { try { const akey = b === '工' ? 'pm_activity' : pfx.replace('pm_task_', 'pm_activity'); const cur = await kvGet(akey); const arr = Array.isArray(cur) ? cur : []; await kvSet(akey, [{ ts: new Date().toISOString(), user: (operators[uid]?.name || '操作者') + '(任務按鈕)', action: label, detail }, ...arr].slice(0, 200)) } catch (_) {} }
      if (a === 'done') { await save({ status: 'done' }); await act('修改', `按鈕完成任務${showT}`); await reply(txt(`✅ 銷掉了：${showT}\n漂亮 👍`)); return true }
      if (a === 'd1') { const base = task.due && task.due >= todayTW() ? task.due : todayTW(); const nd = addDays(base, 1); await save({ due: nd }); await act('修改', `按鈕延期任務${showT}→${nd}`); await reply(txt(`⏭ 延好了：${showT}\n新截止日：${nd}`)); return true }
      if (a === 'pick') { const nd = ev.postback?.params?.date; if (!/^\d{4}-\d{2}-\d{2}$/.test(nd || '')) { await reply(txt('沒收到日期，再按一次「📅 改日期」選一下。')); return true } await save({ due: nd }); await act('修改', `按鈕改期任務${showT}→${nd}`); await reply(txt(`📅 改好了：${showT}\n新截止日：${nd}`)); return true }
      if (a === 'del') { await reply(flex('確定要取消這件任務？', bubble('確定要取消（刪除）？', `${String(task.title).slice(0, 60)}（${TK_SP[b]}）— 刪了 App 也會移除、不再提醒`, [btn('🗑 確定刪除', `tk|del2|${b}|${c}`, `確定刪除 ${String(task.title).slice(0, 12)}`), btn('↩️ 留著好了', `tk|keep|${b}|${c}`, '留著')], '#B42318'))); return true }
      if (a === 'del2') { if (rec) await delRow(key); else { legacy.splice(legIdx, 1); await kvSet('pm_tasks', legacy) } await act('刪除', `按鈕刪除任務${showT}`); await reply(txt(`🗑 已取消（刪除）：${showT}`)); return true }
      if (a === 'keep') { await reply(txt(`好，${showT} 留著，我繼續追 💪`)); return true }
      return true
    }
    if (kind === 'doc') {
      if (!me) { await reply(txt('請先報到綁定。')); return true }
      if (a === 'cancel') { const del = b + (c ? '|' + c : ''); if (del.startsWith(`roster/${me.id}/`)) await deleteObject(del); await reply(txt('好，已取消，照片沒有存檔。')); return true } // 只准刪自己的暫存檔
      const tmp = [b, c].filter(Boolean).join('|')
      if (!FIELD_LABEL[a] || !tmp.startsWith(`roster/${me.id}/`)) { await reply(txt('資料對不上，請重傳照片。')); return true }
      const ext = ((tmp.match(/\.([a-z0-9]{1,8})$/i) || [])[1] || 'bin').toLowerCase()
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
  if (/^(給?回饋)[\s啊喔嗎啦~～!！。，]*$/.test(text)) {
    const roster = await loadRoster()
    const me = personByUid(roster, uid)
    if (!me) { await reply(txt('請先報到綁定（輸入「你的本名＋報到」）。')); return true }
    await reply(personPickerFlex(roster.people, me.id, 'fb|to', '💬 給誰回饋？', '點名字 → 選標籤 → 完成（+2分）'))
    return true
  }

  // 「投票」→ 我還沒投的進行中投票
  if (/^投票[\s啊喔嗎啦~～!！。，]*$/.test(text)) {
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

  // （工作日誌「日誌/心得 …」已抽成 handleJournalText——私訊＋群組都收、可附照片；webhook 在更外層呼叫）
  if (/^(我的心得|我的日誌)$/.test(text)) {
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
  // 操作者：出勤日報（回覆免費）：今日打卡＋班表比對
  if (isOp && /^出勤日報$/.test(text)) {
    const pj = await import('./punch.js')
    const all = await pj.todayPunchesAll()
    const lines = [`⏱ 今日出勤（${all.length} 筆打卡）`]
    const by = {}
    all.forEach(r => { (by[r.personId] = by[r.personId] || { name: r.name, recs: [] }).recs.push(r) })
    const hhmm = (t) => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
    Object.values(by).forEach(pp => lines.push(`・${pp.name}：${pp.recs.map(r => `${r.dir === 'in' ? '上' : '下'}${hhmm(r.ts)}${r.src === 'line' && !r.verified ? '(待審)' : ''}`).join(' ')}`))
    const cmp = await pj.attendanceCompareToday()
    if (cmp) lines.push(...pj.attendanceLines(cmp))
    else lines.push('（本週尚無發布班表，無法比對遲到/未到）')
    await reply(txt(lines.join('\n').slice(0, 4800)))
    return true
  }
  // 操作者：看心得彙整（回覆免費）
  const mSeeJ = isOp && text.match(/^(?:看心得|看日誌)[\s]*(\d*)$/)
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
    for (const p of bound) await pushMessages(p.lineUserId, [txt(`${p.nick || p.name}，下班辛苦了 🌙 今天工作上有遇到什麼、改了什麼嗎？\n・「日誌 你想記的」＝一般心得\n・「日誌 問題 …」「日誌 改善 …」「日誌 求助 …」＝標類型\n・開頭加 AB／GD 可標店別\n一兩句就好，大家在夥伴中心都看得到、互相參考 💪`)])
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
