/* ══════════════════════════════════════════════════════════════════════════
   TIER_EFFECTS 模組化特效註冊表（張良 2026-10-05 拍板：模組化、可相乘組合）
   參考實作：tier-effects-reference.html（七軌道圖層架構）
   ─ 單一來源：GD(public/ops/tasks.js, classic) 與主App(TaskCenter.jsx, ESM) 都讀 window.TIER_EFFECTS
   ─ 架構：卡片＝七個獨立圖層（軌道），每軌一次選一個模組，每層只控自己的 DOM/CSS → 任意組合不互相覆蓋
       框 border / 光暈 glow / 框外 outer / 邊緣 edge / 卡面 surf / 粒子 part / 徽章 badge
   ─ 跟「等級」走（不屬模組）：框粗 bw / 底色染色 tint / 徽章字級 bs / 內距 pd / 標題字級 ts / 光暈大小 gs
   ─ 新增模組＝在本檔 MODULES 加一筆，不改其他地方
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // ── 跟等級走的基礎尺寸（0~9；參考檔 BW/TI/BS/PD/TS/GS）──
  var BW = [1, 1, 1.5, 2, 3, 3, 4, 4, 5, 6];       // 框粗
  var TI = [0, 0, 0, .08, .12, .18, .24, .3, .36, .42]; // 底色染色強度
  var BS = [11, 11, 12, 13, 15, 18, 21, 24, 28, 33];    // 徽章字級
  var PD = [10, 10, 11, 12, 13, 14, 16, 18, 21, 24];    // 卡片內距
  var TS = [13, 13, 13, 14, 14, 15, 15, 16, 17, 18];    // 標題字級（參考用，GD 卡片自有字級）
  var GS = [8, 10, 12, 14, 16, 20, 22, 26, 30, 36];     // 光暈大小
  var RB = '#ff5a5a,#ffb84d,#f5e642,#4de88a,#4dc3ff,#9b74ff,#ff5ad2,#ff5a5a'; // 彩虹漸層

  function rgba(h, a) {
    try { var n = parseInt(String(h).slice(1), 16); return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
    catch (e) { return 'rgba(140,147,166,' + a + ')'; }
  }
  // 固定亂數（吃 seed）＝SSR/重畫不會每次跳位，但每顆卡粒子分佈不同
  function rnd(seed) { var x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); }
  function rr(seed, a, b) { return a + rnd(seed) * (b - a); }
  function bolt(y, seed) { var p = []; for (var x = 0; x <= 100; x += 4) { p.push(x + ',' + (y + rr(seed + x, -7, 7)).toFixed(1)); } return p.join(' '); }

  // ── 軌道 → 模組清單（UI 用；順序＝圖層由下到上）──
  var TRACKS = [
    ['border', '框', [['solid', '實線'], ['flow', '流動'], ['laser', '雷射'], ['laser2', '雙雷射'], ['rainbow', '彩虹旋框']]],
    ['glow', '光暈', [['none', '無'], ['static', '靜態'], ['breathe', '呼吸'], ['zap', '電擊閃']]],
    ['outer', '框外', [['none', '無'], ['ripple', '漣漪'], ['pulse', '脈衝光圈'], ['boom', '爆炸光圈']]],
    ['edge', '邊緣', [['none', '無'], ['bolt', '閃電'], ['fire', '火焰']]],
    ['surf', '卡面', [['none', '無'], ['shimmer', '掃光'], ['flash', '閃光']]],
    ['part', '粒子', [['none', '無'], ['gold', '金色'], ['rainbow', '彩虹']]],
    ['badge', '徽章', [['outline', '空心'], ['solid', '實心'], ['jump', '實心跳動'], ['rainbow', '彩虹跳動']]]
  ];
  var DEFAULTS = { border: 'solid', glow: 'none', outer: 'none', edge: 'none', surf: 'none', part: 'none', badge: 'outline' };
  // 「浮誇」模板：每級預設組合（參考檔 PR）
  var TPL_FANCY = [{}, { glow: 'breathe' }, { outer: 'ripple' }, { surf: 'shimmer' }, { border: 'laser', glow: 'static' }, { glow: 'breathe', outer: 'pulse', badge: 'solid' }, { glow: 'zap', edge: 'bolt', badge: 'solid' }, { glow: 'static', edge: 'fire', badge: 'solid' }, { border: 'laser2', glow: 'static', surf: 'shimmer', part: 'gold', badge: 'jump' }, { border: 'rainbow', glow: 'static', outer: 'boom', surf: 'flash', part: 'rainbow', badge: 'rainbow' }];
  // 「低調」模板：全無動畫，只留框色＋徽章（實心/空心看等級）
  function tplSubtle(level) { return { border: 'solid', glow: 'none', outer: 'none', edge: 'none', surf: 'none', part: 'none', badge: level >= 5 ? 'solid' : 'outline' }; }

  function modsForLevel(level, tplName) {
    var lv = Math.max(0, Math.min(9, level | 0));
    if (tplName === 'subtle') return Object.assign({}, DEFAULTS, tplSubtle(lv));
    return Object.assign({}, DEFAULTS, TPL_FANCY[lv] || {}); // 預設＝浮誇
  }

  // ── 基礎尺寸（跟等級走）──
  function base(level) {
    var lv = Math.max(0, Math.min(9, level | 0));
    return { bw: BW[lv], tint: TI[lv], bs: BS[lv], pd: PD[lv], ts: TS[lv], gs: GS[lv], gray: lv === 0 };
  }

  // ── 各圖層 render（回 HTML 片段或 style）。ctx = {color, level, gray, seed, anim(是否播動畫)} ──
  // anim=false（個人關閉動畫/完成卡）時，動畫類模組退化成靜態版（保留造型、不跑動畫）
  var L = {
    glow: function (mod, ctx) {
      if (mod === 'none') return '';
      var cc = ctx.gray ? '#8a93a6' : ctx.color, G = GS[ctx.level];
      var anim = ctx.anim ? ({ static: '', breathe: 'animation:tnfxOp 2.2s ease-in-out infinite;', zap: 'animation:tnfxZg 2.2s infinite;' }[mod] || '') : '';
      return '<div class="tnfxab" style="box-shadow:0 0 ' + G + 'px ' + rgba(cc, .85) + ',0 0 ' + (G * .4) + 'px ' + rgba(cc, .85) + ';' + anim + '"></div>';
    },
    outer: function (mod, ctx) {
      if (mod === 'none') return '';
      var cc = ctx.gray ? '#8a93a6' : ctx.color;
      if (!ctx.anim) { // 不播動畫＝退化成單一靜態光圈
        return '<div class="tnfxab" style="border:2px solid ' + rgba(cc, .5) + '"></div>';
      }
      if (mod === 'ripple') return '<div class="tnfxab" style="border:2px solid ' + cc + ';animation:tnfxRp 2s ease-out infinite"></div>';
      if (mod === 'pulse') { var h = ''; for (var j = 0; j < 3; j++) h += '<div class="tnfxab" style="border:2px solid ' + cc + ';animation:tnfxRp 1.8s ease-out ' + (j * .6) + 's infinite"></div>'; return h; }
      if (mod === 'boom') return ['#fff', '#ff5ad2', '#4dc3ff'].map(function (x, j) { return '<div class="tnfxab" style="border:3px solid ' + x + ';animation:tnfxBoom 2.6s ease-out ' + (j * .2) + 's infinite"></div>'; }).join('');
      return '';
    },
    // 框：回 {bg(clip底色style), child(clip內旋轉元素)}
    border: function (mod, ctx) {
      var cc = ctx.gray ? '#8a93a6' : ctx.color, gray = ctx.gray;
      if (mod === 'flow') return { bg: 'background:linear-gradient(90deg,' + cc + ',#fff6d0,' + cc + ',' + cc + ');background-size:200% 100%;' + (ctx.anim ? 'animation:tnfxRbf 3.5s linear infinite;' : ''), child: '' };
      if (mod === 'laser') return { bg: 'background:' + rgba(cc, .3) + ';', child: '<div class="tnfxrot"' + (ctx.anim ? '' : ' style="animation:none"') + '><div class="tnfxrotI" style="background:conic-gradient(transparent 0 72%,' + cc + ' 88%,#fff 91%,transparent 94%)"></div></div>' };
      if (mod === 'laser2') return { bg: 'background:' + rgba(cc, .3) + ';', child: '<div class="tnfxrot" style="' + (ctx.anim ? 'animation-duration:2s' : 'animation:none') + '"><div class="tnfxrotI" style="background:conic-gradient(transparent 0 30%,' + cc + ' 42%,#fff 46%,transparent 50% 80%,' + cc + ' 92%,#fff 96%,transparent 100%)"></div></div>' };
      if (mod === 'rainbow') return { bg: 'background:#222;', child: '<div class="tnfxrot" style="' + (ctx.anim ? 'animation-duration:2.4s' : 'animation:none') + '"><div class="tnfxrotI" style="background:conic-gradient(' + RB + ')"></div></div>' };
      return { bg: 'background:' + (gray ? '#2b3240' : cc) + ';', child: '' }; // solid
    },
    edge: function (mod, ctx) {
      if (mod === 'none') return '';
      var cc = ctx.gray ? '#8a93a6' : ctx.color, seed = ctx.seed;
      if (mod === 'bolt') { if (!ctx.anim) return ''; var h = ''; [[0, 0], [100, 1.1]].forEach(function (yd) { h += '<svg class="tnfxab" viewBox="0 0 100 100" preserveAspectRatio="none" style="overflow:visible;z-index:3;filter:drop-shadow(0 0 4px ' + cc + ') drop-shadow(0 0 8px ' + cc + ');animation:tnfxZap 2.2s ' + yd[1] + 's infinite"><polyline points="' + bolt(yd[0], seed) + '" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>'; }); return h; }
      if (mod === 'fire') { var h2 = ''; for (var j = 0; j < 14; j++) { var dur = rr(seed + j, .8, 1.3).toFixed(2), dl = rr(seed + j + 50, 0, 1).toFixed(2); h2 += '<span style="position:absolute;top:-12px;left:' + (j * 7.2 + rr(seed + j + 99, -2, 2)).toFixed(1) + '%;width:20px;height:24px;border-radius:50% 50% 40% 40%;background:radial-gradient(circle at 50% 70%,#fff4b8 0%,#ffb020 35%,#ff4d00 60%,transparent 72%);filter:blur(1.5px);' + (ctx.anim ? 'animation:tnfxFire ' + dur + 's ease-out ' + dl + 's infinite' : 'opacity:.55') + '"></span>'; } return h2; }
      return '';
    },
    surf: function (mod, ctx) {
      if (mod === 'none' || !ctx.anim) return '';
      if (mod === 'shimmer') return '<div class="tnfxsh"></div>';
      if (mod === 'flash') return '<div style="position:absolute;inset:0;background:#fff;animation:tnfxFla 2.6s infinite;pointer-events:none"></div>';
      return '';
    },
    part: function (mod, ctx) {
      if (mod === 'none') return '';
      var cc = ctx.gray ? '#8a93a6' : ctx.color, seed = ctx.seed;
      var pc = mod === 'gold' ? ['#fff3c0'] : ['#fff', '#f5e642', '#4dc3ff', '#ff5ad2'];
      var h = '';
      for (var j = 0; j < 12; j++) {
        var dur = rr(seed + j + 200, 1.3, 2.3).toFixed(2), dl = rr(seed + j + 300, 0, 2).toFixed(2);
        h += '<span style="position:absolute;z-index:3;top:' + rr(seed + j, 10, 75).toFixed(0) + '%;left:' + rr(seed + j + 7, 2, 98).toFixed(0) + '%;width:4px;height:4px;border-radius:50%;background:' + pc[j % pc.length] + ';box-shadow:0 0 6px ' + (mod === 'gold' ? cc : '#fff') + ';' + (ctx.anim ? 'animation:tnfxSpk ' + dur + 's linear ' + dl + 's infinite' : 'opacity:.7') + ';pointer-events:none"></span>';
      }
      return h;
    },
    // 徽章：回 style 字串（字級/內距跟等級走；顏色/造型跟模組）
    badge: function (mod, ctx) {
      var cc = ctx.gray ? '#8a93a6' : ctx.color, gray = ctx.gray, fs = BS[ctx.level];
      var s = 'font-size:' + fs + 'px;padding:' + (fs * .16).toFixed(1) + 'px ' + (fs * .55).toFixed(1) + 'px;';
      if (mod === 'rainbow') s += 'background:linear-gradient(90deg,' + RB + ');background-size:200% 100%;' + (ctx.anim ? 'animation:tnfxRbf 2.4s linear infinite,tnfxPu 1.3s ease-in-out infinite;' : '') + 'color:#1a1033;';
      else if (mod === 'solid' || mod === 'jump') s += 'background:' + cc + ';color:#12151c;' + (mod === 'jump' && ctx.anim ? 'animation:tnfxPu 1.3s ease-in-out infinite;' : '');
      else s += 'border:1.5px solid ' + cc + ';color:' + (gray ? '#c7ccd6' : cc) + ';background:' + rgba(cc, .12) + ';'; // outline
      return s;
    }
  };

  // ── 組一張卡的「圖層外殼」：把現成的卡片內容(innerHtml)包進七層結構 ──
  // opts = {mods, color, level, seed, anim, innerHtml, innerPad(是否用跟等級走的內距)}
  // 回完整 HTML：.tnfxw 外殼（padding=框粗）→ 光暈/框外(.tnfxab) → 框(.tnfxclip 底色+旋轉) → 邊緣 → .tnfxi 內容(染底+掃光/閃光+innerHtml) → 粒子
  function cardWrap(opts) {
    var mods = Object.assign({}, DEFAULTS, opts.mods || {});
    var level = Math.max(0, Math.min(9, (opts.level | 0)));
    var color = opts.color || '#8a93a6';
    var ctx = { color: color, level: level, gray: level === 0, seed: opts.seed || 1, anim: opts.anim !== false };
    var bw = BW[level], pd = (opts.innerPad === false ? null : PD[level]);
    var bd = L.border(mods.border, ctx);
    var tint = TI[level];
    var tintBg = tint ? ('linear-gradient(135deg,' + rgba(color, tint) + ',' + rgba(color, tint * .25) + ' 70%),') : '';
    var innerRadius = Math.max(14 - bw, 4);
    return '<div class="tnfxw" style="padding:' + bw + 'px">'
      + L.glow(mods.glow, ctx)
      + L.outer(mods.outer, ctx)
      + '<div class="tnfxclip" style="' + bd.bg + '">' + bd.child + '</div>'
      + L.edge(mods.edge, ctx)
      + '<div class="tnfxi" style="border-radius:' + innerRadius + 'px;background:' + tintBg + '#171c25;' + (pd != null ? 'padding:' + pd + 'px 12px;' : '') + '">'
      + L.surf(mods.surf, ctx)
      + (opts.innerHtml || '')
      + '</div>'
      + L.part(mods.part, ctx)
      + '</div>';
  }

  // ── 一次性注入 keyframes + 圖層 class（tasks.js / TaskCenter 載入後呼叫 TIER_EFFECTS.injectCss()）──
  var _injected = false;
  function injectCss() {
    if (_injected || typeof document === 'undefined') return; _injected = true;
    var css = ''
      + '@keyframes tnfxOp{0%,100%{opacity:.2}50%{opacity:1}}'
      + '@keyframes tnfxZg{0%,100%{opacity:.35}3%,9%{opacity:1}6%{opacity:.4}12%{opacity:.35}}'
      + '@keyframes tnfxRp{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.06,1.45);opacity:0}}'
      + '@keyframes tnfxRot{to{transform:rotate(360deg)}}'
      + '@keyframes tnfxSw{0%{left:-60%}55%,100%{left:130%}}'
      + '@keyframes tnfxZap{0%,100%{opacity:0}3%,9%{opacity:1}6%{opacity:.15}12%{opacity:0}}'
      + '@keyframes tnfxFire{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-24px) scale(.25);opacity:0}}'
      + '@keyframes tnfxSpk{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-46px);opacity:0}}'
      + '@keyframes tnfxBoom{0%{transform:scale(1);opacity:1}55%,100%{transform:scale(1.14,2.3);opacity:0}}'
      + '@keyframes tnfxFla{0%,100%{opacity:0}2%{opacity:.55}18%{opacity:0}}'
      + '@keyframes tnfxPu{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}'
      + '@keyframes tnfxRbf{to{background-position:200% 50%}}'
      + '.tnfxw{position:relative;border-radius:14px}'
      + '.tnfxab{position:absolute;inset:0;border-radius:14px;pointer-events:none}'
      + '.tnfxclip{position:absolute;inset:0;border-radius:14px;overflow:hidden;z-index:0}'
      + '.tnfxrot{position:absolute;left:50%;top:50%;width:640px;height:640px;margin:-320px 0 0 -320px;animation:tnfxRot 2.6s linear infinite}'
      + '.tnfxrotI{position:absolute;inset:0}'
      + '.tnfxi{position:relative;z-index:1;overflow:hidden}'
      + '.tnfxsh{position:absolute;top:0;left:-60%;width:45%;height:100%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.3),transparent);animation:tnfxSw 2.4s ease-in-out infinite;pointer-events:none;z-index:0}'
      // 個人偏好：跟隨系統減少動態（有 .tnFollowReduce 祖先時，reduce-motion 使用者全停）
      + '@media (prefers-reduced-motion:reduce){.tnFollowReduce [class^="tnfx"]{animation:none!important}.tnFollowReduce .tnfxw *{animation:none!important}}'
      // 個人偏好：全關動畫
      + '.tnAnimOff [class^="tnfx"],.tnAnimOff .tnfxw *{animation:none!important}'
      // 個人偏好：只播畫面內（捲出畫面的卡掛 tnAnimPause）
      + '.tnAnimPause [class^="tnfx"],.tnAnimPause.tnfxw *{animation-play-state:paused!important}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  root.TIER_EFFECTS = {
    TRACKS: TRACKS, DEFAULTS: DEFAULTS, base: base, cardWrap: cardWrap,
    badgeStyle: function (mod, color, level) { return L.badge(mod, { color: color, level: Math.max(0, Math.min(9, level | 0)), gray: level === 0, anim: true }); },
    layer: L, modsForLevel: modsForLevel, injectCss: injectCss, rgba: rgba,
    version: '1.0'
  };
})(typeof window !== 'undefined' ? window : this);
