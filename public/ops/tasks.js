/* ── /prep 原生任務中心 tasks.js（v1.7 2026-10-04）────────────────────────────
   v1.7（張良 7 則）：①拿掉「截止=今天」整圈紅框紅光（真兇＝tnCard 的 hot 樣式；日期文字照紅就夠醒目，
   逾期不再搶特效系統風頭）②電腦版「積分說明」鈕搬到標題正右方緊鄰（手機維持原位）③說明彈窗刪
   「分數越高＝卡片特效越華麗…」那句 ④級距 color 欄可編輯（原生色盤＋彩虹鈕；說明表/數字鈕/卡片特效
   全吃 tier.color，沒設 fallback 舊色階）⑤級距編輯器 ▲▼ 退役改 ⠿ SortableJS 拖曳 ⑥卡片特效改十級
   漸進（看級距「順位」L1 素卡→L10 彩虹流動邊框；prefers-reduced-motion 降級；全 CSS class 共用不逐卡動畫）
   ⑦等級徽章「稀有 ★10」大顆上色放卡片右上（舊小 ★N 退役；0分/沒設＝不顯示）。
   v1.6（張良 6 則）：①類別顏色恢復＝大項名稱右邊小色點鈕→7格色盤（含清除）寫 cat.color（染色鏈 tnDARKMAP/tnTcol 原在、只把鈕從列尾搬到名稱右邊）
   ②標題列「積分說明」鈕＝級距表(照特效色階上色)＋note 說明；approver（whoami 回傳）可編輯 note＋開級距編輯器，其他人唯讀；存檔整包 merge 保留 tiers
   ③標題統計搬最右＋補數字＝「待辦X・進行中Y・已完成Z・共N」④展開已完成＝完成卡排最上＋綠光描邊、未完成卡變暗(.45)（只動依大項視角）
   ⑤彈窗積分改一排數字鈕 [1,2,3,5,8,10,15,20,30,50,100]（再點同顆=清除、無0鈕、按級距特效色）＋積分說明小鈕
   ⑥ptscfg 讀取補 note 欄（tnS.ptsNote）；級距編輯器儲存改保留 note 不洗掉。
   React 版 src/tasks/TaskCenter.jsx + taskModel.js 的 vanilla 移植，取代 iframe 內嵌。
   v1.1（張良 5 則）：①指派完浮通知三選一（大群/私訊/不通知→tasknotify）②卡片完成鈕＋建立者審核流
   （createdBy/review 新欄位，主 App 合併保留）③卡片減脂（大項名/狀態字/標籤不上卡）
   ④負責人視角改每人一組看板（排序存 sp_team_pm_ownerord）⑤計時改日時分 tnFmtDur。
   v1.2：①#task=<id> 深層連結定位（捲動＋金光；v1.3 已改直開彈窗取代）
   ②「確認收到」鈕（負責人≠建立者＋未ack＋未done → 寫 ack={by,ts}＋tasknotify kind:'ack' 私訊建立者；
   之後全員看到「已收到・名字」徽章）；所有 tasknotify body 一律補 id＝任務id（後端組直達深層連結）。
   v1.3（張良「改成直接打開那張卡，讓該負責人很明確按下收到並開始計時」）：
   ①深層連結沒生效根因修正＝index.html script 順序 p10→tasks.js，p10 路由 IIFE 跑的時候 tnPage
   還不存在→taskEmbed 退回舊 iframe＝定位程式整段沒機會跑；檔尾自救 IIFE 接手（見檔尾）。
   ②#task= 改「直接開詳情彈窗」取代捲動金光；stale 快取沒這張＝等背景抓完那次 render 再開
   （tnFreshDone 旗標），抓完還是沒有→小字提示不炸；hashchange 重複進來照樣再開。
   ③彈窗頂大顆「確認收到」鈕（我是負責人＋別人建＋未ack＋未done）；按下（彈窗/卡片同一條 tnAck）
   ＝③合一：ack={by,ts}＋開始計時（claimBy=我/claimAt=now，待辦順轉進行中）＋tasknotify kind:'ack'；
   已 ack＝彈窗頂綠色狀態列「已收到・名字＋計時」、卡片照舊徽章＋🔧計時。
   v1.5（張良 2 則）：①詳情彈窗欄位對調＝「開始日｜截止日」同排（開始在左）、「優先級｜負責人」同排，
   只動排版不動邏輯。②步驟清單（Todo List）＝內容/備註下方新區塊：勾選框＋文字＋⠿把手＋✕刪（hover 才現、
   單項輕量不 confirm）、底部「＋新增步驟…」Enter 連續輸入、SortableJS 拖排完立即存；
   新欄位 todos=[{id,t,d}]（id=短隨機/t=文字/d=0或1；查證過主 App src/ 沒人讀 ck＝那是 SOP 問題回報域的欄，
   任務域乾淨→用新欄位，主 App Merge Rule {...existing,...patch} 原樣保留＝同 ack/review）；
   全走 tnUpd/diffPersist 差異存檔；卡片徽章「☑ 2/5」單色 SVG（全勾=綠）。
   資料 100% 相容主 App：
     sp_team_pm_task_<id> ＝ 一件任務一份文件（含 ord＝手動排序位置）
     sp_team_pm_tasks_v2  ＝ 遷移 marker（只讀不寫）
     sp_team_pm_data      ＝ 工程大項陣列（id/order/name/color/tcol/…其餘欄位原樣保留）
   傳輸：POST /api/mail-sync?kvproxy=<K>  body={op,key,value,token}（伺服器 permWho(task) 守門）
   依賴頁面既有全域：K、TK()、app、setTabs、curStore、tcGet/tcSet、imgView、document#upd
   入口：window.tnPage()（整合方在 taskEmbed 呼叫）；頂層只定義、不碰 DOM。
   全部全域一律 tn 前綴，避免撞頁面既有 taskLoad/taskRender（那是舊資料域）。 */
'use strict';

/* ── 常數/色票（＝TaskCenter OPS_DARK 深色皮同款） ── */
const tnINBOX = '__inbox__';
const tnQW_MAX = 15; // Quick Win 門檻（分鐘）
const tnSTATUS = [['todo', '待辦', '#9b9384'], ['doing', '進行中', '#3a6ea5'], ['done', '完成', '#3f7d4e']];
const tnPRIO = [['urgent', '超急', '#F07373'], ['high', '高', '#E8A657'], ['normal', '一般', '#C7D0DB'], ['low', '低', '#8C98A8']];
const tnC = { text: '#F2F5F9', sub: '#C7D0DB', faint: '#8C98A8', line: '#2A3240', soft: '#1C222B', bg: '#0E1217', card: '#161B22', accent: '#4DA3FF', accentSoft: '#1A2940', green: '#3DBE6C', amber: '#E8A657', red: '#F07373' };
const tnWHT = '#1C232E';   // 原本寫死白底的卡片/按鈕/輸入框
const tnMOD = '#222B38';   // 彈窗面板
const tnCBR = '#3B4654';   // 小卡邊框
const tnFNT = '#8C98A8';   // 淡字
const tnMONO = "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace";
// 存檔的淡色底（主 App 淺色值不變＝相容）→ /prep 顯示時轉同色系深色
const tnDARKMAP = { '#fef2f2': '#3C1D21', '#fff7ed': '#3C2A12', '#fefce8': '#3B3312', '#f0fdf4': '#173619', '#eff6ff': '#153050', '#faf5ff': '#2E2148', '#f5f5f5': '#272E38', '#fde8e6': '#3C1D21', '#fdf1dd': '#3C2A12', '#faf6d8': '#3B3312', '#e9f2e4': '#173619', '#e6eef6': '#153050', '#efe8f6': '#2E2148' }; // v4.41.4 張良「根本看不出什麼顏色」：卡片底色全面加飽和一階
// ── ⭐ 任務積分分級 v4.44.0（張良「值多少積分=360制度用;分數越高特效越誇張 像神裝寶物;取消卡片顏色設定」）──
// 特效強度=級距「順序」：第1級=卡片染色→第2級=彩色邊框→第3級=邊框+光暈→第4級=呼吸發光→第5級+=金光神裝
const tnPTS_DEF = [
  { name: '日常', min: 1, desc: '例行小事' },
  { name: '進階', min: 5, desc: '要花點功夫' },
  { name: '稀有', min: 10, desc: '重要任務' },
  { name: '史詩', min: 20, desc: '大 case' },
  { name: '傳說', min: 50, desc: '改變戰局' },
];
const tnPTS_FX = [ // fallback 色階（v1.7 起優先吃 tier.color；舊資料沒 color 欄才用這組，超過 5 級用最後一組）
  { c: '#9CA3AF', bg: 'rgba(156,163,175,.10)' },
  { c: '#22C55E', bg: 'rgba(34,197,94,.10)' },
  { c: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
  { c: '#A855F7', bg: 'rgba(168,85,247,.14)' },
  { c: '#F59E0B', bg: 'rgba(245,158,11,.15)' },
];
// v1.7 彩虹漸層（神話 color='rainbow' 專用；邊框/徽章底共用這條）
const tnRBG = 'linear-gradient(90deg,#FF5252,#FFB74D,#FFF176,#69F0AE,#40C4FF,#B388FF,#FF4081,#FF5252)';
function tnRgba(hex, a) { // #RGB/#RRGGBB → rgba(,,,a)（特效光暈要帶透明度）
  const f0 = String(hex || '').replace('#', '');
  const f = f0.length === 3 ? f0.split('').map(x => x + x).join('') : f0;
  const n = parseInt(f, 16) || 0;
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function tnTiers() { return (tnS.ptscfg && tnS.ptscfg.length) ? tnS.ptscfg : tnPTS_DEF; }
function tnTierFx(i) { // 第 i 級的視覺 v1.7：tier.color 優先、'rainbow'＝彩虹旗標、沒設＝fallback 舊色階
  const ts = tnTiers();
  const ti = ts[Math.min(Math.max(0, i), ts.length - 1)] || {};
  const base = tnPTS_FX[Math.min(i, tnPTS_FX.length - 1)];
  const col = String(ti.color || '').trim();
  if (col === 'rainbow') return { c: '#C084FC', bg: 'rgba(192,132,252,.12)', rb: true }; // 單色場合用紫代表色，漸層場合看 rb
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(col)) return { c: col, bg: tnRgba(col, .12), rb: false };
  return { c: base.c, bg: base.bg, rb: false };
}
function tnTier(pts) { // 回 {i, name, fx, lv} ；pts<=0 回 null；lv＝特效層級 0~9（L1~L10，看級距順位）
  const p = Number(pts) || 0; if (p <= 0) return null;
  const ts = tnTiers(); let hit = null, hi = -1;
  ts.forEach((t, i) => { if (p >= (Number(t.min) || 0) && (Number(t.min) || 0) >= hi) { hit = { i, name: t.name }; hi = Number(t.min) || 0; } });
  if (!hit) return null;
  hit.fx = tnTierFx(hit.i);
  hit.lv = Math.min(hit.i, 9);
  return hit;
}
/* v1.8 特效全可編（張良）：每級 tier.fx 可自訂 6 參數＝卡片色/框色/框粗細/卡片光/框光/閃動方式；
   沒設 tier.fx 就用「預設十級階梯」（素卡→淡染→細框→粗框→微光→強光→大光暈→呼吸→金屬呼吸→彩虹流動）。
   tnFxResolve＝把某級的「生效特效」補成完整 6 參數（打開編輯器看到目前值、改一項不用全填）。done 不給特效。 */
const TN_GLOW = [null, '0 0 7px ', '0 0 15px 2px ', '0 0 28px 7px ', '0 0 44px 13px ']; // 卡片光 0~4
const TN_RING = [null, '0 0 0 1px ', '0 0 0 2px ', '0 0 0 2px #RING,0 0 11px 1px ', '0 0 0 3px #RING,0 0 18px 3px ']; // 框光 0~4
// 預設十級階梯（以級距「順位 i」給；c＝該級代表色）：bg/bd 用 'auto' 代表吃 c、''＝無、'same'＝同卡片色
function tnFxDefault(i) {
  const D = [
    { bg: '', bd: '', bw: 0, cg: 0, bg2: 0, anim: 'none' },       // L1 素卡
    { bg: 'auto', bd: '', bw: 1.5, cg: 0, bg2: 0, anim: 'none' }, // L2 淡染（預設灰框）
    { bg: 'auto', bd: 'same', bw: 1, cg: 0, bg2: 0, anim: 'none' },   // L3 細框
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 0, bg2: 0, anim: 'none' }, // L4 粗框
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 0, bg2: 1, anim: 'none' }, // L5 微光（框光）
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 2, bg2: 0, anim: 'none' }, // L6 強光
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 3, bg2: 0, anim: 'none' }, // L7 大光暈
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 2, bg2: 0, anim: 'breathe' }, // L8 雙層呼吸
    { bg: 'metal', bd: 'same', bw: 2.5, cg: 3, bg2: 0, anim: 'breathe' },// L9 金屬呼吸
    { bg: 'auto', bd: 'same', bw: 2.5, cg: 3, bg2: 0, anim: 'rainbow' }, // L10 彩虹流動
  ];
  return Object.assign({}, D[Math.min(Math.max(0, i), D.length - 1)]);
}
function tnFxResolve(ti, i) { // 回完整 6 參數：tier.fx 有就用、缺的欄位補預設階梯
  const def = tnFxDefault(i);
  const f = (ti && ti.fx) || {};
  return {
    bg: f.bg !== undefined ? f.bg : def.bg,
    bd: f.bd !== undefined ? f.bd : def.bd,
    bw: f.bw !== undefined ? f.bw : def.bw,
    cg: f.cg !== undefined ? f.cg : def.cg,
    bg2: f.bg2 !== undefined ? f.bg2 : def.bg2,
    anim: f.anim !== undefined ? f.anim : def.anim,
  };
}
function tnPtsCardCss(t) {
  const tr = tnTier(t.pts); if (!tr || t.status === 'done') return null;
  const ti = tnTiers()[tr.i] || {};
  const rbCol = String(ti.color || '').trim() === 'rainbow';
  const c = tr.fx.c; // 代表色（彩虹→紫代表色）
  const f = tnFxResolve(ti, tr.i);
  // 卡片底色：auto＝吃 c 淡染、metal＝金屬斜向漸層、hex＝自訂淡染、''＝素底
  let bgCss;
  if (f.bg === 'metal') bgCss = 'linear-gradient(135deg,' + tnRgba(c, .2) + ',rgba(255,255,255,.06),' + tnRgba(c, .2) + ')';
  else if (f.bg === 'auto') bgCss = tnRgba(c, .13);
  else if (/^#/.test(f.bg)) bgCss = tnRgba(f.bg, .16);
  else bgCss = tnWHT;
  const anim = f.anim || 'none';
  // 彩虹流動 / 單色流動：透明 border + border-box 漸層跑動（最浮誇）
  if (anim === 'rainbow' || anim === 'flow') {
    const useRb = anim === 'rainbow' || rbCol;
    const grad = useRb ? tnRBG : 'linear-gradient(90deg,' + c + ',' + tnRgba(c, .35) + ',' + c + ',' + tnRgba(c, .35) + ',' + c + ')';
    const glow = useRb ? 'rgba(192,132,252,.45)' : tnRgba(c, .55);
    const bw = f.bw || 2.5;
    return { st: 'border:' + bw + 'px solid transparent;background:linear-gradient(' + tnWHT + ',' + tnWHT + ') padding-box,' + grad + ' border-box;background-size:100% 100%,300% 100%;box-shadow:0 0 28px 8px ' + glow + ',0 0 10px 2px rgba(255,255,255,.2);', cls: 'tnFx10' };
  }
  // 一般：底色＋框（粗細/顏色）＋卡片光＋框光；呼吸/閃爍走 CSS class
  const bdCol = f.bd === 'same' ? c : (/^#/.test(f.bd) ? f.bd : tnCBR);
  const border = f.bw > 0 ? f.bw + 'px solid ' + bdCol : 'none';
  const shadows = [];
  if (f.cg > 0 && TN_GLOW[f.cg]) shadows.push(TN_GLOW[f.cg] + tnRgba(c, .6));
  if (f.bg2 > 0 && TN_RING[f.bg2]) shadows.push(TN_RING[f.bg2].replace(/#RING/g, tnRgba(c, .5)) + tnRgba(c, .6));
  if (!shadows.length) shadows.push('0 1px 3px rgba(0,0,0,.30)');
  let cls = '';
  if (anim === 'breathe') { cls = 'tnFx8'; }
  else if (anim === 'blink') { cls = 'tnFxBl'; }
  const vars = (anim === 'breathe') ? '--tnA:' + tnRgba(c, .85) + ';--tnB:' + tnRgba(c, .35) + ';' : '';
  // L1 素卡（無框無光無底無動）＝回 null 走預設卡
  if (f.bw === 0 && f.cg === 0 && f.bg2 === 0 && anim === 'none' && (f.bg === '' )) return null;
  return { st: 'background:' + bgCss + ';border:' + border + ';box-shadow:' + shadows.join(',') + ';' + vars, cls: cls };
}
/* v1.7 等級徽章（張良「要讓看到的人覺得很爽」）：「稀有 ★10」大顆粗體、tier.color 上色；
   彩虹級＝漸層底深色字；0分/沒設分＝tnTier 回 null＝整顆不出現；舊小 ★N 退役 */
function tnPtsBadge(t) {
  const tr = tnTier(t.pts); if (!tr) return '';
  const fx = tr.fx;
  // v1.9 徽章大小可設（張良「徽章的大小也要讓我可以編輯」）：auto＝隨等級越高越大；s/m/l/xl＝固定
  const lv = tr.lv; // 0~9
  const szMode = (tnS.ptsBadge && tnS.ptsBadge.size) || 'auto';
  let fs, py, px, isz;
  if (szMode === 'auto') { fs = (10.5 + lv * 0.65).toFixed(1); py = (1.5 + lv * 0.35).toFixed(1); px = (7 + lv * 0.9).toFixed(1); isz = Math.round(10 + lv * 0.7); }
  else { const M = { s: [10.5, 1.5, 7, 10], m: [13, 2.5, 10, 13], l: [16, 3.5, 13, 16], xl: [20, 5, 16, 20] }[szMode] || [13, 2.5, 10, 13]; fs = M[0]; py = M[1]; px = M[2]; isz = M[3]; }
  const base = 'display:inline-flex;align-items:center;gap:3px;font-size:' + fs + 'px;font-weight:900;letter-spacing:.4px;padding:' + py + 'px ' + px + 'px;border-radius:999px;white-space:nowrap;';
  if (fx.rb) return '<span title="' + tnEsc(tr.name) + '・' + t.pts + ' 分" style="' + base + 'background:' + tnRBG + ';color:#10151C">' + tnEsc(tr.name) + ' ★' + t.pts + '</span>';
  return '<span title="' + tnEsc(tr.name) + '・' + t.pts + ' 分" style="' + base + 'border:1px solid ' + fx.c + ';background:' + tnRgba(fx.c, .14) + ';color:' + fx.c + '">' + tnI('star', isz, fx.c, fx.c) + tnEsc(tr.name) + ' ★' + t.pts + '</span>';
}
// v1.8 特效動畫共用 class：呼吸(tnFx8)吃 --tnA/--tnB、閃爍(tnFxBl)、流動邊框(tnFx10)；
// prefers-reduced-motion＝動畫全關（靜態框光仍在）；同畫面多張共用 class＝瀏覽器合成一次，效能不炸
(function(){ const st = document.createElement('style'); st.textContent =
  '@keyframes tnFxB{0%,100%{box-shadow:0 0 8px 2px var(--tnB),0 0 18px 6px var(--tnB)}50%{box-shadow:0 0 14px 3px var(--tnA),0 0 34px 12px var(--tnB)}}'
  + '.tnFx8{animation:tnFxB 1.8s ease-in-out infinite}'
  + '@keyframes tnFxBlink{0%,100%{opacity:1}50%{opacity:.4}}'
  + '.tnFxBl{animation:tnFxBlink 1s ease-in-out infinite}'
  + '@keyframes tnFxRB{0%{background-position:0 0,0% 50%}100%{background-position:0 0,300% 50%}}'
  + '.tnFx10{animation:tnFxRB 3.5s linear infinite}'
  + '@media (prefers-reduced-motion:reduce){.tnFx8,.tnFxBl,.tnFx10{animation:none}}';
document.head.appendChild(st); })();
const tnVIVID = { '#fef2f2': '#EF4444', '#fff7ed': '#F59E0B', '#fefce8': '#EAB308', '#f0fdf4': '#22C55E', '#eff6ff': '#3B82F6', '#faf5ff': '#A855F7', '#f5f5f5': '#9CA3AF' }; // 色盤圓點用鮮豔原色＝一眼分得出；存進資料的值不變(主App同組)
const tnTcol = (c) => (c ? (tnDARKMAP[String(c).toLowerCase()] || c) : '');
// 卡片/大項色盤（存進資料的值＝主 App 同一組淺色值，不能換）
const tnPALETTE = [['', '無'], ['#fde8e6', '紅'], ['#fdf1dd', '杏'], ['#faf6d8', '黃'], ['#e9f2e4', '綠'], ['#e6eef6', '藍'], ['#efe8f6', '紫']];
const tnTASK_COLORS = ['', '#fef2f2', '#fff7ed', '#fefce8', '#f0fdf4', '#eff6ff', '#faf5ff', '#f5f5f5'];

const tnSLabel = (s) => (tnSTATUS.find(x => x[0] === s) || tnSTATUS[0])[1];
const tnSColor = (s) => (tnSTATUS.find(x => x[0] === s) || tnSTATUS[0])[2];
const tnPMeta = (p) => tnPRIO.find(x => x[0] === p) || tnPRIO[2];
const tnRid = () => 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const tnToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }; // 本地日（不能用 toISOString=UTC）
const tnDnorm = (v) => String(v == null ? '' : v).replace(/\//g, '-').slice(0, 10);
const tnWDZH = ['日', '一', '二', '三', '四', '五', '六'];
const tnWd = (d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? ('（' + tnWDZH[new Date(d + 'T00:00:00').getDay()] + '）') : '';
const tnEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tnMob = () => (typeof window !== 'undefined' ? window.innerWidth : 1280) < 640;

/* ── 單色線條 icon（硬規：UI 不用彩色 emoji；比照頁面 _I 做法） ── */
const tnIP = {
  listtodo: '<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  cols: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  caldays: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  gantt: '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>',
  sort: '<path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16"/>',
  folderplus: '<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  wrench: '<path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.8-.7-.7-2.8Z"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  belloff: '<path d="M8.7 3A6 6 0 0 1 18 8c0 2.1.3 3.7.8 4.9"/><path d="M6.3 6.3C6.1 6.8 6 7.4 6 8c0 7-3 9-3 9h13"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>',
  checksq: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>', // v1.5 步驟進度徽章（單色＝硬規不用彩 emoji）
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', // v1.6 積分說明
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', // v1.6 編輯級距（之前被引用但沒定義＝順手補）
};
function tnI(name, size, color, fill, extra) {
  return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="' + (fill || 'none') + '" stroke="' + (color || 'currentColor') + '" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;vertical-align:-2px;' + (extra || '') + '">' + (tnIP[name] || '') + '</svg>';
}

/* ── taskModel.js 逐行移植（資料相容鐵則：欄位/語意一個都不能差） ── */
const tnIsWaiting = (t) => Boolean(String((t && t.waitingFor) == null ? '' : t.waitingFor).trim());
const tnIsQuickWin = (t) => t && t.estimatedMinutes != null && t.estimatedMinutes > 0 && t.estimatedMinutes <= tnQW_MAX;
const tnIsBlocked = (t, tasks) => ((t && t.dependsOn) || []).some((id) => { const d = (tasks || []).find((x) => x.id === id); return d && d.status !== 'done'; });
const tnMissingDeps = (t, tasks) => ((t && t.dependsOn) || []).filter((id) => !(tasks || []).some((x) => x.id === id));
function tnHasCycleFrom(startId, tasks) {
  const seen = new Set();
  const first = (tasks || []).find((x) => x.id === startId);
  const stack = [].concat((first && first.dependsOn) || []);
  while (stack.length) {
    const id = stack.pop();
    if (id === startId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = (tasks || []).find((x) => x.id === id);
    (((t && t.dependsOn) || [])).forEach((d) => stack.push(d));
  }
  return false;
}
function tnWouldCycle(taskId, depId, tasks) {
  if (!taskId || !depId) return false;
  if (taskId === depId) return true;
  const others = (tasks || []).filter((x) => x.id !== taskId);
  const cur = (tasks || []).find((x) => x.id === taskId);
  const hypo = others.concat([{ id: taskId, dependsOn: ((cur && cur.dependsOn) || []).concat([depId]) }]);
  return tnHasCycleFrom(taskId, hypo);
}
function tnStripCycles(taskId, arr, tasks) {
  const others = (tasks || []).filter((x) => x.id !== taskId);
  const ok = [];
  for (const id of arr) {
    const hypo = others.concat([{ id: taskId, dependsOn: ok.concat([id]) }]);
    if (!tnHasCycleFrom(taskId, hypo)) ok.push(id);
  }
  return ok;
}
// Merge Rule：只整理「patch 有出現的 key」；空值 → undefined（JSON 存檔時整個 key 消失）
function tnNormalizePatch(patch, taskId, tasks) {
  const p = Object.assign({}, patch || {});
  if ('owner' in p) { const v = String(p.owner == null ? '' : p.owner).trim(); p.owner = v || undefined; }
  if ('waitingFor' in p) { const v = String(p.waitingFor == null ? '' : p.waitingFor).trim(); p.waitingFor = v || undefined; }
  if ('dependsOn' in p) {
    let arr = Array.isArray(p.dependsOn) ? p.dependsOn : [];
    arr = [...new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))];
    arr = arr.filter((id) => id !== taskId);
    p.dependsOn = tnStripCycles(taskId, arr, tasks);
  }
  if ('estimatedMinutes' in p) {
    const v = p.estimatedMinutes;
    if (v === null || v === undefined || v === '') p.estimatedMinutes = null;
    else { const n = Number(v); p.estimatedMinutes = Number.isInteger(n) && n > 0 ? n : null; }
  }
  if ('tags' in p) { const arr = Array.isArray(p.tags) ? p.tags : []; p.tags = [...new Set(arr.map((s) => String(s || '').trim()).filter(Boolean))]; }
  if ('pinned' in p) p.pinned = p.pinned ? true : undefined;
  if ('color' in p) { const v = String(p.color == null ? '' : p.color).trim(); p.color = v || undefined; }
  return p;
}
const tnPRIO_ORD = { urgent: 0, high: 1, normal: 2, low: 3 };
const tnCmpDue = (a, b) => ((a.due || '9999') !== (b.due || '9999')) ? ((a.due || '9999') < (b.due || '9999') ? -1 : 1) : (((tnPRIO_ORD[a.priority] != null ? tnPRIO_ORD[a.priority] : 2)) - ((tnPRIO_ORD[b.priority] != null ? tnPRIO_ORD[b.priority] : 2)));
const tnCmpPrio = (a, b) => (((tnPRIO_ORD[a.priority] != null ? tnPRIO_ORD[a.priority] : 2)) - ((tnPRIO_ORD[b.priority] != null ? tnPRIO_ORD[b.priority] : 2))) || tnCmpDue(a, b);
function tnOrderTasks(arr, mode) {
  const base = mode === 'due' ? [...arr].sort(tnCmpDue) : mode === 'prio' ? [...arr].sort(tnCmpPrio) : [...arr];
  return base.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); // 釘選永遠最前（穩定排序）
}
function tnMergeTask(existing, patch, tasks) {
  return Object.assign({}, existing, tnNormalizePatch(patch, existing.id, tasks), { updatedAt: new Date().toISOString() });
}
function tnRemoveTaskAndRefs(tasks, id) {
  return (tasks || []).filter((x) => x.id !== id).map((x) => (x.dependsOn || []).includes(id) ? Object.assign({}, x, { dependsOn: x.dependsOn.filter((d) => d !== id) }) : x);
}

/* ── 狀態 ── */
const tnS = {
  tasks: null, cats: null, view: 'today', q: '', fStatus: 'open', sortMode: 'manual',
  showDone: false, showAllDone: false, sel: null, drag: null, dragCat: null,
  editCat: null, colorCat: null, gdNames: [], me: '', meApprover: false, ptsNote: '', ptsBadge: { pos: 'iconcol', size: 'auto' }, quick: '', gnew: {}, tagIn: '', newCatIn: '',
  hover: null, colOf: {}, inited: false, loaded: false, ownerCustom: false,
  assignAsk: null,  // 指派完浮出的通知三選一 {id,owner}
  dragOwn: null,    // 負責人視角：正在拖的人員組
  ownerOrd: null,   // 負責人分組排序 {order:[姓名…]}（sp_team_pm_ownerord 全裝置同步）
};
let tnPersisted = [];   // 上次已存清單（差異寫入比對基準；快照含 ord）
let tnSaveTimer = null; // 存檔防抖（0.5 秒）
let tnInflight = 0;     // 寫入中計數（背景重抓時不蓋手上的修改）
let tnUndo = [];        // Cmd+Z 復原堆疊（30 步）
let tnWarned = 0;       // 權限/網路失敗提示節流

/* ── 儲存層：kvproxy（與主 App 同一份 sp_team_ 資料雙向同步） ── */
async function tnKV(body) {
  try {
    const r = await fetch('/api/mail-sync?kvproxy=' + encodeURIComponent(typeof K !== 'undefined' ? K : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({}, body, { token: (typeof TK === 'function' ? TK() : '') })),
    });
    return await r.json().catch(() => ({ ok: false }));
  } catch (_) { return { ok: false, error: '網路不穩' }; }
}
function tnPermFail(r) { // 寫入失敗（沒權限/沒綁定/網路）→ 提示一次，不洗版
  if (Date.now() - tnWarned < 15000) return;
  tnWarned = Date.now();
  alert((r && r.error) ? ('沒存上：' + r.error) : '這次修改可能沒存上（網路不穩或沒有編輯權限）。');
}
async function tnFetchAll() { // 任務（逐筆檔合併）＋大項＋負責人分組排序 一次抓
  const [pr, cr, orr, pcr] = await Promise.all([tnKV({ op: 'getPrefix', key: 'sp_team_pm_task_' }), tnKV({ op: 'get', key: 'sp_team_pm_data' }), tnKV({ op: 'get', key: 'sp_team_pm_ownerord' }), tnKV({ op: 'get', key: 'sp_team_pm_ptscfg' })]);
  if (!pr || !pr.ok) return null;
  const tasks = Object.values(pr.rows || {}).map(v => { try { return JSON.parse(v); } catch (_) { return null; } })
    .filter(t => t && t.id).sort((a, b) => ((a.ord != null ? a.ord : 0)) - ((b.ord != null ? b.ord : 0)));
  let cats = []; try { cats = cr && cr.value != null ? JSON.parse(cr.value) : []; } catch (_) { cats = []; }
  let oord = null; try { oord = orr && orr.value != null ? JSON.parse(orr.value) : null; } catch (_) { oord = null; }
  let pcfg = null; try { pcfg = pcr && pcr.value != null ? JSON.parse(pcr.value) : null; } catch (_) { pcfg = null; }
  // v1.6 ptscfg 文件多了 note 欄（積分怎麼算說明）＝tiers 之外順手帶回，存檔時兩者同住一份要整包 merge
  return { tasks, cats: Array.isArray(cats) ? cats : [], ownerOrd: (oord && Array.isArray(oord.order)) ? oord : null, ptscfg: (pcfg && Array.isArray(pcfg.tiers)) ? pcfg.tiers : null, ptsNote: (pcfg && typeof pcfg.note === 'string') ? pcfg.note : '', ptsBadge: (pcfg && pcfg.badge) ? pcfg.badge : null };
}
// stale-first 快取（沿用頁面 tcGet/tcSet=localStorage obt_ 前綴；單獨載入時退回自己存）
function tnCGet(k) { try { return (typeof tcGet === 'function') ? tcGet(k) : JSON.parse(localStorage.getItem('obt_' + k)); } catch (_) { return null; } }
function tnCSet(k, d) { try { (typeof tcSet === 'function') ? tcSet(k, d) : localStorage.setItem('obt_' + k, JSON.stringify(d)); } catch (_) {} }
function tnCacheSave() { tnCSet('tnData', { tasks: tnS.tasks || [], cats: tnS.cats || [], ownerOrd: tnS.ownerOrd }); }

// 存檔：畫面即時、停手 0.5 秒才寫後端；只寫有變動的那幾筆（含 ord 變動）、刪被移除的 → 與主 App diffPersist 同款
function tnSave(list, opts) {
  opts = opts || {};
  if (!opts.skipUndo && tnS.tasks) { tnUndo.push(tnS.tasks); if (tnUndo.length > 30) tnUndo.shift(); }
  tnS.tasks = list;
  if (tnSaveTimer) clearTimeout(tnSaveTimer);
  tnSaveTimer = setTimeout(tnFlushDiff, 500);
  tnCacheSave();
  if (!opts.skipRender) tnRender();
}
async function tnFlushDiff() {
  tnSaveTimer = null;
  const prev = tnPersisted, next = tnS.tasks || [];
  const snap = (t, i) => JSON.stringify(Object.assign({}, t, { ord: i })); // ord＝整份清單裡的位置（與 lib/records.js 一致）
  const prevMap = new Map((prev || []).map((t, i) => [t.id, snap(t, i)]));
  const puts = []; const alive = new Set();
  next.forEach((t, i) => { if (!t || !t.id) return; alive.add(t.id); const s = snap(t, i); if (prevMap.get(t.id) !== s) puts.push(['sp_team_pm_task_' + t.id, s]); });
  const dels = (prev || []).filter(t => t && t.id && !alive.has(t.id));
  tnPersisted = next;
  tnInflight++;
  try {
    for (const kv of puts) { const r = await tnKV({ op: 'set', key: kv[0], value: kv[1] }); if (!r || !r.ok) { tnPermFail(r); break; } }
    for (const t of dels) { const r = await tnKV({ op: 'del', key: 'sp_team_pm_task_' + t.id }); if (!r || !r.ok) { tnPermFail(r); break; } }
  } finally { tnInflight--; }
}
function tnFlushNow() { if (tnSaveTimer) { clearTimeout(tnSaveTimer); tnSaveTimer = null; tnFlushDiff(); } }

/* ── 通知口（後端 ?tasknotify 全包：LINE 大群/私訊＋GD App 推播，前端只管丟 body）
   私訊不到（對方沒綁定）後端會回 error → 原文 alert 給使用者，任務本身照存不受影響 */
async function tnNotify(body) {
  try {
    const r = await fetch('/api/mail-sync?tasknotify=' + encodeURIComponent(typeof K !== 'undefined' ? K : ''), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: (typeof TK === 'function' ? TK() : '') }, body)),
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) alert((j && j.error) ? j.error : '通知沒發出去（網路不穩），任務本身有存。');
    return j || { ok: false };
  } catch (_) { alert('通知沒發出去（網路不穩），任務本身有存。'); return { ok: false }; }
}

/* ── 計時格式共用（張良「已N分看不懂多久」）：≥1日→已2日3時41分、≥1時→已3時41分、不足→已41分 ── */
function tnFmtDur(min) {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  if (m >= 1440) return '已' + Math.floor(m / 1440) + '日' + Math.floor((m % 1440) / 60) + '時' + (m % 60) + '分';
  if (m >= 60) return '已' + Math.floor(m / 60) + '時' + (m % 60) + '分';
  return '已' + m + '分';
}

/* ── 大項（cats＝sp_team_pm_data 整包陣列；只動 name/order/color/tcol，其餘欄位原樣保留） ── */
function tnCatsWrite(next) {
  tnS.cats = next;
  tnKV({ op: 'set', key: 'sp_team_pm_data', value: JSON.stringify(next) }).then(r => { if (!r || !r.ok) tnPermFail(r); });
  tnCacheSave();
  tnRender();
}
function tnAddCat(name) { // 與 opsTasks.jsx onAddCat 同款欄位
  const prev = tnS.cats || [];
  tnCatsWrite(prev.concat([{ id: 'cat-' + Date.now(), order: prev.length, name: name, budget: 0, status: 'pending', items: [] }]));
}
function tnRenameCat(id, name) { tnCatsWrite((tnS.cats || []).map(c => c.id === id ? Object.assign({}, c, { name: name }) : c)); }
function tnSetCatColor(id, color) { tnS.colorCat = null; tnCatsWrite((tnS.cats || []).map(c => c.id === id ? Object.assign({}, c, { color: color }) : c)); }
function tnMoveCat(fromId, o) { // 拖大項＋tcol 欄記憶＋freeze（與 opsTasks.jsx onMoveCat 同邏輯）
  o = o || {};
  const prev = tnS.cats || [];
  let base = prev;
  if (o.freeze) base = prev.map(c => (c.tcol === undefined || c.tcol === null) && o.freeze[c.id] !== undefined ? Object.assign({}, c, { tcol: o.freeze[c.id] }) : c);
  const arr = [...base].sort((a, b) => ((a.order != null ? a.order : 0)) - ((b.order != null ? b.order : 0)));
  const fi = arr.findIndex(c => c.id === fromId); if (fi < 0) return;
  const m = arr.splice(fi, 1)[0];
  const m2 = o.col === undefined ? m : Object.assign({}, m, { tcol: o.col });
  if (o.beforeId) { const ti = arr.findIndex(c => c.id === o.beforeId); arr.splice(ti < 0 ? arr.length : ti, 0, m2); }
  else if (o.afterId) { const ti = arr.findIndex(c => c.id === o.afterId); arr.splice(ti < 0 ? arr.length : ti + 1, 0, m2); }
  else arr.push(m2);
  tnCatsWrite(arr.map((c, i) => Object.assign({}, c, { order: i })));
}
function tnGroups() {
  return [{ id: tnINBOX, name: '收件匣' }].concat(
    (tnS.cats || []).filter(c => !c.nonProject).slice().sort((a, b) => ((a.order != null ? a.order : 0)) - ((b.order != null ? b.order : 0)))
      .map(c => ({ id: c.id, name: c.name, color: c.color || '', tcol: c.tcol })));
}
function tnCatName(id) { return (id === tnINBOX || !id) ? '收件匣' : (((tnS.cats || []).find(c => c.id === id) || {}).name || '收件匣'); }
function tnTasksOf(catId) { return (tnS.tasks || []).filter(t => (t.catId || tnINBOX) === catId); }
function tnMatchQ(t) { const q = tnS.q.trim().toLowerCase(); return !q || (t.title + (t.note || '') + (t.tags || []).join('')).toLowerCase().includes(q); }

/* ── 任務動作 ── */
function tnAddQuick() {
  const t = (tnS.quick || '').trim(); if (!t) return;
  // createdBy＝建立者記名（審核流靠它認人；沒綁定身分就不記＝JSON 存檔時 undefined 自動消失）
  const task = { id: tnRid(), title: t, note: '', status: 'todo', catId: tnINBOX, start: '', due: '', priority: 'normal', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: tnS.me || undefined };
  tnS.quick = '';
  tnSave([task].concat(tnS.tasks || []));
}
function tnAddToGroup(catId) {
  const t = (tnS.gnew[catId] || '').trim(); if (!t) return;
  const task = { id: tnRid(), title: t, note: '', status: 'todo', catId: catId, start: '', due: '', priority: 'normal', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: tnS.me || undefined };
  tnS.gnew[catId] = '';
  tnSave([task].concat(tnS.tasks || []));
}
// Merge Rule：一律 {...existing, ...patch}，絕不重建 task
function tnUpd(id, patch, silent) {
  tnSave((tnS.tasks || []).map(t => t.id === id ? tnMergeTask(t, patch, tnS.tasks) : t), { skipRender: !!silent });
}
/* ── 完成三分支（張良：別人建的不能自己關，要給建立者過目）──
   自己建（或老任務沒 createdBy、或我沒綁定認不了人）→ 直接完成封存（原本 done 流程）
   別人建 → 標 review={by,ts} 送審＋私訊建立者，卡片掛「待審核」
   建立者看到待審核 → 通過＝done＋私訊回報人；退回＝清 review＋私訊回報人
   勾選框＝完成鈕同一條路（tnToggleDone 改道走 tnFinish） */
function tnFinish(id) {
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t || t.status === 'done') return;
  if (!t.createdBy || !tnS.me || t.createdBy === tnS.me) { tnUpd(id, { status: 'done', review: undefined }); return; }
  if (t.review && t.review.by) return; // 已送審就不重複送
  tnUpd(id, { review: { by: tnS.me, ts: new Date().toISOString() } });
  tnNotify({ kind: 'review', id: id, creator: t.createdBy, title: t.title });
}
function tnApprove(id) { // 建立者點「通過」：完成封存＋告訴回報人過了
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  const by = (t.review && t.review.by) || '';
  tnUpd(id, { status: 'done' });
  tnNotify({ kind: 'approve', id: id, doer: by, title: t.title });
}
function tnReject(id) { // 建立者點「退回」：清審核標記＋告訴回報人再處理
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  if (!confirm('退回「' + (t.title || '') + '」？會通知回報人再處理。')) return;
  const by = (t.review && t.review.by) || '';
  tnUpd(id, { review: undefined });
  tnNotify({ kind: 'reject', id: id, doer: by, title: t.title });
}
/* v1.3 確認收到＝③合一（張良「很明確按下收到的按鈕，並且開始計時」；彈窗大鈕/卡片小鈕同一條路）
   a. 寫 ack={by,ts}（走 diffPersist 差異存檔；新欄位主 App 合併原樣保留＝同 review）
   b. 開始計時＝「我來解決」同一組欄位 claimBy=我/claimAt=now（計時起點＝按下那刻）；
      已有人在計時（含自己）就不動既有起點、不搶別人的錶；任務還是待辦順手轉進行中
   c. tasknotify kind:'ack' fire-and-forget（通知失敗不影響已存的 ack）→ 重畫＝原地變已收到＋計時 */
function tnAck(id) {
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  if (t.ack && t.ack.by) return; // 已確認過不重複（重複按防呆）
  if (t.status === 'done' || !tnS.me || t.owner !== tnS.me || t.createdBy === tnS.me) return; // v4.41.9 跟顯示條件同步放寬（張良「按了沒反應」真因＝這裡還留 !t.createdBy 舊守衛，舊任務按下默默返回）
  const patch = { ack: { by: tnS.me, ts: new Date().toISOString() } };
  if (!t.claimBy) { patch.claimBy = tnS.me; patch.claimAt = Date.now(); }
  if (t.status === 'todo') patch.status = 'doing';
  tnUpd(id, patch);
  tnNotify({ kind: 'ack', id: id, title: t.title || '', due: t.due || '', creator: t.createdBy });
}
function tnToggleDone(id) {
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  if (t.status === 'done') { tnUpd(id, { status: 'todo', review: undefined }); return; } // 重開＝順手清舊審核紀錄
  tnFinish(id); // 未完成→走三分支（別人建的＝送審不是直接關）
}
function tnDel(id) { // 刪除＝同一次寫回「刪任務＋清掉所有 dependsOn 引用」
  const t = (tnS.tasks || []).find(x => x.id === id);
  if (!confirm('刪除任務「' + ((t && t.title) || '') + '」？')) return;
  tnS.sel = null;
  tnSave(tnRemoveTaskAndRefs(tnS.tasks, id));
}
function tnClaim(id) { if (!tnS.me) return; tnUpd(id, { claimBy: tnS.me, claimAt: Date.now(), status: 'doing' }); }
function tnUnclaim(id) { tnUpd(id, { claimBy: '', claimAt: null, status: 'todo' }); }
function tnSunToggle(id) { // ☀ 設為今天必處理 / 退出（記 prevDue 可復原）
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  if (t.due === tnToday()) tnUpd(id, { due: t.prevDue !== undefined ? t.prevDue : '', prevDue: undefined });
  else tnUpd(id, { due: tnToday(), prevDue: t.due || '' });
}
function tnPinToggle(id) { const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return; tnUpd(id, { pinned: !t.pinned }); }
function tnDepAdd(id, depId) {
  if (!depId) return;
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  if (tnWouldCycle(id, depId, tnS.tasks)) { alert('不能加這個依賴：會形成循環（例如 A 依賴 B、B 又依賴回 A）。'); tnRender(); return; }
  tnUpd(id, { dependsOn: (t.dependsOn || []).concat([depId]) });
}
function tnDepDel(id, depId) { const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return; tnUpd(id, { dependsOn: (t.dependsOn || []).filter(x => x !== depId) }); }
function tnDepClean(id) { const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return; tnUpd(id, { dependsOn: (t.dependsOn || []).filter(did => (tnS.tasks || []).some(x => x.id === did)) }); }
function tnTagAdd(id) {
  const v = (tnS.tagIn || '').trim(); if (!v) return;
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  tnS.tagIn = '';
  tnUpd(id, { tags: (t.tags || []).concat([v]) });
}
function tnTagDel(id, encTag) { const tg = decodeURIComponent(encTag); const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return; tnUpd(id, { tags: (t.tags || []).filter(x => x !== tg) }); }
function tnOwnerSel(id, v) {
  if (v === '__custom') { tnS.ownerCustom = true; tnRender(); return; }
  tnS.ownerCustom = false;
  const t = (tnS.tasks || []).find(x => x.id === id);
  if (v && t && (t.owner || '') !== v) tnS.assignAsk = { id: id, owner: v }; // 從無→有人、或換人 → 浮通知三選一
  tnUpd(id, { owner: v });
}
function tnOwnerCustom(id, v) {
  tnS.ownerCustom = false;
  const nm = (v || '').trim(); if (!nm) { tnRender(); return; }
  const t = (tnS.tasks || []).find(x => x.id === id);
  if (t && (t.owner || '') !== nm) tnS.assignAsk = { id: id, owner: nm };
  tnUpd(id, { owner: nm });
}
function tnOpen(id) { tnS.sel = id; tnS.ownerCustom = false; tnS.tagIn = ''; tnRender(); }
function tnClose() { tnS.sel = null; tnRender(); }
function tnAttDel(id, fid) {
  if (!confirm('移除這個附件？')) return;
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  tnUpd(id, { files: (t.files || []).filter(f => f.id !== fid) });
}
/* 附件上傳：走 /prep 既有簽名直傳（?sopsign → PUT Supabase photos 桶），檔案格式與主 App 同款 {id,url,path,name,isImage} */
async function tnAttachAdd(id, files) {
  const btn = document.getElementById('tnAttBtn'); if (btn) btn.textContent = '上傳中…';
  const out = [];
  for (const f of files) {
    try {
      if (f.size > 80 * 1024 * 1024) { alert((f.name || '檔案') + ' 超過 80MB，跳過'); continue; }
      const ext = (((f.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
      const sr = await fetch('/api/mail-sync?sopsign=' + encodeURIComponent(typeof K !== 'undefined' ? K : ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ext: ext }) });
      const sd = await sr.json();
      if (!sd || !sd.ok) { alert('取得上傳位址失敗'); continue; }
      const ur = await fetch(sd.uploadUrl, { method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
      if (!ur.ok) { alert((f.name || '檔案') + ' 上傳失敗'); continue; }
      out.push({ id: 'tf' + Math.random().toString(36).slice(2, 7), url: sd.publicUrl, path: (String(sd.publicUrl).split('/object/public/photos/')[1] || ''), name: f.name || '檔案', isImage: /^image\//.test(f.type) });
    } catch (_) { alert('上傳失敗，再試一次'); }
  }
  if (out.length) { const t = (tnS.tasks || []).find(x => x.id === id); if (t) tnUpd(id, { files: (t.files || []).concat(out) }); else tnRender(); }
  else tnRender();
}
function tnAttachPick(id, inputEl) { const fs = Array.from(inputEl.files || []); inputEl.value = ''; if (fs.length) tnAttachAdd(id, fs); }
function tnImgView(u) { if (typeof imgView === 'function') imgView(u); else window.open(u, '_blank'); }

/* 拖曳：把 dragId 移到 target 之前；可同時改 catId / status（與 React 版 moveTo 同邏輯） */
function tnMoveTo(dragId, o) {
  o = o || {};
  if (!dragId) return;
  const list = [...(tnS.tasks || [])];
  const fi = list.findIndex(t => t.id === dragId); if (fi < 0) return;
  const moved = Object.assign({}, list[fi]);
  if (o.catId !== undefined) moved.catId = o.catId;
  if (o.status !== undefined) moved.status = o.status;
  moved.updatedAt = new Date().toISOString();
  list.splice(fi, 1);
  let ti = o.beforeId ? list.findIndex(t => t.id === o.beforeId) : -1;
  if (ti < 0) { // 沒指定就放到「同群組」的最後
    const grpKey = o.catId !== undefined ? o.catId : moved.catId;
    const stKey = o.status !== undefined ? o.status : moved.status;
    let last = -1;
    list.forEach((t, idx) => { const okCat = tnS.view === 'board' ? t.status === stKey : (t.catId || tnINBOX) === grpKey; if (okCat) last = idx; });
    ti = last + 1;
  }
  list.splice(ti, 0, moved);
  tnSave(list);
}

/* ── 拖放 handlers（拖曳中不整頁重畫＝HTML5 DnD 不中斷；提示線用直接改 style） ── */
function tnDS(e, id) { tnS.drag = id; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (_) {} const el = e.currentTarget; setTimeout(() => { try { el.style.opacity = 0.4; } catch (_) {} }, 0); }
function tnDE() { const had = tnS.drag || tnS.dragCat || tnS.dragOwn; tnS.drag = null; tnS.dragCat = null; tnS.dragOwn = null; if (had) tnRender(); }
function tnDOvCard(e) { if (tnS.drag) { e.preventDefault(); e.stopPropagation(); } }
function tnDropCard(e, id) {
  if (!tnS.drag) return;
  e.preventDefault(); e.stopPropagation();
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) { tnS.drag = null; return; }
  const dragId = tnS.drag; tnS.drag = null;
  tnMoveTo(dragId, { catId: tnS.view === 'group' ? t.catId : undefined, status: tnS.view === 'board' ? t.status : undefined, beforeId: id });
}
function tnZOver(e) { if (tnS.drag) { e.preventDefault(); e.currentTarget.style.outline = '1px dashed ' + tnC.accent; e.currentTarget.style.outlineOffset = '-1px'; } }
function tnZLeave(e) { e.currentTarget.style.outline = 'none'; }
function tnZDrop(e, kind, val) {
  if (!tnS.drag) return;
  e.preventDefault(); e.currentTarget.style.outline = 'none';
  const id = tnS.drag; tnS.drag = null;
  if (kind === 'cat') tnMoveTo(id, { catId: val });
  else if (kind === 'status') tnMoveTo(id, { status: val });
  else if (kind === 'owner') { // 拖卡到某人組＝指派負責人（owner 欄）＋浮通知三選一；拖回未指派＝清空不通知
    const nm = decodeURIComponent(val || '');
    const t = (tnS.tasks || []).find(x => x.id === id);
    if (((t && t.owner) || '') === nm) { tnRender(); return; }
    if (nm) tnS.assignAsk = { id: id, owner: nm };
    tnUpd(id, { owner: nm });
  }
  else if (kind === 'before') tnMoveTo(id, { beforeId: val }); // 清單手動排序
}
// 大項拖曳（上半=排它上面、下半=排它下面；提示線直接畫）
function tnCDS(e, id) { e.stopPropagation(); tnS.dragCat = id; try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {} }
function tnCatOver(e, id) {
  if (!(tnS.dragCat && tnS.dragCat !== id && id !== tnINBOX)) return;
  e.preventDefault(); e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  const p = e.clientY < r.top + r.height / 2 ? 'b' : 'a';
  e.currentTarget.dataset.tnpos = p;
  e.currentTarget.style.boxShadow = p === 'b' ? ('0 -4px 0 0 ' + tnC.accent) : ('0 4px 0 0 ' + tnC.accent);
}
function tnCatLeave(e) { e.currentTarget.style.boxShadow = 'none'; }
function tnCatDrop(e, id) {
  if (!(tnS.dragCat && tnS.dragCat !== id && id !== tnINBOX)) return;
  e.preventDefault(); e.stopPropagation(); e.currentTarget.style.boxShadow = 'none';
  const p = e.currentTarget.dataset.tnpos || 'b';
  const from = tnS.dragCat; tnS.dragCat = null;
  const o = { col: tnS.colOf[id], freeze: Object.assign({}, tnS.colOf) };
  o[p === 'b' ? 'beforeId' : 'afterId'] = id;
  tnMoveCat(from, o);
}
function tnColOver(e) { if (tnS.dragCat) { e.preventDefault(); e.currentTarget.style.outline = '2px dashed ' + tnC.accent; e.currentTarget.style.outlineOffset = '2px'; } }
function tnColLeave(e) { e.currentTarget.style.outline = 'none'; }
function tnColDrop(e, i) { if (!tnS.dragCat) return; e.preventDefault(); e.currentTarget.style.outline = 'none'; const from = tnS.dragCat; tnS.dragCat = null; tnMoveCat(from, { col: i, freeze: Object.assign({}, tnS.colOf) }); }

/* 大項改名/調色/新增 */
function tnCatEditStart(id, encName) { tnS.editCat = { id: id, name: decodeURIComponent(encName) }; tnRender(); }
function tnCatRenameCommit() { const ec = tnS.editCat; tnS.editCat = null; if (ec && ec.name.trim()) tnRenameCat(ec.id, ec.name.trim()); else tnRender(); }
function tnCatEditKey(e) { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.target.blur(); } if (e.key === 'Escape') { tnS.editCat = null; tnRender(); } }
function tnColorCatToggle(id) { tnS.colorCat = tnS.colorCat === id ? null : id; tnRender(); }
function tnNewCatCommit() { const v = (tnS.newCatIn || '').trim(); if (!v) return; tnS.newCatIn = ''; tnAddCat(v); }

/* 全域貼上（滑鼠停在卡上 or 彈窗開著 → 剪貼簿的圖直接進附件）＋ Cmd+Z 復原 */
function tnPaste(e) {
  if (typeof curStore !== 'undefined' && curStore !== 'taskx') return;
  const items = e.clipboardData && e.clipboardData.items; if (!items) return;
  const fs = []; for (const it of items) { if (it.type && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) fs.push(f); } }
  if (!fs.length) return;
  const tid = tnS.sel || tnS.hover; if (!tid) return;
  e.preventDefault();
  tnAttachAdd(tid, fs);
}
function tnKey(e) {
  if (typeof curStore !== 'undefined' && curStore !== 'taskx') return;
  if (!(e.metaKey || e.ctrlKey) || String(e.key).toLowerCase() !== 'z' || e.shiftKey) return;
  const tag = ((e.target && e.target.tagName) || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
  if (!tnUndo.length) return;
  e.preventDefault();
  tnSave(tnUndo.pop(), { skipUndo: true });
}

/* ── 畫面 ── */
const tnInp = 'border:1px solid ' + tnC.line + ';border-radius:8px;padding:7px 10px;font-size:13px;background:' + tnWHT + ';color:' + tnC.text + ';box-sizing:border-box;outline:none;font-family:inherit';
const tnDateInp = tnInp + ';color-scheme:dark;cursor:pointer';
const tnLbl = 'display:block;font-size:11px;letter-spacing:.5px;color:' + tnC.faint + ';font-weight:500;margin-bottom:10px';
function tnPill(color, label) {
  return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:' + tnC.sub + ';background:' + tnC.soft + ';border-radius:999px;padding:2px 8px;white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' + label + '</span>';
}
function tnEmpty(icon, text, pad) {
  return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:' + (pad || 10) + 'px 0;color:' + tnC.faint + '">' + tnI(icon, 18) + '<span style="font-size:12px;color:' + tnC.sub + '">' + text + '</span></div>';
}
function tnRender() {
  if (typeof document === 'undefined') return;
  const host = (typeof app !== 'undefined' && app) ? app : document.getElementById('app');
  if (!host) return;
  if (typeof curStore !== 'undefined' && curStore !== 'taskx') return; // 已切去別頁，不蓋畫面
  // 焦點保留（innerHTML 整換會掉焦點）：記住 activeElement id，畫完原位接回
  const ae = document.activeElement; const aid = ae && ae.id; let ss = null;
  try { if (ae && ae.setSelectionRange && /text|search|^$/.test(ae.type || '')) ss = ae.selectionStart; } catch (_) {}
  host.innerHTML = tnRoot();
  if (aid) { const el = document.getElementById(aid); if (el && el !== document.activeElement) { try { el.focus(); if (ss != null && el.setSelectionRange) el.setSelectionRange(ss, ss); } catch (_) {} } }
  tnFocusTry(); // v1.3 深層連結＝資料就緒的那次 render 直接開詳情彈窗（沒 tnFocusId 一行就返回，零成本）
  tnTodoSortInit(); // v1.5 步驟清單拖排：彈窗開著才掛 SortableJS（沒開＝收掉舊實例就返回）
}
function tnRoot() {
  if (tnS.tasks === null) { // 載入中 skeleton（淺灰佔位塊）
    return '<div style="max-width:1240px;margin:6px auto;padding:0 4px">' + [38, 120, 120].map(h => '<div style="height:' + h + 'px;background:' + tnC.soft + ';border-radius:8px;margin-bottom:12px"></div>').join('') + '</div>';
  }
  const v = tnS.view;
  let h = '<div style="max-width:1240px;margin:6px auto;padding:' + (tnMob() ? '12px 8px' : '16px') + ';background:' + tnC.bg + ';border:1px solid ' + tnC.line + ';border-radius:12px">';
  // 第一行：標題/搜尋/積分說明/統計（v1.6 統計搬到最右＋補進行中與已完成數字）
  const nTodo = tnS.tasks.filter(t => t.status === 'todo').length;
  const nDoing = tnS.tasks.filter(t => t.status === 'doing').length;
  const nDone = tnS.tasks.filter(t => t.status === 'done').length;
  // v1.7 需求②：電腦版「積分說明」鈕改放標題正右方緊鄰（搜尋框之前）；手機版維持原位（搜尋框之後）
  const ptsHelpBtn = '<button onclick="tnPtsHelp()" title="積分級距與計分方式" style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0;border:1px solid ' + tnC.line + ';background:' + tnC.soft + ';color:' + tnC.sub + ';border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;white-space:nowrap">' + tnI('star', 12) + '積分說明</button>';
  h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'
    + '<span style="color:' + tnC.sub + '">' + tnI('listtodo', 18) + '</span>'
    + '<div style="font-size:17px;font-weight:600;color:' + tnC.text + '">任務中心</div>'
    + (tnMob() ? '' : ptsHelpBtn)
    + '<div style="flex:1"></div>'
    + '<div style="position:relative">'
    + '<span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:' + tnC.faint + '">' + tnI('search', 13) + '</span>'
    + '<input id="tnQIn" value="' + tnEsc(tnS.q) + '" oninput="tnQIn(this.value)" placeholder="搜尋任務…" style="' + tnInp + ';width:' + (tnMob() ? 130 : 170) + 'px;padding:6px 10px 6px 28px;font-size:12.5px">'
    + (tnS.q ? '<button onclick="tnS.q=\'\';tnRender()" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:' + tnC.faint + ';cursor:pointer;padding:0;display:flex">' + tnI('x', 13) + '</button>' : '')
    + '</div>'
    + (tnMob() ? ptsHelpBtn : '')
    + '<span style="font-size:12px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums;white-space:nowrap">待辦 ' + nTodo + '・進行中 ' + nDoing + '・已完成 ' + nDone + '・共 ' + tnS.tasks.length + '</span>'
    + '</div>';
  // 第二行：今日＋視角分頁＋排序（排序鈕永遠佔位，切檢視零位移；v4.43.9 張良「今日跟那排選項距離太遠」：今日從第一行最右移到視角切換器前面緊鄰）
  const TABS = [['group', '依大項', 'grid'], ['board', '看板', 'cols'], ['owner', '負責人', 'users'], ['list', '清單', 'list'], ['timeline', '時間軸', 'caldays'], ['gantt', '甘特', 'gantt'], ['mind', '心智圖', 'network']];
  // v4.44.0 手機瘦身（張良「精簡瘦身」）：手機=今日+視角+積分一排橫滑不換行（原 wrap 疊 3~4 行太高）；排序鈕手機不適用時直接不渲染（橫滑排無零位移需求）
  const mb9 = tnMob(), sortOn9 = (v === 'board' || v === 'list' || v === 'owner');
  h += '<div style="display:flex;align-items:center;gap:' + (mb9 ? 8 : 10) + 'px;' + (mb9 ? 'flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin-bottom:10px' : 'flex-wrap:wrap;margin-bottom:16px') + '">'
    + '<button onclick="tnSetView(\'today\')" style="flex-shrink:0;display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid ' + (v === 'today' ? tnC.accent : tnC.line) + ';background:' + (v === 'today' ? tnC.accent : tnWHT) + ';color:' + (v === 'today' ? '#fff' : tnC.sub) + ';font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">' + tnI('home', 14) + '今日</button>'
    + '<div style="display:inline-flex;flex-shrink:0;background:' + tnC.soft + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:2px;gap:2px;flex-wrap:' + (mb9 ? 'nowrap' : 'wrap') + '">'
    + TABS.map(tb => '<button onclick="tnSetView(\'' + tb[0] + '\')" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1px solid ' + (v === tb[0] ? tnC.line : 'transparent') + ';background:' + (v === tb[0] ? tnWHT : 'transparent') + ';color:' + (v === tb[0] ? tnC.text : tnC.sub) + ';font-size:13px;font-weight:' + (v === tb[0] ? 600 : 400) + ';cursor:pointer;white-space:nowrap">' + tnI(tb[2], 14) + tb[1] + '</button>').join('')
    + '</div><div style="flex:1"></div>'
    + (mb9 && !sortOn9 ? '' : '<div style="display:inline-flex;flex-shrink:0;align-items:center;background:' + tnC.soft + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:2px;gap:2px;visibility:' + (sortOn9 ? 'visible' : 'hidden') + '">'
    + '<span style="color:' + tnC.faint + ';margin:0 2px 0 7px">' + tnI('sort', 12) + '</span>'
    + [['manual', '手動'], ['due', '日期'], ['prio', '重要度']].map(m => '<button onclick="tnS.sortMode=\'' + m[0] + '\';tnRender()" style="padding:5px 10px;border-radius:6px;border:1px solid ' + (tnS.sortMode === m[0] ? tnC.line : 'transparent') + ';background:' + (tnS.sortMode === m[0] ? tnWHT : 'transparent') + ';color:' + (tnS.sortMode === m[0] ? tnC.text : tnC.sub) + ';font-size:12px;font-weight:' + (tnS.sortMode === m[0] ? 600 : 400) + ';cursor:pointer;white-space:nowrap">' + m[1] + '</button>').join('')
    + '</div>')
    + '</div>'; // v1.6 第二行「積分級距」鈕退役＝級距編輯入口搬進「積分說明」彈窗（approver 才看得到）
  // 快速隨手記
  h += '<div style="display:flex;gap:8px;margin-bottom:' + (mb9 ? 10 : 16) + 'px">'
    + '<input id="tnQuick" value="' + tnEsc(tnS.quick) + '" oninput="tnS.quick=this.value" onkeydown="if(event.key===\'Enter\'&&!event.isComposing&&event.keyCode!==229)tnAddQuick()" placeholder="隨手丟一句任務…（先進收件匣，之後再拖到大項整理）按 Enter 新增" style="' + tnInp + ';flex:1;font-size:13.5px;padding:10px 12px">'
    + '<button onclick="tnAddQuick()" style="display:inline-flex;align-items:center;gap:6px;background:' + tnC.accent + ';color:#fff;border:none;border-radius:8px;padding:0 16px;font-size:13.5px;font-weight:600;cursor:pointer">' + tnI('plus', 15, '#fff') + '新增</button>'
    + '</div>';
  if (v === 'today') h += tnVToday();
  else if (v === 'group') h += tnVGroup();
  else if (v === 'board') h += tnVBoard();
  else if (v === 'owner') h += tnVOwner();
  else if (v === 'list') h += tnVList();
  else if (v === 'timeline') h += tnVTimeline();
  else if (v === 'gantt') h += tnVGantt();
  else if (v === 'mind') h += tnVMind();
  h += '</div>';
  if (tnS.sel) h += tnModal();
  if (tnS.assignAsk) h += tnAssignMenu(); // 指派完浮出的通知三選一（蓋在詳情彈窗之上）
  return h;
}
function tnSetView(v) { tnS.view = v; tnRender(); }
let tnQTimer = null;
function tnQIn(v) { tnS.q = v; clearTimeout(tnQTimer); tnQTimer = setTimeout(tnRender, 250); } // 搜尋邊打邊濾（防抖＋焦點保留）

/* ── 任務小卡 ── */
function tnCard(t, o) {
  o = o || {};
  const done = t.status === 'done';
  const spot = !!o.spot; // v1.6 已完成顯示模式（展開已完成那刻）：完成卡亮綠描邊發光、未完成卡整張變暗＝一眼掃到做完哪些
  // v1.7 需求①：原本「截止=今天」整圈紅框＋紅色外光（hot 樣式）退役＝逾期/今日靠紅色日期字＋紅太陽鈕就夠醒目，
  // 不再跟積分特效搶風頭；特效樣式（含 box-shadow）整包由 tnPtsCardCss 給，這裡不再事後蓋 box-shadow
  const dndCard = o.dropBefore ? ' ondragover="tnDOvCard(event)" ondrop="tnDropCard(event,\'' + t.id + '\')"' : '';
  let h = '<div draggable="true" data-tid="' + t.id + '" ondragstart="tnDS(event,\'' + t.id + '\')" ondragend="tnDE()"' + dndCard
    + ' onclick="tnOpen(\'' + t.id + '\')" onmouseenter="tnS.hover=\'' + t.id + '\'" onmouseleave="if(tnS.hover===\'' + t.id + '\')tnS.hover=null"'
    + ' style="' + (done
      ? (spot
        ? 'background:#16281C;border:1.5px solid ' + tnC.green + ';border-radius:8px;padding:5px 8px;margin-bottom:5px;cursor:grab;box-shadow:0 0 0 1px rgba(61,190,108,.35),0 0 12px rgba(61,190,108,.45);'
        : 'background:transparent;border:1px dashed ' + tnC.line + ';border-radius:8px;padding:5px 8px;margin-bottom:5px;cursor:grab;opacity:.6')
      : ((function(){ const fx = tnPtsCardCss(t); return (fx ? fx.st : 'background:' + (tnTcol(t.color) || tnWHT) + ';border:1.5px solid ' + tnCBR + ';box-shadow:0 1px 3px rgba(0,0,0,.30);') + 'border-radius:8px;padding:5px 8px;margin-bottom:5px;cursor:grab;' })() + (spot ? 'opacity:.45;' : ''))) + '"' + (function(){ const fx = tnPtsCardCss(t); return fx && fx.cls ? ' class="' + fx.cls + '"' : ''; })() + '>';
  h += '<div style="display:flex;align-items:flex-start;gap:8px">';
  // 完成勾
  h += '<button onclick="event.stopPropagation();tnToggleDone(\'' + t.id + '\')" title="切換完成" style="flex-shrink:0;width:16px;height:16px;margin-top:2px;border-radius:4px;border:1px solid ' + (done ? tnC.green : tnCBR) + ';background:' + (done ? tnC.green : tnWHT) + ';display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">' + (done ? tnI('check', 11, '#fff') : '') + '</button>';
  h += '<div style="flex:1;min-width:0">';
  // v1.9 等級徽章位置可設（張良「徽章的位子也要讓我可以編輯」）：iconcol=右側圖示欄上方(預設)、titleTop=標題上方整條、titleR=標題同行右、titleL=標題同行左
  const tnBdgC = tnPtsBadge(t);
  const bPos = (tnS.ptsBadge && tnS.ptsBadge.pos) || 'iconcol';
  if (tnBdgC && bPos === 'titleTop') h += '<div style="margin:0 0 4px">' + tnBdgC + '</div>';
  // 標題（舊小 ★N 退役）；titleL/titleR＝徽章跟標題同一行
  h += '<div style="display:flex;align-items:center;gap:5px;font-size:12.5px;color:' + (done ? tnC.faint : tnC.text) + ';text-decoration:' + (done ? 'line-through' : 'none') + ';line-height:1.35;word-break:break-word">'
    + (tnBdgC && bPos === 'titleL' ? tnBdgC : '')
    + (t.priority === 'urgent' ? tnI('flame', 12, tnC.red) : '') + '<span style="min-width:0;word-break:break-word">' + tnEsc(t.title) + '</span>'
    + (tnBdgC && bPos === 'titleR' ? '<span style="margin-left:auto;flex-shrink:0">' + tnBdgC + '</span>' : '') + '</div>';
  // 徽章列（v1.1 卡片減脂：大項名/狀態字/標籤 chips 不上卡＝彈窗裡才看；張良「整排小字佔版面」）
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:2px">';
  if (t.due) h += '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-variant-numeric:tabular-nums;color:' + ((!done && t.due <= tnToday()) ? tnC.red : tnC.sub) + '">' + tnI('cal', 11) + t.due + tnWd(t.due) + '</span>'; // v1.7 紅框退役後改 <=：今天到期的日期字也標紅（原本只有逾期<今天才紅）
  if ((t.files || []).length > 0) h += '<span title="' + t.files.length + ' 個附件" style="display:inline-flex;align-items:center;gap:2px;font-size:11px;color:' + tnC.sub + '">' + tnI('clip', 11) + t.files.length + '</span>';
  // v1.5 步驟進度徽章（有清單才顯示；全勾＝綠；單色 SVG 不用彩 emoji）
  const tnTds = t.todos || [];
  if (tnTds.length > 0) {
    const tnTdn = tnTds.filter(x => x && x.d).length, tnTall = tnTdn === tnTds.length;
    h += '<span title="步驟 ' + tnTdn + '/' + tnTds.length + '" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-variant-numeric:tabular-nums;font-weight:' + (tnTall ? 700 : 400) + ';color:' + (tnTall ? tnC.green : tnC.sub) + '">' + tnI('checksq', 11, tnTall ? tnC.green : 'currentColor') + tnTdn + '/' + tnTds.length + '</span>';
  }
  if (tnIsWaiting(t) && !done) h += tnPill(tnC.amber, '等：' + tnEsc(t.waitingFor));
  if (tnIsBlocked(t, tnS.tasks) && !done) h += tnPill(tnC.red, '被前置卡住');
  // /prep 特色：發現者/我來解決＋計時（日時分）/審核/發布
  if (t.by) h += '<span title="發現/回報者" style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:' + tnC.faint + ';white-space:nowrap">' + tnI('eye', 11) + tnEsc(t.by) + '</span>';
  if (t.claimBy && !done) h += '<span title="處理中" style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:' + tnC.accent + ';font-weight:700;white-space:nowrap">' + tnI('wrench', 11) + tnEsc(t.claimBy) + (t.claimAt ? ('・' + tnFmtDur((Date.now() - t.claimAt) / 60000)) : '') + '</span>';
  if (t.prepPending === 1 && !done) h += tnPill(tnC.amber, '待審核');
  if (t.prepPub === 'pending') h += tnPill(tnC.amber, '等發布');
  // v1.2 已確認收到徽章（建立者跟其他人都看得到；單色＝既有 tnPill 樣式）
  if (t.ack && t.ack.by) h += '<span title="負責人已確認收到這張任務">' + tnPill(tnC.green, '已收到・' + tnEsc(t.ack.by)) + '</span>';
  // 完成鈕＋建立者審核流（三分支見 tnFinish 上方註解）
  const rvBy = (!done && t.review && t.review.by) ? t.review.by : '';
  if (rvBy) {
    h += '<span title="回報完成，等建立者過目" style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:' + tnC.amber + ';background:#2A2012;border:1px solid #5A4A2A;border-radius:999px;padding:0 8px;white-space:nowrap">' + tnI('hourglass', 10, tnC.amber) + '待審核・' + tnEsc(rvBy) + '</span>';
    if (tnS.me && t.createdBy === tnS.me) { // 我建立的＋有人回報完成 → 通過/退回
      h += '<button onclick="event.stopPropagation();tnApprove(\'' + t.id + '\')" style="display:inline-flex;align-items:center;gap:3px;border:1px solid ' + tnC.green + ';background:#16281C;color:' + tnC.green + ';border-radius:999px;padding:0 8px;font-size:10.5px;font-weight:700;cursor:pointer">' + tnI('check', 10, tnC.green) + '通過</button>';
      h += '<button onclick="event.stopPropagation();tnReject(\'' + t.id + '\')" style="display:inline-flex;align-items:center;gap:3px;border:1px solid ' + tnC.red + ';background:#2A181A;color:' + tnC.red + ';border-radius:999px;padding:0 8px;font-size:10.5px;font-weight:700;cursor:pointer">' + tnI('x', 10, tnC.red) + '退回</button>';
    }
  }
  // v1.8 卡片上綠色「完成」鈕移除（張良「左上勾選＝完成，綠色完成不要出現」）＝改用左上勾選框；詳情彈窗右下完成鈕保留
  // v1.2 確認收到鈕（張良「對方看到→按下去即時私訊任務建立者」）：我是負責人＋別人建的＋沒確認過＋未完成
  if (!done && !t.ack && tnS.me && t.owner === tnS.me && t.createdBy !== tnS.me) {
    h += '<button onclick="event.stopPropagation();tnAck(\'' + t.id + '\')" title="告訴建立者你看到這張任務了" style="display:inline-flex;align-items:center;gap:3px;border:1px solid ' + tnC.accent + ';background:' + tnC.accentSoft + ';color:' + tnC.accent + ';border-radius:999px;padding:0 8px;font-size:10.5px;font-weight:700;cursor:pointer">' + tnI('check', 10, tnC.accent) + '確認收到</button>';
  }
  if (!done && !t.claimBy && tnS.me) h += '<button onclick="event.stopPropagation();tnClaim(\'' + t.id + '\')" style="border:1px solid ' + tnC.accent + ';background:' + tnC.accentSoft + ';color:' + tnC.accent + ';border-radius:999px;padding:0 8px;font-size:10.5px;font-weight:700;cursor:pointer">我來解決</button>';
  if (!done && t.claimBy && t.claimBy === tnS.me) h += '<button onclick="event.stopPropagation();tnUnclaim(\'' + t.id + '\')" style="border:1px solid ' + tnC.line + ';background:' + tnWHT + ';color:' + tnFNT + ';border-radius:999px;padding:0 8px;font-size:10.5px;cursor:pointer">放棄</button>';
  h += '</div>';
  // 卡上照片：第一張封面、其餘小縮圖（已完成不佔版面）
  const imgs = (t.files || []).filter(f => f.isImage);
  if (!done && imgs.length) {
    h += '<div style="margin-top:5px"><img src="' + tnEsc(imgs[0].url) + '" alt="" loading="lazy" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid ' + tnC.line + ';display:block">';
    if (imgs.length > 1) {
      h += '<div style="display:flex;gap:4px;margin-top:4px;align-items:center">'
        + imgs.slice(1, 4).map(f => '<img src="' + tnEsc(f.url) + '" alt="" loading="lazy" style="width:34px;height:34px;object-fit:cover;border-radius:5px;border:1px solid ' + tnC.line + '">').join('')
        + (imgs.length > 4 ? '<span style="font-size:10.5px;color:' + tnC.faint + '">+' + (imgs.length - 4) + '</span>' : '') + '</div>';
    }
    h += '</div>';
  }
  h += '</div>'; // flex:1 結束
  // v1.8 右側＝直立欄（張良「三個圖示變直立式靠右邊」＋「等級徽章出現在卡片這位子，等級越高越大」）：
  //   上＝等級徽章（越高越大）、下＝✕/釘選/☀ 圖示直立堆疊＋負責人圈
  h += '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">';
  if (tnBdgC && bPos === 'iconcol') h += tnBdgC; // 預設：徽章在圖示欄上方
  h += '<div style="display:flex;flex-direction:column;align-items:center;gap:3px">';
  h += '<button onclick="event.stopPropagation();tnDel(\'' + t.id + '\')" title="刪除" style="background:none;border:none;color:' + tnC.faint + ';cursor:pointer;line-height:1;padding:2px">' + tnI('x', 14) + '</button>';
  h += '<button onclick="event.stopPropagation();tnPinToggle(\'' + t.id + '\')" title="' + (t.pinned ? '取消釘選' : '釘選到最上面') + '" style="background:none;border:none;cursor:pointer;line-height:1;padding:2px;color:' + (t.pinned ? tnC.accent : tnCBR) + '">' + tnI('pin', 13, 'currentColor', t.pinned ? tnC.accent : 'none') + '</button>';
  if (!done) {
    const isToday = t.due === tnToday();
    h += '<button onclick="event.stopPropagation();tnSunToggle(\'' + t.id + '\')" title="' + (isToday ? '退出今天必處理' : '設為今天必處理') + '" style="background:none;border:none;cursor:pointer;line-height:1;padding:2px;color:' + (isToday ? tnC.red : tnCBR) + '">' + tnI('sun', 13, isToday ? tnC.red : 'currentColor') + '</button>';
  }
  if (t.owner) h += '<span title="負責人：' + tnEsc(t.owner) + '" style="width:20px;height:20px;border-radius:50%;background:' + tnC.accentSoft + ';color:' + tnC.accent + ';font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden">' + tnEsc(t.owner.slice(0, 2)) + '</span>';
  h += '</div></div>';
  h += '</div></div>';
  return h;
}

/* ── Today / Home 落地頁 ── */
function tnVToday() {
  const t0 = tnToday();
  const tasks = tnS.tasks;
  const openT = tasks.filter(t => t.status !== 'done').filter(tnMatchQ);
  const used = new Set();
  const take = (arr) => { const out = arr.filter(t => !used.has(t.id)); out.forEach(t => used.add(t.id)); return out; };
  const byUrgency = tnCmpDue;
  const pinFirst = (arr) => tnOrderTasks(arr, 'manual');
  const dueNow = pinFirst(take(openT.filter(t => t.due && t.due <= t0)).sort(byUrgency));
  const doing = pinFirst(take(openT.filter(t => t.status === 'doing')).sort(byUrgency));
  const blockedArr = pinFirst(take(openT.filter(t => tnIsBlocked(t, tasks))).sort(byUrgency));
  const waitingArr = pinFirst(take(openT.filter(t => tnIsWaiting(t))).sort(byUrgency));
  const quick = pinFirst(take(openT.filter(t => tnIsQuickWin(t))).sort(byUrgency));
  const upcoming = pinFirst(take(openT.filter(t => t.due && t.due > t0 && (new Date(t.due) - new Date(t0)) / 86400000 <= 7)).sort(byUrgency));
  const d = new Date();
  const dateStr = (d.getMonth() + 1) + '/' + d.getDate() + '（週' + tnWDZH[d.getDay()] + '）';
  const depNames = (t) => (t.dependsOn || []).map(id => { const x = tasks.find(y => y.id === id); return x && x.status !== 'done' ? x.title : null; }).filter(Boolean);
  const Section = (icon, color, label, hint, inner) =>
    '<div style="background:' + tnC.card + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:14px;min-width:0">'
    + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px"><span style="color:' + color + '">' + tnI(icon, 14, color) + '</span>'
    + '<span style="font-size:13px;font-weight:600;color:' + tnC.text + '">' + label + '</span>'
    + (hint ? '<span style="font-size:11px;color:' + tnC.faint + '">' + hint + '</span>' : '') + '</div>' + inner + '</div>';
  const Grid = (arr) => '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">' + arr.map(t => tnCard(t, {})).join('') + '</div>';
  let h = '<div style="display:grid;gap:12px;grid-template-columns:minmax(0,1fr)">'; // v4.44.0 軌道鎖 minmax(0,1fr)：任何卡內容再寬也壓在版心內,不再把手機整頁撐出橫向捲動
  h += '<div style="font-size:15px;font-weight:700;color:' + tnC.text + ';padding:2px 2px 0">今天 ' + dateStr + '</div>';
  // 大數字摘要卡
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">'
    + [[dueNow.length, '今天必處理', tnC.red], [quick.length, 'Quick Wins ≤' + tnQW_MAX + '分', tnC.green], [waitingArr.length, '在等別人', tnC.amber], [blockedArr.length, '被前置卡住', tnC.faint]].map(x =>
      '<div style="background:' + tnC.card + ';border:1.5px solid ' + tnCBR + ';border-radius:8px;padding:10px 12px">'
      + '<div style="font-family:' + tnMONO + ';font-size:24px;font-weight:700;color:' + (x[0] > 0 ? tnC.text : tnC.faint) + ';line-height:1.1">' + x[0] + '</div>'
      + '<div style="font-size:11px;color:' + tnC.sub + ';margin-top:3px;display:flex;align-items:center;gap:5px"><span style="width:6px;height:6px;border-radius:50%;background:' + x[2] + ';flex-shrink:0"></span>' + x[1] + '</div></div>').join('')
    + '</div>';
  h += Section('alert', tnC.red, '今天必處理', '逾期與今天到期・卡片按太陽可直接排進來', dueNow.length ? Grid(dueNow) : '<div style="font-size:12.5px;color:' + tnC.faint + ';padding:6px 2px">目前沒有——任何卡片按太陽就會排到今天。</div>');
  if (doing.length) h += Section('play', tnC.accent, '進行中', '手上正在做的', Grid(doing));
  if (quick.length) {
    const b5 = quick.filter(t => t.estimatedMinutes <= 5), b10 = quick.filter(t => t.estimatedMinutes > 5 && t.estimatedMinutes <= 10), b15 = quick.filter(t => t.estimatedMinutes > 10);
    const inner = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">'
      + [['≤ 5 min', b5], ['6–10 min', b10], ['11–15 min', b15]].filter(x => x[1].length > 0).map(x =>
        '<div><div style="font-family:' + tnMONO + ';font-size:11px;color:' + tnC.faint + ';font-weight:600;letter-spacing:.5px;margin-bottom:6px">' + x[0] + '</div>' + x[1].map(t => tnCard(t, {})).join('') + '</div>').join('')
      + '</div>';
    h += Section('zap', tnC.green, 'Quick Wins', '≤ ' + tnQW_MAX + ' 分鐘可完成，有空檔就清掉', inner);
  }
  if (waitingArr.length) h += Section('clock', tnC.amber, '在等別人', '該催的去催一下', Grid(waitingArr));
  if (blockedArr.length) {
    const inner = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">'
      + blockedArr.map(t => '<div>' + tnCard(t, {}) + '<div style="font-size:11px;color:' + tnC.faint + ';margin:-4px 2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">等：' + tnEsc(depNames(t).join('、')) + '</div></div>').join('') + '</div>';
    h += Section('hourglass', tnC.sub, '被前置卡住', '前置任務完成後才能動工', inner);
  }
  if (upcoming.length) h += Section('caldays', tnC.sub, '接下來 7 天', '先心裡有數', Grid(upcoming));
  // 各大項一眼：完成度＋今天＋卡住
  const rows = (tnS.cats || []).filter(c => !c.nonProject).map(c => {
    const ts = tasks.filter(t => (t.catId || tnINBOX) === c.id);
    if (!ts.length) return null;
    const done = ts.filter(t => t.status === 'done').length;
    const tdN = ts.filter(t => t.status !== 'done' && t.due && t.due <= t0).length;
    const blkN = ts.filter(t => t.status !== 'done' && tnIsBlocked(t, tasks)).length;
    return { c: c, total: ts.length, done: done, tdN: tdN, blkN: blkN, pct: Math.round(done / ts.length * 100) };
  }).filter(Boolean);
  if (rows.length) {
    // v4.44.0 手機橫向溢出治本（張良「左右卷軸移動很奇怪」）：固定欄寬加總 86+44+40+52+52+gap50=324＋卡padding28=352>344 把整頁撐寬 10px——手機縮欄+縮gap（70+36+34+46+46+gap30=262）
    const m9 = tnMob();
    const inner = '<div style="display:grid;gap:9px">' + rows.map(r =>
      '<div style="display:flex;align-items:center;gap:' + (m9 ? 6 : 10) + 'px">'
      + '<span style="width:' + (m9 ? 70 : 130) + 'px;flex-shrink:0;font-size:12.5px;font-weight:600;color:' + tnC.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tnEsc(r.c.name) + '</span>'
      + '<div style="flex:1;min-width:24px;height:8px;background:' + tnC.soft + ';border-radius:6px;overflow:hidden"><div style="width:' + r.pct + '%;height:100%;background:' + (r.pct === 100 ? tnC.green : '#3a6ea5') + ';border-radius:6px"></div></div>'
      + '<span style="font-family:' + tnMONO + ';font-size:12px;font-weight:700;color:' + tnC.text + ';width:' + (m9 ? 36 : 44) + 'px;text-align:right;flex-shrink:0">' + r.pct + '%</span>'
      + '<span style="font-family:' + tnMONO + ';font-size:11px;color:' + tnC.faint + ';width:' + (m9 ? 34 : 40) + 'px;text-align:right;flex-shrink:0">' + r.done + '/' + r.total + '</span>'
      + '<span style="font-size:11px;color:' + (r.tdN > 0 ? tnC.red : tnC.faint) + ';font-weight:' + (r.tdN > 0 ? 700 : 400) + ';width:' + (m9 ? 46 : 52) + 'px;text-align:right;flex-shrink:0">今天 ' + r.tdN + '</span>'
      + '<span style="font-size:11px;color:' + (r.blkN > 0 ? tnC.sub : tnC.faint) + ';font-weight:' + (r.blkN > 0 ? 700 : 400) + ';width:' + (m9 ? 46 : 52) + 'px;text-align:right;flex-shrink:0">卡住 ' + r.blkN + '</span>'
      + '</div>').join('') + '</div>';
    h += Section('grid', tnC.sub, '各大項一眼', '任務完成度・今天・卡住', inner);
  }
  h += '</div>';
  return h;
}

/* ── 依大項分組（Keep 式瀑布流＋tcol 欄記憶＋大項拖曳/改名/調色） ── */
function tnVGroup() {
  const groups = tnGroups();
  // v1.6 展開已完成＝每個大項裡完成卡排最上面（穩定排序：done 先、其餘原順序）；收起＝照舊只看未完成
  const vis = (items) => tnS.showDone
    ? [...items].sort((a, b) => (b.status === 'done' ? 1 : 0) - (a.status === 'done' ? 1 : 0))
    : items.filter(t => t.status !== 'done');
  const withItems = groups.map(g => ({ g: g, items: tnOrderTasks(tnTasksOf(g.id).filter(tnMatchQ), 'manual') }));
  const doneTotal = withItems.reduce((s, x) => s + x.items.filter(t => t.status === 'done').length, 0);
  const inboxX = withItems.find(x => x.g.id === tnINBOX);
  const filled = withItems.filter(x => x.g.id !== tnINBOX && vis(x.items).length > 0);
  const empties = withItems.filter(x => x.g.id !== tnINBOX && vis(x.items).length === 0);
  const gInput = (gid, slim) => '<input id="tnG-' + gid + '" value="' + tnEsc(tnS.gnew[gid] || '') + '" oninput="tnS.gnew[\'' + gid + '\']=this.value"'
    + ' onkeydown="if(event.key===\'Enter\'&&!event.isComposing&&event.keyCode!==229)tnAddToGroup(\'' + gid + '\')"'
    + ' placeholder="' + (slim ? '＋ 新增或拖到這裡…' : '＋ 直接在此大項新增…') + '"'
    + ' style="' + (slim ? 'flex:1;' : 'width:100%;margin-top:4px;') + 'min-width:0;box-sizing:border-box;border:1px dashed ' + tnC.line + ';border-radius:8px;padding:' + (slim ? '4px 9px' : '6px 10px') + ';font-size:' + (slim ? 12 : 12.5) + 'px;background:transparent;color:' + tnC.text + ';outline:none">';
  const gName = (g, slim) => {
    if (tnS.editCat && tnS.editCat.id === g.id) {
      return '<input id="tnCatEdit" autofocus value="' + tnEsc(tnS.editCat.name) + '" oninput="tnS.editCat.name=this.value" onkeydown="tnCatEditKey(event)" onblur="tnCatRenameCommit()"'
        + ' style="font-size:' + (slim ? 12.5 : 13) + 'px;font-weight:600;color:' + tnC.text + ';border:1px solid ' + tnC.line + ';border-radius:6px;padding:1px 6px;background:' + tnWHT + ';outline:none;min-width:0;width:130px">';
    }
    const editable = g.id !== tnINBOX;
    return '<div ' + (editable ? 'title="點我改大項名稱" onclick="event.stopPropagation();tnCatEditStart(\'' + g.id + '\',\'' + encodeURIComponent(g.name) + '\')"' : '')
      + ' style="font-size:' + (slim ? 12.5 : 13) + 'px;font-weight:600;color:' + (g.id === tnINBOX ? tnC.accent : (slim ? tnC.sub : tnC.text)) + ';white-space:nowrap;cursor:' + (editable ? 'text' : 'default') + '">' + tnEsc(g.name) + '</div>';
  };
  // v1.6 類別顏色恢復（張良）：小色點鈕緊貼在大項「名稱右邊」（原本 margin-left:auto 推到列尾）；點開＝7 格色盤（含清除）寫 cat.color
  const catColorBtn = (g) => g.id === tnINBOX ? '' :
    '<button onclick="event.stopPropagation();tnColorCatToggle(\'' + g.id + '\')" title="大項顏色" style="flex-shrink:0;width:15px;height:15px;border-radius:50%;background:' + (tnTcol(g.color) || tnWHT) + ';border:1.5px solid ' + (g.color ? tnC.sub : tnC.line) + ';cursor:pointer;padding:0"></button>';
  const catPalette = (g) => tnS.colorCat !== g.id ? '' :
    '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:2px 2px 8px">'
    + tnPALETTE.map(p => '<button title="' + p[1] + '" onclick="event.stopPropagation();tnSetCatColor(\'' + g.id + '\',\'' + p[0] + '\')" style="width:21px;height:21px;border-radius:50%;background:' + (tnTcol(p[0]) || tnWHT) + ';cursor:pointer;padding:0;border:' + ((g.color || '') === p[0] ? '2.5px solid ' + tnC.red : '1.5px solid ' + tnC.line) + '"></button>').join('') + '</div>';
  const canDragCat = (g) => g.id !== tnINBOX;
  const catWrapOpen = (g) => '<div ondragover="tnCatOver(event,\'' + g.id + '\')" ondragleave="tnCatLeave(event)" ondrop="tnCatDrop(event,\'' + g.id + '\')" style="border-radius:8px;opacity:' + (tnS.dragCat === g.id ? 0.4 : 1) + '">';
  const catHead = (g, items) => '<div ' + (canDragCat(g) ? 'draggable="true" ondragstart="tnCDS(event,\'' + g.id + '\')" ondragend="tnDE()" title="拖我＝搬整個大項排序"' : '')
    + ' style="display:flex;align-items:center;gap:5px;margin-bottom:7px;padding:0 2px;cursor:' + (canDragCat(g) ? 'grab' : 'default') + '">'
    + (g.id === tnINBOX ? '<span style="color:' + tnC.accent + '">' + tnI('inbox', 13, tnC.accent) + '</span>' : '<span style="color:' + tnC.faint + '">' + tnI('grip', 12) + '</span>')
    + gName(g, false)
    + catColorBtn(g)
    + '<span style="font-size:11.5px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums">' + items.length + '</span>'
    + '</div>';
  const groupCard = (x) => catWrapOpen(x.g)
    + '<div ondragover="tnZOver(event)" ondragleave="tnZLeave(event)" ondrop="tnZDrop(event,\'cat\',\'' + x.g.id + '\')" style="background:' + (tnTcol(x.g.color) || tnC.card) + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:8px">'
    + catHead(x.g, vis(x.items)) + catPalette(x.g)
    + vis(x.items).map(t => tnCard(t, { dropBefore: true, spot: tnS.showDone })).join('')
    + gInput(x.g.id, false)
    + '</div></div>';
  // 欄數＝實際容器寬 ÷ 每欄最少 250
  const host = (typeof app !== 'undefined' && app) ? app : null;
  const gwEff = (host && host.clientWidth ? host.clientWidth - 36 : (typeof window !== 'undefined' ? window.innerWidth : 1280) - 100);
  const NCOL = tnMob() ? 1 : Math.max(1, Math.min(8, Math.floor((gwEff + 10) / 260)));
  const cols = Array.from({ length: NCOL }, () => ({ w: 0, nodes: [] }));
  // 沒有任務的大項＋新增大項
  let emptiesBlock = '<div style="border:1px dashed ' + tnC.line + ';border-radius:8px;padding:8px">'
    + '<div style="font-size:10.5px;letter-spacing:.5px;font-weight:500;color:' + tnC.faint + ';margin-bottom:6px;padding:0 2px">沒有任務的大項（拖任務進來就會長出去）</div>'
    + '<div style="display:flex;flex-direction:column;gap:6px">'
    + empties.map(x => catWrapOpen(x.g)
      + '<div ondragover="tnZOver(event)" ondragleave="tnZLeave(event)" ondrop="tnZDrop(event,\'cat\',\'' + x.g.id + '\')" style="background:' + (tnTcol(x.g.color) || tnC.card) + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:6px 8px">'
      + '<div draggable="true" ondragstart="tnCDS(event,\'' + x.g.id + '\')" ondragend="tnDE()" style="display:flex;align-items:center;gap:6px;cursor:grab">'
      + '<span style="color:' + tnC.faint + '">' + tnI('grip', 12) + '</span>'
      + gName(x.g, true)
      + catColorBtn(x.g)
      + (!tnS.showDone && x.items.length > 0 ? '<span title="這個大項的任務全完成了" style="font-size:10.5px;color:' + tnC.green + ';flex-shrink:0;display:inline-flex;align-items:center;gap:2px">' + tnI('check', 10, tnC.green) + x.items.length + '</span>' : '')
      + gInput(x.g.id, true)
      + '</div>' + catPalette(x.g) + '</div></div>').join('')
    + '<div style="border:1px dashed ' + tnC.line + ';border-radius:8px;padding:6px 8px;display:flex;align-items:center;gap:6px">'
    + '<span style="color:' + tnC.faint + '">' + tnI('folderplus', 13) + '</span>'
    + '<input id="tnNewCat" value="' + tnEsc(tnS.newCatIn) + '" oninput="tnS.newCatIn=this.value" onkeydown="if(event.key===\'Enter\'&&!event.isComposing&&event.keyCode!==229)tnNewCatCommit()" placeholder="＋ 新增大項" style="flex:1;min-width:0;border:none;background:transparent;outline:none;font-size:12px;color:' + tnC.text + '">'
    + '</div></div></div>';
  // 佈局：第 0 欄＝收件匣＋空大項；有 tcol 的釘那欄、其餘補最矮欄
  tnS.colOf = {};
  const orderIdx = {}; groups.forEach((g, i) => { orderIdx[g.id] = i; });
  const wOf = (x) => 2.2 + vis(x.items).length;
  cols[0].nodes.push(groupCard(inboxX));
  cols[0].w += 2.5 + vis(inboxX.items).length;
  cols[0].nodes.push(emptiesBlock);
  cols[0].w += 2 + empties.length * 0.6;
  const colEntries = Array.from({ length: NCOL }, () => []);
  const pinnedX = filled.filter(x => Number.isInteger(x.g.tcol));
  const autosX = filled.filter(x => !Number.isInteger(x.g.tcol));
  for (const x of pinnedX) { const k = Math.min(Math.max(0, x.g.tcol), NCOL - 1); colEntries[k].push(x); cols[k].w += wOf(x); tnS.colOf[x.g.id] = k; }
  for (const x of autosX) { let k = 0; for (let i = 1; i < NCOL; i++) if (cols[i].w < cols[k].w) k = i; colEntries[k].push(x); cols[k].w += wOf(x); tnS.colOf[x.g.id] = k; }
  colEntries.forEach((list, k) => { list.sort((a, b) => orderIdx[a.g.id] - orderIdx[b.g.id]); list.forEach(x => cols[k].nodes.push(groupCard(x))); });
  let h = '';
  if (doneTotal > 0 || tnS.showDone) {
    h += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">'
      + '<button onclick="tnS.showDone=!tnS.showDone;tnRender()" style="display:inline-flex;align-items:center;gap:5px;border:1px solid ' + (tnS.showDone ? tnC.green : tnC.line) + ';background:' + (tnS.showDone ? '#16281C' : tnWHT) + ';color:' + (tnS.showDone ? tnC.green : tnC.sub) + ';border-radius:999px;padding:3px 12px;font-size:12px;font-weight:600;cursor:pointer">' + tnI('check', 12) + '已完成 ' + doneTotal + (tnS.showDone ? '・點我收起' : '・點我顯示') + '</button></div>';
  }
  h += '<div style="display:flex;gap:10px;align-items:flex-start">'
    + cols.map((c, i) => '<div ondragover="tnColOver(event)" ondragleave="tnColLeave(event)" ondrop="tnColDrop(event,' + i + ')" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;border-radius:8px;min-height:120px">' + c.nodes.join('') + '</div>').join('')
    + '</div>';
  return h;
}

/* ── 看板（依狀態三欄；完成欄預設 8 件收起） ── */
function tnVBoard() {
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;align-items:start">'
    + tnSTATUS.map(s => {
      const items = tnOrderTasks((tnS.tasks || []).filter(t => t.status === s[0]).filter(tnMatchQ), tnS.sortMode);
      const shown = (s[0] === 'done' && !tnS.showAllDone) ? items.slice(0, 8) : items;
      const hidden = items.length - shown.length;
      return '<div ondragover="tnZOver(event)" ondragleave="tnZLeave(event)" ondrop="tnZDrop(event,\'status\',\'' + s[0] + '\')" style="background:' + tnC.card + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:12px;min-height:120px">'
        + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px"><span style="width:7px;height:7px;border-radius:50%;background:' + s[2] + '"></span>'
        + '<div style="font-size:13px;font-weight:600;color:' + tnC.text + '">' + s[1] + '</div>'
        + '<span style="font-size:11.5px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums">' + items.length + '</span></div>'
        + shown.map(t => tnCard(t, { dropBefore: true })).join('')
        + (hidden > 0 ? '<button onclick="tnS.showAllDone=true;tnRender()" style="width:100%;background:none;border:1px dashed ' + tnC.line + ';border-radius:8px;padding:6px 0;font-size:12px;color:' + tnC.sub + ';cursor:pointer">顯示全部（還有 ' + hidden + ' 件）</button>' : '')
        + (s[0] === 'done' && tnS.showAllDone && items.length > 8 ? '<button onclick="tnS.showAllDone=false;tnRender()" style="width:100%;background:none;border:none;padding:6px 0;font-size:12px;color:' + tnC.faint + ';cursor:pointer">收起</button>' : '')
        + (items.length === 0 ? tnEmpty('cols', '拖到這欄') : '')
        + '</div>';
    }).join('') + '</div>';
}

/* ── 負責人（v1.1 改分組看板）：GD 每人一組（沒任務也要出現空組）＋「未指派」固定第一組；
      分組依 owner 欄；拖卡進某人組＝指派給他（觸發通知三選一）；
      人員組可拖排序 → 存 sp_team_pm_ownerord 全裝置同步，讀不到就照名單原順序；
      桌機 ≥920px 四欄瀑布並排（比照依大項瀑布流）、手機直向一組一組疊 ── */
function tnOwnerPool() { // 人員名單＝彈窗負責人選單同一個來源：GD 名單＋任務裡出現過的人
  return [...new Set([].concat(tnS.gdNames, (tnS.tasks || []).flatMap(x => [x.owner, x.claimBy]).filter(Boolean)))];
}
function tnOwnerNames() { // 照 sp_team_pm_ownerord 排；沒排過/新面孔照名單原順序接在後面
  const base = tnOwnerPool();
  const ord = (tnS.ownerOrd && Array.isArray(tnS.ownerOrd.order)) ? tnS.ownerOrd.order : [];
  const pos = new Map(ord.map((n, i) => [n, i]));
  return base.map((n, i) => [n, pos.has(n) ? pos.get(n) : 100000 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
function tnOwnerOrdSave(arr) {
  tnS.ownerOrd = { order: arr };
  tnKV({ op: 'set', key: 'sp_team_pm_ownerord', value: JSON.stringify({ order: arr }) }).then(r => { if (!r || !r.ok) tnPermFail(r); });
  tnCacheSave();
  tnRender();
}
// 人員組拖曳排序（上半=排它前面、下半=排它後面；比照大項拖曳做法；參數走 encodeURIComponent 防名字裡有怪字）
function tnODS(e, enc) { e.stopPropagation(); tnS.dragOwn = decodeURIComponent(enc); try { e.dataTransfer.effectAllowed = 'move'; } catch (_) {} }
function tnOwnOver(e, enc) {
  const nm = decodeURIComponent(enc);
  if (!(tnS.dragOwn && tnS.dragOwn !== nm && nm)) return;
  e.preventDefault(); e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  const p = e.clientY < r.top + r.height / 2 ? 'b' : 'a';
  e.currentTarget.dataset.tnpos = p;
  e.currentTarget.style.boxShadow = p === 'b' ? ('0 -4px 0 0 ' + tnC.accent) : ('0 4px 0 0 ' + tnC.accent);
}
function tnOwnDrop(e, enc) {
  const nm = decodeURIComponent(enc);
  if (!(tnS.dragOwn && tnS.dragOwn !== nm && nm)) return;
  e.preventDefault(); e.stopPropagation(); e.currentTarget.style.boxShadow = 'none';
  const p = e.currentTarget.dataset.tnpos || 'b';
  const from = tnS.dragOwn; tnS.dragOwn = null;
  const arr = tnOwnerNames().filter(n => n !== from);
  const ti = arr.indexOf(nm);
  arr.splice(ti < 0 ? arr.length : (p === 'b' ? ti : ti + 1), 0, from);
  tnOwnerOrdSave(arr);
}
function tnVOwner() {
  const openO = (tnS.tasks || []).filter(t => t.status !== 'done').filter(tnMatchQ);
  const groups = [{ nm: '', label: '未指派' }].concat(tnOwnerNames().map(n => ({ nm: n, label: n })));
  const withItems = groups.map(g => ({ g: g, items: tnOrderTasks(openO.filter(t => (t.owner || '') === g.nm), tnS.sortMode) }));
  const gCard = (x) => {
    const g = x.g, items = x.items, enc = encodeURIComponent(g.nm);
    return '<div' + (g.nm ? ' ondragover="tnOwnOver(event,\'' + enc + '\')" ondragleave="tnCatLeave(event)" ondrop="tnOwnDrop(event,\'' + enc + '\')"' : '') + ' style="border-radius:8px;opacity:' + (tnS.dragOwn === g.nm ? 0.4 : 1) + '">'
      + '<div ondragover="tnZOver(event)" ondragleave="tnZLeave(event)" ondrop="tnZDrop(event,\'owner\',\'' + enc + '\')" style="background:' + tnC.card + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:10px;min-height:72px">'
      + '<div ' + (g.nm ? 'draggable="true" ondragstart="tnODS(event,\'' + enc + '\')" ondragend="tnDE()" title="拖我＝調整人員組順序"' : '') + ' style="display:flex;align-items:center;gap:7px;margin-bottom:8px;cursor:' + (g.nm ? 'grab' : 'default') + '">'
      + (g.nm
        ? '<span style="color:' + tnC.faint + '">' + tnI('grip', 12) + '</span><span style="width:20px;height:20px;border-radius:50%;background:' + tnC.accentSoft + ';color:' + tnC.accent + ';font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + tnEsc(g.nm.slice(0, 2)) + '</span>'
        : '<span style="width:7px;height:7px;border-radius:50%;background:' + tnC.faint + ';flex-shrink:0"></span>')
      + '<div style="font-size:13px;font-weight:600;color:' + tnC.text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tnEsc(g.label) + '</div>'
      + '<span style="font-size:11.5px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums">' + items.length + '</span></div>'
      + items.map(t => tnCard(t, {})).join('')
      + (items.length === 0 ? tnEmpty('users', g.nm ? '拖任務過來＝指派給他' : '沒有未指派的任務') : '')
      + '</div></div>';
  };
  // 桌機四欄瀑布：未指派先進第 0 欄，其餘照排序依最矮欄補位；手機一欄直疊
  const NCOL = ((typeof window !== 'undefined' ? window.innerWidth : 1280) >= 920) ? 4 : 1;
  const cols = Array.from({ length: NCOL }, () => ({ w: 0, nodes: [] }));
  withItems.forEach(x => {
    let k = 0; for (let i = 1; i < NCOL; i++) if (cols[i].w < cols[k].w) k = i;
    cols[k].nodes.push(gCard(x)); cols[k].w += 1.8 + x.items.length;
  });
  return '<div style="display:flex;gap:12px;align-items:flex-start">'
    + cols.map(c => '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px">' + c.nodes.join('') + '</div>').join('')
    + '</div>';
}

/* ── 清單（Linear 式密表；手機四欄、桌機八欄；手動模式可拖曳排序） ── */
function tnVList() {
  let rows = (tnS.tasks || []).filter(tnMatchQ).filter(t => tnS.fStatus === 'all' || (tnS.fStatus === 'open' ? t.status !== 'done' : t.status === tnS.fStatus));
  rows = tnOrderTasks(rows, tnS.sortMode);
  const mob = tnMob();
  const GTC = mob ? '34px minmax(0,1fr) 72px 88px' : '34px minmax(220px,1fr) 72px 96px 130px 52px 130px 88px';
  const hc = 'font-size:10.5px;letter-spacing:.8px;color:' + tnC.faint + ';font-weight:600;padding:7px 8px;white-space:nowrap';
  const manual = tnS.sortMode === 'manual';
  let h = '<div>';
  h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'
    + '<div style="display:inline-flex;background:' + tnC.soft + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:2px;gap:2px">'
    + [['open', '未完成'], ['all', '全部'], ['done', '已完成']].map(f => '<button onclick="tnS.fStatus=\'' + f[0] + '\';tnRender()" style="padding:5px 12px;border-radius:6px;border:1px solid ' + (tnS.fStatus === f[0] ? tnC.line : 'transparent') + ';background:' + (tnS.fStatus === f[0] ? tnWHT : 'transparent') + ';color:' + (tnS.fStatus === f[0] ? tnC.text : tnC.sub) + ';font-size:12.5px;font-weight:' + (tnS.fStatus === f[0] ? 600 : 400) + ';cursor:pointer">' + f[1] + '</button>').join('')
    + '</div></div>';
  h += '<div style="border:1.5px solid ' + tnCBR + ';border-radius:8px;background:' + tnC.card + ';overflow:hidden"><div style="overflow-x:auto"><div style="' + (mob ? '' : 'min-width:880px') + '">';
  h += '<div style="display:grid;grid-template-columns:' + GTC + ';background:' + tnC.soft + ';border-bottom:1.5px solid ' + tnCBR + ';align-items:center"><div></div>'
    + '<div style="' + hc + '">標題</div><div style="' + hc + '">截止</div>'
    + (mob ? '' : '<div style="' + hc + '">負責人</div><div style="' + hc + '">等待中</div><div style="' + hc + '">優先</div><div style="' + hc + '">大項</div>')
    + '<div style="' + hc + '">狀態</div></div>';
  if (!rows.length) h += tnEmpty('list', '沒有任務', 24);
  else rows.forEach((t, i) => {
    const done = t.status === 'done';
    const pm = tnPMeta(t.priority);
    const overdue = !done && t.due && t.due < tnToday();
    h += '<div data-tid="' + t.id + '" onclick="tnOpen(\'' + t.id + '\')"'
      + (manual ? ' draggable="true" ondragstart="tnDS(event,\'' + t.id + '\')" ondragend="tnDE()" ondragover="tnDOvCard(event)" ondrop="event.stopPropagation();tnZDrop(event,\'before\',\'' + t.id + '\')" title="拖我排序（丟到目標列＝排到它上面）"' : '')
      + ' style="display:grid;grid-template-columns:' + GTC + ';align-items:center;height:36px;border-top:' + (i ? '1px solid ' + tnC.line : 'none') + ';cursor:' + (manual ? 'grab' : 'pointer') + ';background:' + (tnTcol(t.color) || tnC.card) + '">'
      + '<div style="display:flex;justify-content:center"><button onclick="event.stopPropagation();tnToggleDone(\'' + t.id + '\')" style="width:15px;height:15px;border-radius:4px;border:1px solid ' + (done ? tnC.green : tnCBR) + ';background:' + (done ? tnC.green : tnWHT) + ';display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">' + (done ? tnI('check', 10, '#fff') : '') + '</button></div>'
      + '<div style="display:flex;align-items:center;gap:5px;padding:0 8px;font-size:13px;color:' + (done ? tnC.faint : tnC.text) + ';text-decoration:' + (done ? 'line-through' : 'none') + ';overflow:hidden;white-space:nowrap">'
      + (t.pinned ? tnI('pin', 11, tnC.accent, tnC.accent) : '') + (t.priority === 'urgent' && !done ? tnI('flame', 11, tnC.red) : '')
      + '<span style="overflow:hidden;text-overflow:ellipsis">' + tnEsc(t.title) + '</span></div>'
      + '<div style="padding:0 8px;font-family:' + tnMONO + ';font-size:11.5px;font-weight:' + (overdue ? 700 : 500) + ';color:' + (overdue ? tnC.red : (t.due ? tnC.sub : tnC.faint)) + ';white-space:nowrap">' + (t.due ? t.due.slice(5) + tnWd(t.due) : '—') + '</div>';
    if (!mob) {
      h += '<div style="padding:0 8px;font-size:12px;color:' + (t.owner ? tnC.text : tnC.faint) + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px">'
        + (t.owner ? '<span style="width:17px;height:17px;border-radius:50%;background:' + tnC.accentSoft + ';color:' + tnC.accent + ';font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + tnEsc(t.owner.slice(0, 2)) + '</span>' : '') + tnEsc(t.owner || '—') + '</div>'
        + '<div style="padding:0 8px;font-size:12px;color:' + (tnIsWaiting(t) ? tnC.amber : tnC.faint) + ';font-weight:' + (tnIsWaiting(t) ? 600 : 400) + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tnEsc(t.waitingFor || '—') + '</div>'
        + '<div style="padding:0 8px;font-size:12px;font-weight:' + (t.priority === 'urgent' ? 700 : 500) + ';color:' + (t.priority === 'urgent' ? tnC.red : t.priority === 'high' ? tnC.amber : t.priority === 'low' ? tnC.faint : tnC.sub) + ';white-space:nowrap">' + pm[1] + '</div>'
        + '<div style="padding:0 8px;font-size:12px;color:' + tnC.sub + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tnEsc(tnCatName(t.catId)) + '</div>';
    }
    h += '<div style="padding:0 6px">' + tnPill(tnSColor(t.status), tnSLabel(t.status)) + '</div></div>';
  });
  h += '</div></div></div>';
  if (rows.length) h += '<div style="font-size:11px;color:' + tnC.faint + ';margin-top:6px;font-family:' + tnMONO + '">' + rows.length + ' 件</div>';
  h += '</div>';
  return h;
}

/* ── 時間軸（依截止日分桶） ── */
function tnVTimeline() {
  const t0 = tnToday();
  const tasks = tnS.tasks || [];
  const within = (dd, n) => { if (!dd) return false; const diff = (new Date(dd) - new Date(t0)) / 86400000; return diff >= 0 && diff <= n; };
  const buckets = [
    ['逾期', 'alert', tnC.red, tasks.filter(t => t.status !== 'done' && t.due && t.due < t0)],
    ['今天', 'cal', tnC.accent, tasks.filter(t => t.status !== 'done' && t.due === t0)],
    ['本週內', 'caldays', tnC.sub, tasks.filter(t => t.status !== 'done' && t.due && t.due > t0 && within(t.due, 7))],
    ['之後', 'clock', tnC.sub, tasks.filter(t => t.status !== 'done' && t.due && t.due > t0 && !within(t.due, 7))],
    ['無日期', 'inbox', tnC.faint, tasks.filter(t => !t.due && t.status !== 'done')],
  ].map(b => [b[0], b[1], b[2], tnOrderTasks(b[3].filter(tnMatchQ).sort((a, b2) => (a.due || '9') < (b2.due || '9') ? -1 : 1), 'manual')]);
  let h = '<div style="display:grid;gap:12px">';
  buckets.forEach(b => {
    if (!b[3].length) return;
    h += '<div style="background:' + tnC.card + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:14px">'
      + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px"><span style="color:' + b[2] + '">' + tnI(b[1], 14, b[2]) + '</span>'
      + '<span style="font-size:13px;font-weight:600;color:' + tnC.text + '">' + b[0] + '</span>'
      + '<span style="color:' + tnC.faint + ';font-size:11.5px;font-variant-numeric:tabular-nums">' + b[3].length + '</span></div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">' + b[3].map(t => tnCard(t, {})).join('') + '</div></div>';
  });
  if (!tasks.length) h += tnEmpty('caldays', '還沒有任務', 24);
  h += '</div>';
  return h;
}

/* ── 甘特圖（開始～截止畫橫條；紅線＝今天） ── */
function tnVGantt() {
  const dayMs = 86400000, dayW = 24;
  const tasks = tnS.tasks || [];
  const sched = tasks.filter(t => t.due || t.start).filter(tnMatchQ);
  const unsched = tasks.filter(t => !t.due && !t.start).filter(tnMatchQ);
  if (!sched.length) return tnEmpty('gantt', '還沒有「有日期」的任務。到任務詳情設好開始/截止日，就會出現在甘特圖。', 24);
  const lo = (t) => new Date(tnDnorm(t.start || t.due));
  const hi = (t) => new Date(tnDnorm(t.due || t.start));
  let minD = new Date(Math.min.apply(null, sched.map(t => +lo(t)).concat([+new Date(tnToday())])));
  let maxD = new Date(Math.max.apply(null, sched.map(t => +hi(t)).concat([+new Date(tnToday())])));
  minD = new Date(+minD - 2 * dayMs); maxD = new Date(+maxD + 2 * dayMs);
  let totalDays = Math.round((maxD - minD) / dayMs) + 1;
  if (totalDays > 140) { maxD = new Date(+minD + 140 * dayMs); totalDays = 141; }
  const offset = (d) => Math.round((new Date(tnDnorm(d)) - minD) / dayMs);
  const ticks = []; for (let i = 0; i < totalDays; i += 7) { const d = new Date(+minD + i * dayMs); ticks.push({ i: i, label: (d.getMonth() + 1) + '/' + d.getDate() }); }
  const todayOff = offset(tnToday());
  const nameW = tnMob() ? 96 : 200;
  let h = '<div><div style="border:1px solid ' + tnC.line + ';border-radius:8px;background:' + tnC.card + ';overflow:auto"><div style="min-width:' + (nameW + totalDays * dayW) + 'px">';
  h += '<div style="display:flex;border-bottom:1px solid ' + tnC.line + ';position:sticky;top:0;background:' + tnC.bg + ';z-index:3">'
    + '<div style="width:' + nameW + 'px;flex-shrink:0;border-right:1px solid ' + tnC.line + ';padding:6px 10px;font-size:11px;letter-spacing:.5px;color:' + tnC.faint + ';font-weight:500;position:sticky;left:0;background:' + tnC.bg + ';z-index:4">任務</div>'
    + '<div style="position:relative;height:26px">'
    + ticks.map(tk => '<div style="position:absolute;left:' + (tk.i * dayW) + 'px;top:0;font-size:10.5px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums;padding:6px 0 0 4px;border-left:1px solid ' + tnC.soft + ';height:26px;box-sizing:border-box">' + tk.label + '</div>').join('')
    + '</div></div>';
  [...sched].sort((a, b) => +lo(a) - +lo(b)).forEach((t, i) => {
    const s = offset(t.start || t.due), e = offset(t.due || t.start);
    const left = Math.min(s, e), width = Math.abs(e - s) + 1;
    h += '<div data-tid="' + t.id + '" onclick="tnOpen(\'' + t.id + '\')" style="display:flex;align-items:center;border-top:' + (i ? '1px solid ' + tnC.soft : 'none') + ';cursor:pointer;background:' + (tnTcol(t.color) || tnWHT) + '">'
      + '<div style="width:' + nameW + 'px;flex-shrink:0;border-right:1px solid ' + tnC.line + ';padding:7px 10px;font-size:' + (tnMob() ? 11 : 12.5) + 'px;color:' + (t.status === 'done' ? tnC.faint : tnC.text) + ';overflow:hidden;white-space:nowrap;display:flex;align-items:center;gap:4px;position:sticky;left:0;background:inherit;z-index:2">'
      + (t.priority === 'urgent' ? tnI('flame', 11, tnC.red) : '')
      + '<span style="overflow:hidden;text-overflow:ellipsis">' + tnEsc(t.title) + '</span>'
      + (tnMob() ? '' : '<span style="font-size:10.5px;color:' + tnC.faint + ';flex-shrink:0">・' + tnEsc(tnCatName(t.catId)) + '</span>') + '</div>'
      + '<div style="position:relative;height:30px;flex:1">'
      + (todayOff >= 0 && todayOff < totalDays ? '<div style="position:absolute;left:' + (todayOff * dayW) + 'px;top:0;bottom:0;width:1px;background:' + tnC.red + ';opacity:.45"></div>' : '')
      + '<div title="' + tnEsc((t.start || t.due) + ' ~ ' + (t.due || t.start)) + '" style="position:absolute;left:' + (left * dayW + 2) + 'px;top:9px;height:12px;width:' + Math.max(width * dayW - 4, 8) + 'px;background:' + (t.status === 'done' ? tnC.green : tnC.accent) + ';border-radius:999px;opacity:' + (t.status === 'done' ? 0.45 : 1) + '"></div>'
      + '</div></div>';
  });
  h += '</div></div><div style="font-size:11.5px;color:' + tnC.faint + ';margin-top:8px">紅線＝今天。點任務列可編輯日期。</div>';
  if (unsched.length) {
    h += '<div style="margin-top:16px"><div style="font-size:11px;letter-spacing:.5px;font-weight:500;color:' + tnC.faint + ';margin-bottom:8px">未排程（沒設日期）' + unsched.length + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">' + unsched.map(t => tnCard(t, {})).join('') + '</div></div>';
  }
  h += '</div>';
  return h;
}

/* ── 心智圖（中心→大項→任務） ── */
function tnVMind() {
  const branches = tnGroups().map(g => ({ g: g, items: tnTasksOf(g.id).filter(tnMatchQ) })).filter(b => b.items.length > 0);
  if (!branches.length) return tnEmpty('network', '還沒有任務', 24);
  let h = '<div style="padding:10px 0"><div style="display:flex;flex-direction:column;align-items:center">'
    + '<div style="background:' + tnC.accent + ';color:#fff;border-radius:999px;padding:7px 18px;font-size:14px;font-weight:600">全部任務</div>'
    + '<div style="width:1px;height:18px;background:' + tnC.line + '"></div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;align-items:start;width:100%">';
  branches.forEach(b => {
    h += '<div style="display:flex;flex-direction:column;align-items:center;min-width:0">'
      + '<div style="width:1px;height:8px;background:' + tnC.line + '"></div>'
      + '<div style="background:' + (b.g.id === tnINBOX ? tnC.accentSoft : tnC.card) + ';border:1px solid ' + (b.g.id === tnINBOX ? tnC.accent : tnC.line) + ';border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;color:' + (b.g.id === tnINBOX ? tnC.accent : tnC.text) + ';white-space:nowrap">' + tnEsc(b.g.name) + ' <span style="color:' + tnC.faint + ';font-weight:400;font-size:11px;font-variant-numeric:tabular-nums">' + b.items.length + '</span></div>'
      + '<div style="width:1px;height:10px;background:' + tnC.line + '"></div>'
      + '<div style="display:flex;flex-direction:column;gap:7px;width:100%">'
      + b.items.map(t => '<div data-tid="' + t.id + '" onclick="tnOpen(\'' + t.id + '\')" style="display:flex;align-items:center;gap:5px;background:' + (tnTcol(t.color) || tnC.card) + ';border:1px solid ' + tnC.line + ';border-radius:8px;padding:6px 10px;font-size:12.5px;color:' + (t.status === 'done' ? tnC.faint : tnC.text) + ';text-decoration:' + (t.status === 'done' ? 'line-through' : 'none') + ';cursor:pointer">'
        + '<span style="width:6px;height:6px;border-radius:50%;background:' + tnSColor(t.status) + ';flex-shrink:0"></span>'
        + (t.pinned ? tnI('pin', 11, tnC.accent, tnC.accent) : '') + (t.priority === 'urgent' ? tnI('flame', 11, tnC.red) : '') + tnEsc(t.title) + '</div>').join('')
      + '</div></div>';
  });
  h += '</div></div></div>';
  return h;
}

/* ── 任務詳情彈窗（點卡片開啟；輸入即存、✓ 完成關閉） ── */
function tnUpdSilent(id, patch) { tnUpd(id, patch, true); } // 打字輸入：更新＋排存檔但不整頁重畫（焦點不掉）

/* ── v1.5 步驟清單（張良「大任務拆小步驟逐條勾」）──
   新欄位 todos=[{id,t,d}]（id=短隨機/t=文字/d=0或1）；查證過：主 App src/ 沒人讀 ck
   （那是 p03-sopedit 的 SOP 問題回報域欄位，格式也不同）→ 任務域用乾淨新欄位，
   主 App Merge Rule {...existing,...patch} 原樣保留＝同 ack/review，雙邊不打架。
   勾/增/刪/拖排全走 tnUpd＝原有防抖 0.5 秒 diffPersist 差異存檔，欄位保留原則照舊。 */
const tnTdRid = () => 'td' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6); // 短隨機 id（時間尾碼+亂數＝同秒連按也不撞）
function tnTodoAdd(id) { // Enter 新增：清空輸入框＋焦點保留（tnRender 的 activeElement id 接回）＝連續輸入不斷手
  const el = document.getElementById('tnTodoIn');
  const v = el ? String(el.value || '').trim() : '';
  if (!v) return;
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  tnUpd(id, { todos: (t.todos || []).concat([{ id: tnTdRid(), t: v, d: 0 }]) }); // 重畫後輸入框是空的＝自動清空
}
function tnTodoToggle(id, did) { // 勾了＝文字劃線變淡（畫面在 tnModal 那段）
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  tnUpd(id, { todos: (t.todos || []).map(x => x.id === did ? Object.assign({}, x, { d: x.d ? 0 : 1 }) : x) });
}
function tnTodoDel(id, did) { // 單項步驟輕量＝不 confirm（任務刪除才要 confirm）；刪到空就整個欄位收掉（JSON 存檔 undefined 自動消失）
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  const next = (t.todos || []).filter(x => x.id !== did);
  tnUpd(id, { todos: next.length ? next : undefined });
}
let tnTodoSortInst = null; // SortableJS 實例（每次重畫 DOM 整換＝先收舊的再掛新的，不堆殭屍）
function tnTodoSortInit() { // tnRender 畫完呼叫：彈窗開著＋頁面全域 Sortable 1.15 在才掛（深層連結直開彈窗同一條路）
  try { if (tnTodoSortInst) { tnTodoSortInst.destroy(); tnTodoSortInst = null; } } catch (_) { tnTodoSortInst = null; }
  if (!tnS.sel || typeof document === 'undefined') return;
  const el = document.getElementById('tnTodoList');
  if (!el || typeof Sortable === 'undefined') return;
  tnTodoSortInst = new Sortable(el, {
    handle: '.tnTodoHandle', animation: 150,
    onEnd: function () { // 排序完立即存：照 DOM 順序重排陣列（DOM 沒出現的保險補尾＝絕不弄丟）
      const tid = tnS.sel; const t = (tnS.tasks || []).find(x => x.id === tid); if (!t) return;
      const ids = Array.from(el.querySelectorAll('[data-tdid]')).map(n => n.getAttribute('data-tdid'));
      const map = new Map((t.todos || []).map(x => [x.id, x]));
      const next = ids.map(i => map.get(i)).filter(Boolean);
      (t.todos || []).forEach(x => { if (!next.includes(x)) next.push(x); });
      tnUpd(tid, { todos: next });
    },
  });
}
function tnModal() {
  const t = (tnS.tasks || []).find(x => x.id === tnS.sel); if (!t) return '';
  const groups = tnGroups();
  const F = (label, node) => '<label style="' + tnLbl + '">' + label + '<div style="margin-top:5px">' + node + '</div></label>';
  let h = '<div onclick="if(event.target===this)tnClose()" style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px">'
    + '<div style="background:' + tnMOD + ';border:1px solid ' + tnC.line + ';border-radius:12px;padding:' + (tnMob() ? 16 : 24) + 'px;width:min(560px,96vw);max-height:90vh;overflow-y:auto">';
  // 頂列：釘選/刪除/關閉
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
    + '<div style="font-size:15px;font-weight:600;color:' + tnC.text + '">任務詳情</div><div style="flex:1"></div>'
    + '<button onclick="tnNotifyAsk(\'' + t.id + '\')" title="隨時補通知：發群組或私訊負責人" style="display:inline-flex;align-items:center;gap:5px;background:none;border:1px solid ' + tnC.line + ';color:' + tnC.sub + ';border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer">' + tnI('bell', 12) + '通知</button>'
    + '<button onclick="tnPinToggle(\'' + t.id + '\')" style="display:inline-flex;align-items:center;gap:5px;background:' + (t.pinned ? tnC.accentSoft : 'none') + ';border:1px solid ' + (t.pinned ? tnC.accent : tnC.line) + ';color:' + (t.pinned ? tnC.accent : tnC.sub) + ';border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer">' + tnI('pin', 12, 'currentColor', t.pinned ? tnC.accent : 'none') + (t.pinned ? '已釘選' : '釘選') + '</button>'
    + '<button onclick="tnDel(\'' + t.id + '\')" style="background:none;border:1px solid ' + tnC.line + ';color:' + tnC.red + ';border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer">刪除</button>'
    + '<button onclick="tnClose()" style="background:none;border:none;cursor:pointer;color:' + tnC.sub + ';padding:4px;display:flex">' + tnI('x', 18) + '</button></div>';
  // v1.3 彈窗頂大顆「確認收到」（深層連結直開彈窗後第一眼就按得到；條件同卡片小鈕）；
  // 已 ack＝整寬綠色狀態列「已收到・名字＋計時」（計時＝claimAt 起 tnFmtDur，完成後不再跳）
  const tnAckable = t.status !== 'done' && !(t.ack && t.ack.by) && tnS.me && t.owner === tnS.me && t.createdBy !== tnS.me;
  if (tnAckable) {
    h += '<button onclick="tnAck(\'' + t.id + '\')" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:' + tnC.accent + ';color:#fff;border:none;border-radius:10px;padding:13px 0;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:14px;box-shadow:0 2px 12px rgba(77,163,255,.35)">' + tnI('check', 17, '#fff') + '確認收到・開始計時</button>';
  } else if (t.ack && t.ack.by) {
    h += '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;width:100%;background:#16281C;border:1.5px solid ' + tnC.green + ';color:' + tnC.green + ';border-radius:10px;padding:11px 8px;font-size:14px;font-weight:700;margin-bottom:14px;box-sizing:border-box">' + tnI('check', 15, tnC.green) + '已收到・' + tnEsc(t.ack.by) + (t.ack.ts ? '（' + tnDnorm(t.ack.ts) + '）' : '')
      + ((t.status !== 'done' && t.claimBy && t.claimAt) ? '<span style="display:inline-flex;align-items:center;gap:4px;color:' + tnC.accent + '">' + tnI('clock', 13, tnC.accent) + tnFmtDur((Date.now() - t.claimAt) / 60000) + '</span>' : '') + '</div>';
  }
  h += F('主題', '<input id="tnTitle" value="' + tnEsc(t.title) + '" oninput="tnUpdSilent(\'' + t.id + '\',{title:this.value})" style="' + tnInp + ';width:100%;font-size:14px;font-weight:600">');
  h += F('內容 / 備註', '<textarea id="tnNote" rows="2" oninput="tnUpdSilent(\'' + t.id + '\',{note:this.value})" style="' + tnInp + ';width:100%;resize:vertical">' + tnEsc(t.note || '') + '</textarea>');
  // v1.5 步驟清單（張良「大任務拆小步驟逐條勾」）：todos=[{id,t,d}] 新欄位；
  // 勾/增/刪/拖排全走 tnUpd＝diffPersist 差異存檔；✕ hover 才現（單項輕量不 confirm）；⠿把手給 SortableJS
  const tds = t.todos || [];
  h += '<div style="' + tnLbl + '">步驟清單（勾掉＝做完一步，拖 ⠿ 可排順序）'
    + '<style>.tnTodoDel{opacity:0;transition:opacity .15s}.tnTodoRow:hover .tnTodoDel{opacity:1}@media(hover:none){.tnTodoDel{opacity:.55}}</style>'
    + '<div id="tnTodoList" style="margin-top:5px;display:flex;flex-direction:column;gap:3px">'
    + tds.map(td => '<div class="tnTodoRow" data-tdid="' + tnEsc(td.id) + '" style="display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:6px;background:' + tnC.soft + '">'
      + '<span class="tnTodoHandle" title="拖我排順序" style="flex-shrink:0;display:flex;cursor:grab;color:' + tnC.faint + ';touch-action:none">' + tnI('grip', 12) + '</span>'
      + '<button onclick="tnTodoToggle(\'' + t.id + '\',\'' + tnEsc(td.id) + '\')" title="切換完成" style="flex-shrink:0;width:15px;height:15px;border-radius:4px;border:1px solid ' + (td.d ? tnC.green : tnCBR) + ';background:' + (td.d ? tnC.green : tnWHT) + ';display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0">' + (td.d ? tnI('check', 10, '#fff') : '') + '</button>'
      + '<span style="flex:1;min-width:0;font-size:12.5px;line-height:1.4;word-break:break-word;color:' + (td.d ? tnC.faint : tnC.text) + ';text-decoration:' + (td.d ? 'line-through' : 'none') + '">' + tnEsc(td.t) + '</span>'
      + '<button class="tnTodoDel" onclick="tnTodoDel(\'' + t.id + '\',\'' + tnEsc(td.id) + '\')" title="刪掉這步" style="flex-shrink:0;display:flex;background:none;border:none;color:' + tnC.faint + ';cursor:pointer;padding:2px;line-height:1">' + tnI('x', 12) + '</button>'
      + '</div>').join('')
    + '</div>'
    + '<input id="tnTodoIn" placeholder="＋ 新增步驟…按 Enter（可連續輸入）" onkeydown="if(event.key===\'Enter\'&&!event.isComposing&&event.keyCode!==229)tnTodoAdd(\'' + t.id + '\')" style="' + tnInp + ';width:100%;margin-top:5px;border-style:dashed;background:transparent;font-size:12.5px">'
    + '</div>';
  // 附件（不能包 label：label 會把點擊轉給隱藏選檔 input）
  h += '<div style="' + tnLbl + '">附件（截圖直接貼上，或按＋上傳檔案）<div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
    + '<input id="tnFile" type="file" accept="*/*" multiple style="display:none" onchange="tnAttachPick(\'' + t.id + '\',this)">'
    + (t.files || []).map(f => '<span style="position:relative;display:inline-flex">'
      + (f.isImage
        ? '<img src="' + tnEsc(f.url) + '" alt="" onclick="tnImgView(\'' + tnEsc(f.url) + '\')" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid ' + tnC.line + ';cursor:zoom-in">'
        : '<a href="' + tnEsc(f.url) + '" target="_blank" rel="noreferrer" title="' + tnEsc(f.name) + '" style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:52px;height:52px;border-radius:6px;border:1px solid ' + tnC.line + ';text-decoration:none;color:' + tnC.sub + '">' + tnI('file', 18) + '<span style="font-size:8.5px;color:' + tnFNT + ';max-width:46px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + tnEsc(f.name) + '</span></a>')
      + '<button onclick="tnAttDel(\'' + t.id + '\',\'' + f.id + '\')" style="position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:9px;border:1.5px solid ' + tnMOD + ';background:' + tnC.red + ';color:#fff;font-size:11px;line-height:14px;cursor:pointer;padding:0">×</button></span>').join('')
    + '<button id="tnAttBtn" onclick="document.getElementById(\'tnFile\').click()" title="點選檔上傳；或直接貼上截圖" style="border:1.5px dashed ' + tnC.line + ';background:' + tnWHT + ';color:' + tnFNT + ';border-radius:6px;width:52px;height:52px;font-size:12px;cursor:pointer;line-height:1.3">＋<br>貼/傳</button>'
    + '</div></div>';
  // 兩欄欄位
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">';
  h += F('隸屬大項', '<select onchange="tnUpd(\'' + t.id + '\',{catId:this.value})" style="' + tnInp + ';width:100%">' + groups.map(g => '<option value="' + g.id + '"' + ((t.catId || tnINBOX) === g.id ? ' selected' : '') + '>' + tnEsc(g.name) + '</option>').join('') + '</select>');
  h += F('狀態', '<select onchange="tnUpd(\'' + t.id + '\',{status:this.value})" style="' + tnInp + ';width:100%">' + tnSTATUS.map(s => '<option value="' + s[0] + '"' + (t.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select>');
  // v1.5 欄位對調（張良「開始/截止放一起」）：開始日｜截止日 同排（開始在左）、優先級｜負責人 同排；只動排版不動邏輯
  h += F('開始日', '<input type="date" value="' + tnDnorm(t.start) + '" onchange="tnUpd(\'' + t.id + '\',{start:this.value})" style="' + tnDateInp + ';width:100%">');
  h += F('截止日', '<input type="date" value="' + tnDnorm(t.due) + '" onchange="tnUpd(\'' + t.id + '\',{due:this.value})" style="' + tnDateInp + ';width:100%">');
  h += F('優先級', '<select onchange="tnUpd(\'' + t.id + '\',{priority:this.value})" style="' + tnInp + ';width:100%">' + tnPRIO.map(p => '<option value="' + p[0] + '"' + ((t.priority || 'normal') === p[0] ? ' selected' : '') + '>' + p[1] + '</option>').join('') + '</select>');
  // 負責人選單（GD 人員＋任務裡出現過的人；自訂＝行內輸入，不用彈窗）
  const pool = [...new Set([].concat(tnS.gdNames, (tnS.tasks || []).flatMap(x => [x.owner, x.claimBy]).filter(Boolean), t.owner ? [t.owner] : []))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  h += F('負責人', tnS.ownerCustom
    ? '<input id="tnOwnerIn" autofocus placeholder="輸入負責人名字後按 Enter" onkeydown="if(event.key===\'Enter\'&&!event.isComposing&&event.keyCode!==229)tnOwnerCustom(\'' + t.id + '\',this.value)" onblur="tnOwnerCustom(\'' + t.id + '\',this.value)" style="' + tnInp + ';width:100%">'
    : '<select onchange="tnOwnerSel(\'' + t.id + '\',this.value)" style="' + tnInp + ';width:100%;cursor:pointer">'
      + '<option value=""' + (!t.owner ? ' selected' : '') + '>— 未指定 —</option>'
      + pool.map(n => '<option value="' + tnEsc(n) + '"' + (t.owner === n ? ' selected' : '') + '>' + tnEsc(n) + '</option>').join('')
      + '<option value="__custom">自訂…</option></select>');
  h += '</div>'; // grid 結束
  // v4.41.4 瘦身（張良「內容多太大張、完成看不到還要滑」）：等待中/預估時間/依賴任務/標籤四欄位從彈窗拿掉（資料欄位保留，主App照舊）；
  // 色盤兩組重複(寫同一個 color 欄)→只留一組「卡片顏色」，圓點用鮮豔原色一眼分得出
  // v4.44.0 卡片顏色退役（張良）→ ⭐ 任務積分（360制度；特效跟著級距走）
  // v1.6 積分改一排數字鈕（張良）：點選=設定該分數、再點同一顆=清除（pts 整欄拿掉=不計分、卡片不掛徽章）；
  // 沒有 0 鈕；按鈕顏色=該分數落在的級距特效色；下方小鈕開「積分說明」同一個彈窗
  h += F('任務積分', (function () {
    const cur = Number(t.pts) || 0;
    const tr = tnTier(t.pts);
    const opts = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 100];
    let hh = '<div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:3px">'
      + opts.map(function (pv) {
        const pfx = (tnTier(pv) || { fx: tnPTS_FX[0] }).fx;
        const on = cur === pv;
        return '<button onclick="tnUpd(\'' + t.id + '\',{pts:' + (on ? 'undefined' : pv) + '})" title="' + (on ? '再點一下＝清除（不計分）' : pv + ' 分') + '" style="min-width:42px;padding:7px 4px;border-radius:8px;border:1.5px solid ' + pfx.c + ';background:' + (on ? pfx.c : 'transparent') + ';color:' + (on ? '#10151C' : pfx.c) + ';font-family:' + tnMONO + ';font-size:13px;font-weight:800;cursor:pointer' + (on ? ';box-shadow:0 0 10px ' + pfx.c + '66' : '') + '">' + pv + '</button>';
      }).join('') + '</div>';
    hh += '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">'
      + (tr ? '<span style="font-size:12px;font-weight:900;color:' + tr.fx.c + '">' + cur + ' 分・' + tnEsc(tr.name) + '</span>' : '<span style="font-size:12px;color:' + tnC.faint + '">沒選＝不計分</span>')
      + '<button onclick="tnPtsHelp()" style="display:inline-flex;align-items:center;gap:4px;border:1px solid ' + tnC.line + ';background:transparent;color:' + tnC.sub + ';border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer">' + tnI('star', 11) + '積分說明</button>'
      + '</div>';
    return hh;
  })());
  h += '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">'
    + '<div style="font-size:11px;color:' + tnC.faint + ';font-variant-numeric:tabular-nums">建立於 ' + tnDnorm(t.createdAt) + '</div>'
    + '<div style="flex:1"></div>'
    + '<button onclick="tnClose()" style="display:inline-flex;align-items:center;gap:6px;background:' + tnC.accent + ';color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13.5px;font-weight:700;cursor:pointer">' + tnI('check', 14, '#fff') + '完成</button></div>';
  h += '</div></div>';
  return h;
}

/* ── 指派通知三選一（選完負責人就地浮出；要明確按一顆才收＝不給誤觸跳過）
   「不通知」走前端直接跳過不打口（後端兩種都行，選簡單的那條） ── */
function tnAssignMenu() {
  const a = tnS.assignAsk; if (!a) return '';
  const btn = (icon, label, mode, accent) => '<button onclick="tnAssignGo(\'' + mode + '\')" style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:1px solid ' + (accent ? tnC.accent : tnC.line) + ';background:' + (accent ? tnC.accentSoft : tnWHT) + ';color:' + (accent ? tnC.accent : tnC.sub) + ';border-radius:8px;padding:10px 12px;font-size:13px;font-weight:600;cursor:pointer">' + tnI(icon, 15) + label + '</button>';
  return '<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:800;display:flex;align-items:center;justify-content:center;padding:16px">'
    + '<div style="background:' + tnMOD + ';border:1px solid ' + tnC.line + ';border-radius:12px;padding:18px;width:min(320px,94vw);display:flex;flex-direction:column;gap:8px">'
    + '<div style="font-size:14px;font-weight:700;color:' + tnC.text + '">' + (a.manual ? '通知誰？' : '已指派給 ' + tnEsc(a.owner)) + '</div>'
    + '<div style="font-size:12px;color:' + tnC.faint + ';margin-bottom:4px">' + (a.manual ? '把這張任務卡提醒發出去' : '要不要通知他？') + '</div>'
    + btn('users', '發到 GROUN:D Family 群', 'group', true)
    + (a.owner ? btn('send', '私訊負責人（' + tnEsc(a.owner) + '）', 'dm', false) : '')
    + btn('belloff', a.manual ? '取消' : '不通知', 'none', false)
    + '</div></div>';
}
function tnNotifyAsk(id) { // v4.41.4 卡片內隨時補通知（不限指派當下）
  const t = (tnS.tasks || []).find(x => x.id === id); if (!t) return;
  tnS.assignAsk = { id: id, owner: t.owner || '', manual: 1 };
  tnRender();
}
function tnAssignGo(mode) {
  const a = tnS.assignAsk; tnS.assignAsk = null;
  if (a && mode !== 'none') {
    const t = (tnS.tasks || []).find(x => x.id === a.id);
    tnNotify({ kind: a.manual ? 'manual' : 'assign', id: a.id, mode: mode, title: (t && t.title) || '', due: (t && t.due) || '', owner: a.owner, creator: (t && t.createdBy) || tnS.me || '', doer: tnS.me || '' });
  }
  tnRender();
}

/* ── v1.3 深層連結（#task=<id>）＝直接開詳情彈窗（取代 v1.2 捲動金光）──
   p10 路由（點通知/LINE 連結、hashchange）設 window.tnFocusId 再呼叫 taskEmbed()→tnPage()；
   每次 tnRender 畫完都會呼叫 tnFocusTry()（沒 tnFocusId＝一行就返回，零成本）。
   stale-first 兩段都接得住：
   ①快取那次 render：找得到＝直接 tnOpen 開彈窗；找不到「先不判死」（快取可能舊，背景還在抓）
   ②背景 tnRefetch 完成（tnFreshDone=true，tnPage 每次進站歸零）那次 render：還是沒有＝真的
     不存在（被刪）→ 清 tnFocusId＋小字提示不炸。
   hashchange 重複進來＝p10 重設 tnFocusId＋再呼叫 tnPage()→同一條路再開一次。 */
let tnFreshDone = false; // 這一輪（tnPage 進站起算）背景抓最新是否已完成＝「找不到」才能判死
function tnToastMini(msg) { // 小字浮提示（非阻斷；底部置中 3.5 秒自動消失）
  try {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:' + tnMOD + ';border:1px solid ' + tnC.line + ';color:' + tnC.sub + ';font-size:12px;padding:7px 14px;border-radius:999px;z-index:900;box-shadow:0 4px 14px rgba(0,0,0,.4);max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(d);
    setTimeout(() => { try { d.remove(); } catch (_) {} }, 3500);
  } catch (_) {}
}
function tnFocusTry() {
  const fid = window.tnFocusId;
  if (!fid || typeof document === 'undefined') return;
  if (!tnS.loaded || !Array.isArray(tnS.tasks)) return; // 連快取都還沒畫＝等 refetch 那次 render 再進來
  const t = tnS.tasks.find(x => x.id === fid);
  if (!t) {
    if (!tnFreshDone) return; // 快取舊、背景還在抓＝先不判死（fid 留著，抓完那次再看）
    window.tnFocusId = null;
    tnToastMini('找不到這張任務卡（可能已刪除）');
    return;
  }
  window.tnFocusId = null; // 先清再開（tnOpen 會重畫→再進 tnFocusTry，清了就一行返回不重入）
  tnOpen(fid);             // 直接開詳情彈窗（頂部就是大顆「確認收到」）
}

/* ── 初始化＋入口 ── */
function tnInit() {
  if (tnS.inited) return;
  tnS.inited = true;
  document.addEventListener('paste', tnPaste);
  window.addEventListener('keydown', tnKey);
  let rt = null;
  window.addEventListener('resize', () => { if (typeof curStore !== 'undefined' && curStore !== 'taskx') return; clearTimeout(rt); rt = setTimeout(tnRender, 150); });
  window.addEventListener('pagehide', tnFlushNow); // 關頁/切背景立刻寫入不漏資料（盡力而為）
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tnFlushNow(); });
  // 身分（我來解決記名）＋ GD 人員名單（負責人選單）
  try {
    const tk = (typeof TK === 'function' ? TK() : '');
    fetch('/api/mail-sync?whoami=' + encodeURIComponent(typeof K !== 'undefined' ? K : '') + '&r=' + Date.now() + (tk ? '&me=' + encodeURIComponent(tk) : ''))
      .then(r => r.json()).then(j => { if (j && j.me) { if (j.me.name) tnS.me = j.me.name; tnS.meApprover = !!j.me.approver; /* v1.6 積分說明可編輯＝只給 approver */ if (tnS.loaded) tnRender(); } }).catch(() => {});
    fetch('/api/mail-sync?shift=' + encodeURIComponent(typeof K !== 'undefined' ? K : '') + '&ym=' + tnToday().slice(0, 7))
      // v4.42.4 張良「指派怎麼沒有林品燊」：班表「非常態」(off)只影響班表快選，不該踢出任務負責人選單——只擋停權
      .then(r => r.json()).then(d => { if (d && d.ok) { tnS.gdNames = (d.staff || []).filter(s => s.role !== '停權').map(s => s.n); if (tnS.loaded) tnRender(); } }).catch(() => {});
  } catch (_) {}
}
async function tnRefetch() { // 背景抓最新；手上有沒存完的修改就不蓋
  const d = await tnFetchAll();
  tnFreshDone = true; // v1.3 這輪背景抓完（成敗都算）＝深層連結「找不到」從此可以判死
  if (!d) {
    if (!tnS.loaded) { tnS.tasks = tnS.tasks || []; tnS.cats = tnS.cats || []; tnS.loaded = true; tnRender(); }
    else tnFocusTry(); // 抓失敗沒重畫＝也要把等資料的深層連結收尾（手上資料找得到就開、沒有就提示）
    return;
  }
  if (tnSaveTimer || tnInflight > 0) { tnFocusTry(); return; } // 不蓋手上修改＝沒重畫，同樣收尾深層連結
  tnS.tasks = d.tasks; tnS.cats = d.cats; tnPersisted = d.tasks; tnS.loaded = true; if (d.ptscfg) tnS.ptscfg = d.ptscfg; tnS.ptsNote = d.ptsNote || ''; if (d.ptsBadge) tnS.ptsBadge = Object.assign({ pos: 'iconcol', size: 'auto' }, d.ptsBadge);
  if (d.ownerOrd) tnS.ownerOrd = d.ownerOrd;
  tnCacheSave();
  tnRender();
}
// 入口（整合方在 taskEmbed 呼叫）：stale-first＝先畫快取、背景抓最新再重畫
window.tnPage = function () {
  tnInit();
  tnFreshDone = false; // v1.3 每次進站重置＝這輪 refetch 回來前，深層連結找不到先不判死
  try { if (typeof curStore !== 'undefined') curStore = 'taskx'; } catch (_) {}
  try { if (typeof setTabs === 'function') setTabs('task'); } catch (_) {}
  try { const u = document.getElementById('upd'); if (u) u.textContent = '任務中心・與主 App 同步'; } catch (_) {}
  const c = tnCGet('tnData');
  if (c && Array.isArray(c.tasks)) { tnS.tasks = c.tasks; tnS.cats = Array.isArray(c.cats) ? c.cats : []; if (c.ownerOrd && Array.isArray(c.ownerOrd.order)) tnS.ownerOrd = c.ownerOrd; tnPersisted = c.tasks; tnS.loaded = true; }
  tnRender();
  tnRefetch();
};

/* ── v1.3 冷啟自救（深層連結 v1.2 沒生效的根因）──
   index.html script 順序＝p10-perm-init.js → tasks.js；p10 的路由 IIFE 在 tasks.js 載入前就跑完：
   #task=<id> 有設好 window.tnFocusId、也呼叫了 taskEmbed()，但當下 typeof tnPage !== 'function'
   → taskEmbed 走「tasks.js 沒載到」保險＝退回舊 iframe 版，tnPage/tnFocusTry 從頭到尾沒被叫到。
   tasks.js（最後一支 script）載好後發現有人還在等（tnFocusId 掛著）→ 清掉保險 iframe、自己接手跑原生版。 */
(function () {
  try {
    if (typeof window === 'undefined' || !window.tnFocusId) return;
    const tw = document.getElementById('taskWrap'); if (tw) tw.innerHTML = ''; // 退掉剛被誤開的 iframe 保險
    window.tnPage();
  } catch (_) {}
})();






/* ── ⭐ 積分說明彈窗 v1.6（張良「10 級級距表＋積分怎麼算」）──
   全員看得到：級距表（名稱/幾分起/說明，照特效色階上色）＋下方 note 說明文字；
   approver（whoami 回傳）＝note 變 textarea 可編輯＋「編輯級距」鈕開既有編輯器；其他人唯讀。
   note 與 tiers 同住 sp_team_pm_ptscfg 一份文件 → 兩邊存檔都整包 merge，誰也不洗掉誰。 */
function tnPtsHelp() {
  const old = document.getElementById('tnPtsHelpOv'); if (old) old.remove();
  const ov = document.createElement('div'); ov.id = 'tnPtsHelpOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:880;display:flex;align-items:center;justify-content:center;padding:16px';
  const rows = tnTiers().map(function (ti, i) {
    const fx = tnTierFx(i); // v1.7 改吃 tier.color（沒設 fallback 舊色階）；彩虹級色點用漸層
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 9px;border-radius:7px;background:' + fx.bg + ';border:1px solid ' + fx.c + '44;margin-bottom:4px">'
      + '<span style="width:9px;height:9px;border-radius:50%;background:' + (fx.rb ? tnRBG : fx.c) + ';flex-shrink:0"></span>'
      + '<span style="width:56px;flex-shrink:0;font-size:12.5px;font-weight:900;color:' + fx.c + '">' + tnEsc(ti.name || '') + '</span>'
      + '<span style="width:56px;flex-shrink:0;font-family:' + tnMONO + ';font-size:12px;font-weight:700;color:' + fx.c + ';text-align:right">' + (Number(ti.min) || 0) + ' 分起</span>'
      + '<span style="flex:1;min-width:0;font-size:12px;color:' + tnC.sub + ';padding-left:6px">' + tnEsc(ti.desc || '') + '</span></div>';
  }).join('');
  const noteBlock = tnS.meApprover
    ? '<textarea id="tnPtsNoteIn" rows="5" placeholder="寫給大家看的計分說明…" style="' + tnInp + ';width:100%;resize:vertical;font-size:12.5px;line-height:1.6">' + tnEsc(tnS.ptsNote || '') + '</textarea>'
      + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'
      + '<button onclick="tnPtsNoteSave()" style="display:inline-flex;align-items:center;gap:5px;border:none;background:' + tnC.accent + ';color:#fff;border-radius:8px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer">' + tnI('check', 12, '#fff') + '儲存說明</button>'
      + '<button onclick="document.getElementById(\'tnPtsHelpOv\').remove();tnPtsCfg()" style="display:inline-flex;align-items:center;gap:5px;border:1px solid ' + tnC.line + ';background:transparent;color:' + tnC.sub + ';border-radius:8px;padding:8px 14px;font-size:12.5px;cursor:pointer">' + tnI('gear', 12) + '編輯級距</button></div>'
    : (tnS.ptsNote
      ? '<div style="font-size:12.5px;color:' + tnC.sub + ';line-height:1.7;white-space:pre-wrap;word-break:break-word">' + tnEsc(tnS.ptsNote) + '</div>'
      : '<div style="font-size:12px;color:' + tnC.faint + '">（還沒有寫說明）</div>');
  ov.innerHTML = '<div style="background:' + tnMOD + ';border:1px solid ' + tnC.line + ';border-radius:14px;max-width:460px;width:100%;max-height:86vh;overflow:auto;padding:18px" onclick="event.stopPropagation()">'
    + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px"><span style="color:' + tnC.amber + '">' + tnI('star', 15, tnC.amber) + '</span><span style="font-weight:800;font-size:15px;color:' + tnC.text + '">積分說明</span><div style="flex:1"></div>'
    + '<button onclick="document.getElementById(\'tnPtsHelpOv\').remove()" style="background:none;border:none;cursor:pointer;color:' + tnC.sub + ';padding:4px;display:flex">' + tnI('x', 16) + '</button></div>'
    + rows
    + '<div style="font-size:11px;letter-spacing:.5px;color:' + tnC.faint + ';font-weight:600;margin:12px 0 6px">積分怎麼算</div>'
    + noteBlock
    + '</div>';
  ov.onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
}
async function tnPtsNoteSave() { // 存說明＝整包 merge：一定帶上現有 tiers，不然會把級距洗掉
  const el = document.getElementById('tnPtsNoteIn'); if (!el) return;
  const note = String(el.value || '').trim();
  const obj = { tiers: (tnS.ptscfg && tnS.ptscfg.length) ? tnS.ptscfg : tnPTS_DEF };
  if (note) obj.note = note;
  if (tnS.ptsBadge) obj.badge = tnS.ptsBadge; // v1.9 別洗掉徽章設定
  const r = await tnKV({ op: 'set', key: 'sp_team_pm_ptscfg', value: JSON.stringify(obj) });
  if (!r || !r.ok) { alert((r && r.error) || '沒存成功（要有編輯權限）'); return; }
  tnS.ptsNote = note;
  tnToastMini('說明已儲存');
}

/* ── ⚙️ 積分級距管理（v1.7 改版：▲▼ 退役改 ⠿ SortableJS 拖曳＋每列顏色欄）──
   顏色欄＝色塊點開原生 input[type=color] 寫 tier.color；旁邊小彩虹鈕＝設回 'rainbow'（漸層）；
   拖曳排序＝比照步驟清單做法（handle+onEnd 照 DOM 順序重排草稿再重畫）；儲存整列保留 color 欄 */
function tnPtsCfg(){
  window._tnPT = JSON.parse(JSON.stringify(tnTiers()));
  window._tnBadge = Object.assign({ pos: 'iconcol', size: 'auto' }, tnS.ptsBadge || {}); // v1.9 徽章設定草稿
  tnPtsCfgDraw();
}
function tnPtsReorder(idxArr){ // 拖完照 DOM 順序重排草稿（抽成函式好測；漏掉的保險補尾＝絕不弄丟）
  const old = window._tnPT || [];
  const next = idxArr.map(function(i){ return old[i]; }).filter(Boolean);
  old.forEach(function(t){ if (next.indexOf(t) < 0) next.push(t); });
  window._tnPT = next;
  tnPtsCfgDraw();
}
function tnPtsCfgDraw(){
  const L = window._tnPT;
  const old = document.getElementById('tnPtsOv'); if (old) old.remove();
  const ov = document.createElement('div'); ov.id = 'tnPtsOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = '<div style="background:' + tnMOD + ';border:1px solid ' + tnC.line + ';border-radius:14px;max-width:440px;width:100%;max-height:84vh;overflow:auto;padding:18px" onclick="event.stopPropagation()">'
    + '<div style="display:flex;align-items:center;gap:7px;font-weight:800;font-size:15px;color:' + tnC.text + '"><span style="color:' + tnC.amber + '">' + tnI('star', 15, tnC.amber) + '</span>積分級距</div>'
    + '<div style="font-size:12px;color:' + tnC.faint + ';margin:4px 0 10px">拖 ⠿ 排順序＝特效強度（越下面越浮誇）；點色塊改顏色、小漸層塊＝彩虹；每列「特效」鈕＝細調卡片色/框/光/閃動；任務達到「起始分」就套該級</div>'
    // v1.9 徽章設定（張良「徽章的位子跟大小也要讓我可以編輯」）：全站統一
    + (function(){ const bg = window._tnBadge || (window._tnBadge = Object.assign({ pos: 'iconcol', size: 'auto' }, tnS.ptsBadge || {}));
      const segB = function(key, cur, opts){ return opts.map(function(o){ const on = String(cur) === String(o[0]); return '<button onclick="window._tnBadge.' + key + '=\'' + o[0] + '\';tnPtsCfgDraw()" style="padding:5px 10px;border-radius:7px;border:1px solid ' + (on ? tnC.accent : tnC.line) + ';background:' + (on ? tnC.accentSoft : 'transparent') + ';color:' + (on ? tnC.accent : tnC.sub) + ';font-size:12px;font-weight:' + (on ? 700 : 400) + ';cursor:pointer">' + o[1] + '</button>'; }).join(''); };
      return '<div style="border:1px solid ' + tnC.line + ';border-radius:10px;padding:10px 12px;margin-bottom:12px">'
        + '<div style="font-size:12px;font-weight:700;color:' + tnC.text + ';margin-bottom:7px">等級徽章</div>'
        + '<div style="font-size:11px;color:' + tnC.faint + ';margin-bottom:4px">位置</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">' + segB('pos', bg.pos, [['iconcol', '右上圖示欄'], ['titleTop', '標題上方'], ['titleR', '標題右'], ['titleL', '標題左']]) + '</div>'
        + '<div style="font-size:11px;color:' + tnC.faint + ';margin-bottom:4px">大小</div><div style="display:flex;flex-wrap:wrap;gap:5px">' + segB('size', bg.size, [['auto', '隨等級'], ['s', '小'], ['m', '中'], ['l', '大'], ['xl', '特大']]) + '</div></div>'; })()
    + '<div id="tnPtsList">'
    + L.map(function(ti, i){
      const col = String(ti.color || '').trim();
      const base = tnPTS_FX[Math.min(i, tnPTS_FX.length - 1)];
      const isRb = col === 'rainbow';
      const swatch = isRb ? tnRBG : (/^#/.test(col) ? col : base.c); // 色塊顯示：彩虹=漸層、沒設=fallback 色階
      const pickVal = /^#/.test(col) ? col : base.c;                  // 原生色盤初始值（rainbow 給 fallback 色起跳）
      return '<div class="tnPtsRow" data-pti="' + i + '" style="display:flex;gap:6px;align-items:center;margin-bottom:8px">'
      + '<span class="tnPtsHandle" title="拖我排順序" style="flex-shrink:0;display:flex;cursor:grab;color:' + tnC.faint + ';touch-action:none">' + tnI('grip', 14) + '</span>'
      + '<span style="position:relative;flex-shrink:0;display:flex">'
      + '<button onclick="this.nextElementSibling.click()" title="這一級的顏色（點我改）" style="width:22px;height:22px;border-radius:50%;border:1.5px solid ' + tnC.line + ';cursor:pointer;padding:0;background:' + swatch + '"></button>'
      + '<input type="color" value="' + pickVal + '" onchange="window._tnPT[' + i + '].color=this.value;tnPtsCfgDraw()" style="position:absolute;left:0;top:0;width:22px;height:22px;opacity:0;pointer-events:none">'
      + '</span>'
      + '<button onclick="window._tnPT[' + i + '].color=\'rainbow\';tnPtsCfgDraw()" title="設成彩虹（漸層）" style="flex-shrink:0;width:15px;height:15px;border-radius:4px;border:1px solid ' + tnC.line + ';cursor:pointer;padding:0;background:' + tnRBG + ';opacity:' + (isRb ? 1 : .45) + '"></button>'
      + '<input value="' + (ti.name||'') + '" placeholder="級名" onchange="window._tnPT[' + i + '].name=this.value.trim()" style="width:64px;padding:7px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.text + ';font-weight:800">'
      + '<input inputmode="numeric" value="' + (ti.min||0) + '" onchange="window._tnPT[' + i + '].min=Math.max(0,Number(this.value)||0)" style="width:50px;padding:7px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.text + ';text-align:center" title="起始分">'
      + '<input value="' + (ti.desc||'') + '" placeholder="說明" onchange="window._tnPT[' + i + '].desc=this.value.trim()" style="flex:1;min-width:0;padding:7px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.sub + ';font-size:12.5px">'
      + '<button onclick="tnPtsFxEdit(' + i + ')" title="這一級的特效：卡片色/框色/框粗細/卡片光/框光/閃動" style="flex-shrink:0;display:inline-flex;align-items:center;gap:3px;padding:6px 10px;border:1px solid ' + (ti.fx ? tnC.accent : tnC.line) + ';border-radius:8px;background:' + (ti.fx ? tnC.accentSoft : 'transparent') + ';color:' + (ti.fx ? tnC.accent : tnC.sub) + ';cursor:pointer;font-size:12px;font-weight:700">' + tnI('star', 12, ti.fx ? tnC.accent : 'currentColor') + '特效</button>'
      + '<button onclick="window._tnPT.splice(' + i + ',1);tnPtsCfgDraw()" style="padding:6px 9px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.red + ';cursor:pointer">✕</button></div>'; }).join('')
    + '</div>'
    + '<button onclick="window._tnPT.push({name:\'\',min:0,desc:\'\'});tnPtsCfgDraw()" style="padding:7px 14px;border:1px dashed ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.sub + ';cursor:pointer">＋ 新增級距</button>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    + '<button onclick="document.getElementById(\'tnPtsOv\').remove()" style="padding:9px 14px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.sub + ';cursor:pointer">取消</button>'
    + '<button onclick="tnPtsCfgSave()" style="padding:9px 18px;border:none;border-radius:8px;background:' + tnC.accent + ';color:#fff;font-weight:700;cursor:pointer">✓ 儲存</button></div></div>';
  ov.onclick = function(){ ov.remove(); };
  document.body.appendChild(ov);
  // ⠿ 拖曳排序（SortableJS 全域已載；每次重畫整個 overlay 重建＝舊實例跟著 DOM 一起丟，不堆殭屍）
  try {
    const listEl = document.getElementById('tnPtsList');
    if (listEl && typeof Sortable !== 'undefined') {
      new Sortable(listEl, { handle: '.tnPtsHandle', animation: 150, onEnd: function(){
        tnPtsReorder(Array.from(listEl.querySelectorAll('.tnPtsRow')).map(function(n){ return Number(n.getAttribute('data-pti')); }));
      } });
    }
  } catch (_) {}
}
/* v1.8 單級特效編輯（張良「卡片色/框色/框粗細/卡片光/框光/閃動方式都可編」）：
   獨立浮層蓋在級距編輯器上，改 window._tnPT[i].fx；關掉回級距編輯器（底下還開著），一起按儲存才寫庫 */
function tnPtsFxEdit(i) {
  window._tnFxI = i;
  tnPtsFxDraw();
}
function tnPtsFxSet(key, val) {
  const i = window._tnFxI; const L = window._tnPT; if (!L || !L[i]) return;
  const cur = tnFxResolve(L[i], i); // 先補成完整 6 參數＝改一項不用全填
  cur[key] = val;
  L[i].fx = cur;
  tnPtsFxDraw();
}
function tnPtsFxReset() {
  const i = window._tnFxI; if (window._tnPT && window._tnPT[i]) delete window._tnPT[i].fx;
  tnPtsFxDraw();
}
function tnPtsFxDraw() {
  const i = window._tnFxI; const L = window._tnPT; if (!L || !L[i]) return;
  const ti = L[i]; const f = tnFxResolve(ti, i);
  const old = document.getElementById('tnFxOv'); if (old) old.remove();
  const ov = document.createElement('div'); ov.id = 'tnFxOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:950;display:flex;align-items:center;justify-content:center;padding:16px';
  // 分段選擇器：opts=[[值,標籤],…]
  const seg = (key, cur, opts) => '<div style="display:flex;flex-wrap:wrap;gap:5px">' + opts.map(function(o){
    const on = String(cur) === String(o[0]);
    return '<button onclick="tnPtsFxSet(\'' + key + '\',' + (typeof o[0] === 'number' ? o[0] : '\'' + o[0] + '\'') + ')" style="padding:6px 11px;border-radius:7px;border:1px solid ' + (on ? tnC.accent : tnC.line) + ';background:' + (on ? tnC.accentSoft : 'transparent') + ';color:' + (on ? tnC.accent : tnC.sub) + ';font-size:12.5px;font-weight:' + (on ? 700 : 400) + ';cursor:pointer">' + o[1] + '</button>';
  }).join('') + '</div>';
  const row = (label, body) => '<div style="margin-bottom:12px"><div style="font-size:11px;letter-spacing:.5px;color:' + tnC.faint + ';font-weight:600;margin-bottom:5px">' + label + '</div>' + body + '</div>';
  const bgHex = /^#/.test(f.bg) ? f.bg : '#4DA3FF';
  const bdHex = /^#/.test(f.bd) ? f.bd : '#4DA3FF';
  ov.innerHTML = '<div style="background:' + tnMOD + ';border:1px solid ' + tnC.line + ';border-radius:14px;max-width:400px;width:100%;max-height:86vh;overflow:auto;padding:18px" onclick="event.stopPropagation()">'
    + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:12px"><span style="color:' + tnC.amber + '">' + tnI('star', 15, tnC.amber) + '</span><span style="font-weight:800;font-size:15px;color:' + tnC.text + '">特效・' + tnEsc(ti.name || ('第' + (i + 1) + '級')) + '</span><div style="flex:1"></div><button onclick="document.getElementById(\'tnFxOv\').remove()" style="background:none;border:none;cursor:pointer;color:' + tnC.sub + ';padding:4px;display:flex">' + tnI('x', 16) + '</button></div>'
    + row('卡片色', seg('bg', f.bg, [['', '無'], ['auto', '跟等級色']]) + '<div style="margin-top:5px;display:inline-flex;align-items:center;gap:6px"><input type="color" value="' + bgHex + '" onchange="tnPtsFxSet(\'bg\',this.value)" style="width:30px;height:26px;border:1px solid ' + tnC.line + ';border-radius:6px;background:transparent;cursor:pointer"><span style="font-size:12px;color:' + (/^#/.test(f.bg) ? tnC.accent : tnC.faint) + '">自訂' + (/^#/.test(f.bg) ? '：' + f.bg : '') + '</span></div>')
    + row('框色', seg('bd', f.bd, [['', '無'], ['same', '跟卡片/等級色']]) + '<div style="margin-top:5px;display:inline-flex;align-items:center;gap:6px"><input type="color" value="' + bdHex + '" onchange="tnPtsFxSet(\'bd\',this.value)" style="width:30px;height:26px;border:1px solid ' + tnC.line + ';border-radius:6px;background:transparent;cursor:pointer"><span style="font-size:12px;color:' + (/^#/.test(f.bd) ? tnC.accent : tnC.faint) + '">自訂' + (/^#/.test(f.bd) ? '：' + f.bd : '') + '</span></div>')
    + row('框粗細', seg('bw', f.bw, [[0, '無'], [1, '細'], [1.5, '中'], [2.5, '粗'], [4, '很粗'], [6, '超粗']]))
    + row('卡片光（整卡外光暈）', seg('cg', f.cg, [[0, '無'], [1, '微'], [2, '中'], [3, '強'], [4, '超強']]))
    + row('框光（描邊光暈）', seg('bg2', f.bg2, [[0, '無'], [1, '微'], [2, '中'], [3, '強'], [4, '超強']]))
    + row('閃動方式', seg('anim', f.anim, [['none', '無'], ['breathe', '呼吸'], ['blink', '閃爍'], ['flow', '流動'], ['rainbow', '彩虹流動']]))
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">'
    + '<button onclick="tnPtsFxReset()" style="padding:8px 12px;border:1px solid ' + tnC.line + ';border-radius:8px;background:transparent;color:' + tnC.sub + ';cursor:pointer;font-size:12.5px">還原預設</button>'
    + '<button onclick="document.getElementById(\'tnFxOv\').remove()" style="padding:8px 18px;border:none;border-radius:8px;background:' + tnC.accent + ';color:#fff;font-weight:700;cursor:pointer">完成</button></div>'
    + '<div style="font-size:11px;color:' + tnC.faint + ';margin-top:8px">改完記得回上一層按「✓ 儲存」才會套用</div></div>';
  ov.onclick = function () { ov.remove(); };
  document.body.appendChild(ov);
}
async function tnPtsCfgSave(){
  // v1.7：整列原物件下去存＝color 欄（含 'rainbow'）自動保留；沒 color 的舊級距照舊 fallback 色階
  const L = (window._tnPT||[]).filter(function(t){ return t.name && Number(t.min) >= 0; }).slice(0, 10);
  if (!L.length) { alert('至少留一級'); return; }
  // v1.9 整包 merge：note/badge/tiers 同一份文件，存級距一定帶上，不互相洗掉
  const bdg = window._tnBadge || tnS.ptsBadge || { pos: 'iconcol', size: 'auto' };
  const obj = { tiers: L, badge: bdg }; if (tnS.ptsNote) obj.note = tnS.ptsNote;
  const r = await tnKV({ op: 'set', key: 'sp_team_pm_ptscfg', value: JSON.stringify(obj), token: (typeof TK === 'function' ? TK() : '') });
  if (!r || !r.ok) { alert((r && r.error) || '沒存成功（要有任務編輯權限）'); return; }
  tnS.ptscfg = L; tnS.ptsBadge = bdg;
  const o = document.getElementById('tnPtsOv'); if (o) o.remove();
  tnRender();
}
