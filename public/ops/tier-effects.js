/* ══════════════════════════════════════════════════════════════════════════
   TIER_EFFECTS v2 — mythic-motion-v2 參考規格落地（張良 2026-10-05 拍板）
   參考：~/Downloads/GROUN-D-mythic-motion-v2.html + mythic-motion-v2-parameters.md
   ─ 單一消費者：public/ops/tasks.js（原生任務中心 tnCard）
   ─ 鐵律（特效與排版徹底分離）：
       • 特效層(surface/frame/ring/particle) 全 position:absolute + pointer-events:none，不參與內容尺寸計算。
       • 框＝CSS mask 疊加層（非真 border）→ 框粗變化不位移內容、不壓縮寬度。
       • 外光＝wrapper box-shadow → 零版面成本，可柔和外溢但不佔空間。
       • 內容 padding 固定（.tnxBody）不隨等級；只有徽章字級依等級放大。
       • 不用全卡 overflow:hidden 蓋溢出；需要裁切的只有裝飾層(surface/particles)。
   ─ 等級動畫：素卡→掃光→光圈→呼吸→火星→金屬掃光金粉→彩虹框星塵
   ══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  // 十級參數（index 0~9 = 等級 1~10）；對齊 mythic-motion-v2-parameters.md
  // c=等級色 bw=框粗px g=外光半徑px fs=徽章字級px tint=底色光透明度 fx=動畫
  var LV = [
    { c: '#AAB4C4', bw: 1,   g: 0,  fs: 12, tint: 0,    fx: 'none'    }, // 1 日常
    { c: '#CD89A4', bw: 1,   g: 0,  fs: 14, tint: 0,    fx: 'none'    }, // 2 例行
    { c: '#62A7FF', bw: 1.5, g: 0,  fs: 16, tint: 0,    fx: 'none'    }, // 3 進階
    { c: '#AD8AFF', bw: 2,   g: 3,  fs: 18, tint: 0.03, fx: 'glow'    }, // 4 熟練（靜態微光）
    { c: '#35D9EC', bw: 2.5, g: 6,  fs: 20, tint: 0.07, fx: 'sweep'   }, // 5 稀有（沿卡掃光 6s）
    { c: '#FF5FAF', bw: 3,   g: 10, fs: 22, tint: 0.10, fx: 'rings'   }, // 6 精英（擴散光圈 5s）
    { c: '#FF5E66', bw: 4,   g: 16, fs: 24, tint: 0.14, fx: 'breathe' }, // 7 史詩（呼吸光 4s）
    { c: '#FF9F28', bw: 5,   g: 24, fs: 26, tint: 0.18, fx: 'sparks'  }, // 8 大師（火星上升）
    { c: '#FFDB6D', bw: 6,   g: 34, fs: 28, tint: 0.22, fx: 'metal'   }, // 9 傳說（金屬掃光＋金粉）
    { c: '#BE91FF', bw: 8,   g: 48, fs: 30, tint: 0.30, fx: 'mythic'  }  // 10 神話（彩虹框＋星塵）
  ];
  var CLV = function (level) { return Math.max(0, Math.min(9, level | 0)); };

  function rgba(h, a) {
    try { var n = parseInt(String(h).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
    catch (e) { return 'rgba(140,147,166,' + a + ')'; }
  }
  // 固定亂數（吃 seed）＝重畫不跳位、每卡粒子分佈不同
  function rnd(seed) { var x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); }
  function rr(seed, a, b) { return a + rnd(seed) * (b - a); }

  // ── 徽章 style（只有字級隨等級；造型跟等級）──
  function badgeStyle(level, color) {
    var lv = CLV(level), d = LV[lv], c = color || d.c, fs = d.fs;
    var s = 'font-size:' + fs + 'px;padding:' + (fs * .16).toFixed(1) + 'px ' + (fs * .5).toFixed(1) + 'px;'
      + 'border-radius:100px;white-space:nowrap;line-height:1.1;font-weight:800;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;flex-shrink:0;';
    if (lv === 9) s += 'color:#141b2b;border:0;background:linear-gradient(110deg,#ff8293,#ffd46a,#7aedb2,#83dcf4,#aa92ff);background-size:250% 100%;animation:tnxRainbow 8s ease-in-out infinite;'; // 神話彩虹徽章
    else if (lv >= 6) s += 'color:#171817;border:0;background:' + c + ';';      // 史詩以上實心
    else if (lv === 0) s += 'color:#c7ccd6;border:1.5px solid ' + c + ';background:' + rgba(c, .12) + ';'; // 日常
    else s += 'color:' + c + ';border:1.5px solid ' + c + ';background:' + rgba(c, .14) + ';';            // 空心
    return s;
  }

  // ── 粒子層 HTML（純裝飾；anim=false 不產生）──
  function particles(fx, c, seed) {
    if (fx === 'sparks' || fx === 'metal') {
      var h = '', cls = fx === 'metal' ? 'tnxPg' : 'tnxPs';
      for (var i = 0; i < 12; i++) {
        var x = rr(seed + i, 4, 94).toFixed(1), dur = rr(seed + i + 50, 3, 4.8).toFixed(2),
          dl = (-rr(seed + i + 90, 0, 4)).toFixed(2), sz = (1.5 + rr(seed + i + 7, 0, 2.5)).toFixed(1);
        h += '<i class="tnxP ' + cls + '" style="left:' + x + '%;width:' + sz + 'px;height:' + sz + 'px;--pc:' + c + ';animation-duration:' + dur + 's;animation-delay:' + dl + 's"></i>';
      }
      return '<div class="tnxParts">' + h + '</div>';
    }
    if (fx === 'mythic') {
      var h2 = '';
      for (var j = 0; j < 16; j++) {
        var x2 = rr(seed + j, 3, 95).toFixed(1), y2 = rr(seed + j + 11, 8, 85).toFixed(1),
          dur2 = rr(seed + j + 50, 2.2, 3.8).toFixed(2), dl2 = (-rr(seed + j + 90, 0, 3)).toFixed(2), sz2 = (1 + rr(seed + j + 7, 0, 2)).toFixed(1);
        h2 += '<i class="tnxP tnxStar" style="left:' + x2 + '%;top:' + y2 + '%;width:' + sz2 + 'px;height:' + sz2 + 'px;animation-duration:' + dur2 + 's;animation-delay:' + dl2 + 's"></i>';
      }
      return '<div class="tnxParts">' + h2 + '</div>';
    }
    return '';
  }

  // ── 包殼：把現成內容 innerHtml 包進特效層（內容尺寸只由 innerHtml 決定）──
  // opts = { color, level, seed, anim, innerHtml }
  function cardWrap(opts) {
    var lv = CLV(opts.level), d = LV[lv], c = opts.color || d.c, fx = d.fx;
    var anim = opts.anim !== false, seed = opts.seed || 1;
    var vars = '--c:' + c + ';--bw:' + d.bw + 'px;--g:' + d.g + 'px;--gc:' + rgba(c, .42) + ';--gcb:' + rgba(c, .62) + ';--tint:' + d.tint + ';--tc:' + rgba(c, Math.max(d.tint, 0.001)) + ';';
    var shadow = d.g ? 'box-shadow:0 0 var(--g) var(--gc);' : '';
    var sweepEl = (anim && (fx === 'sweep' || fx === 'metal')) ? '<div class="tnxSweep"></div>' : '';
    var ringEl = (anim && fx === 'rings') ? '<div class="tnxRing"></div><div class="tnxRing tnxRing2"></div>' : '';
    var partEl = anim ? particles(fx, c, seed) : '';
    return '<div class="tnfxw tnx' + (lv + 1) + ' tnfx-' + fx + (anim ? '' : ' tnfxStatic') + '" style="' + vars + shadow + '">'
      + '<div class="tnxSurface">' + sweepEl + '</div>'
      + '<div class="tnxFrame"></div>'
      + ringEl + partEl
      + '<div class="tnxBody">' + (opts.innerHtml || '') + '</div>'
      + '</div>';
  }

  // ── 一次性注入 CSS（keyframes＋圖層 class）──
  var _injected = false;
  function injectCss() {
    if (_injected || typeof document === 'undefined') return; _injected = true;
    try { if (root.CSS && CSS.registerProperty) CSS.registerProperty({ name: '--tnang', syntax: '<angle>', initialValue: '0deg', inherits: false }); } catch (e) {}
    var css = '@property --tnang{syntax:"<angle>";initial-value:0deg;inherits:false}'
      + '.tnfxw{position:relative;border-radius:14px;isolation:isolate}'
      // 卡面（底色＋高階染色＋金屬/星雲）
      + '.tnxSurface{position:absolute;inset:0;border-radius:inherit;background:#171E29;z-index:0;overflow:hidden;pointer-events:none}'
      + '.tnxSurface:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent,var(--tc));opacity:var(--tint);pointer-events:none}'
      // 框＝mask 疊加（只顯示 --bw 寬外環；框粗變化不動內容）
      + '.tnxFrame{position:absolute;inset:0;border-radius:inherit;padding:var(--bw);background:var(--c);pointer-events:none;z-index:3;'
      + '-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;'
      + 'mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);mask-composite:exclude}'
      // 內容（固定內距；永遠在最上層；不裁切）
      + '.tnxBody{position:relative;z-index:4;padding:12px 13px}'
      // 粒子 / 環 / 掃光（全 pointer-events:none，限制在卡內）
      + '.tnxParts{position:absolute;inset:0;z-index:2;pointer-events:none;overflow:hidden;border-radius:inherit}'
      + '.tnxP{position:absolute;border-radius:50%;opacity:0}'
      + '.tnxPs{bottom:6px;background:var(--pc);box-shadow:0 0 7px var(--pc),0 0 12px var(--pc);animation:tnxSpark linear infinite}'
      + '.tnxPg{bottom:6px;background:#ffe9a3;box-shadow:0 0 7px #ffd874,0 0 12px #ffcf5c;animation:tnxGold linear infinite}'
      + '.tnxStar{background:#fff;box-shadow:0 0 6px #fff;animation:tnxStars ease-in-out infinite}'
      + '.tnxRing{position:absolute;inset:0;border:1px solid var(--c);border-radius:inherit;z-index:1;pointer-events:none;animation:tnxRings 5s ease-out infinite}'
      + '.tnxRing2{animation-delay:-2.5s}'
      + '.tnxSweep{position:absolute;top:0;left:-60%;width:45%;height:100%;pointer-events:none}'
      + '.tnfx-sweep .tnxSweep{background:linear-gradient(105deg,transparent,rgba(255,255,255,.28),transparent);animation:tnxSw 6s ease-in-out infinite}'
      // 傳說：金屬卡面＋金色掃光＋旋轉金屬框
      + '.tnx9 .tnxSurface{background:linear-gradient(125deg,#191b20,#2c2817,#1a1c22)}'
      + '.tnfx-metal .tnxSweep{background:linear-gradient(110deg,transparent 40%,rgba(255,233,163,.14) 47%,rgba(255,249,207,.33) 50%,rgba(255,233,163,.14) 53%,transparent 60%);width:100%;left:0;animation:tnxMsweep 6s linear infinite}'
      + '.tnx9 .tnxFrame{background:conic-gradient(from var(--tnang),#8f6719,#f9d773,#fff5cf,#bc8c30,#8f6719);animation:tnxRot 6s linear infinite}'
      // 神話：星雲卡面＋旋轉彩虹框
      + '.tnx10 .tnxSurface{background:radial-gradient(ellipse at 75% 60%,#393056,#172731 55%,#191f2c)}'
      + '.tnx10 .tnxFrame{background:conic-gradient(from var(--tnang),#fb71a2,#ffc35e,#7df4b0,#72dce8,#8d83ff,#e07eff,#fb71a2);animation:tnxRot 8s linear infinite}'
      // 史詩：外光呼吸
      + '.tnfx-breathe{animation:tnxBreath 4s ease-in-out infinite}'
      // keyframes
      + '@keyframes tnxRot{to{--tnang:360deg}}'
      + '@keyframes tnxBreath{50%{box-shadow:0 0 calc(var(--g) * 1.45) var(--gcb)}}'
      + '@keyframes tnxRings{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.04,1.14);opacity:0}}'
      + '@keyframes tnxSw{0%{left:-60%}55%,100%{left:130%}}'
      + '@keyframes tnxMsweep{0%{transform:translateX(-45%)}100%{transform:translateX(45%)}}'
      + '@keyframes tnxSpark{0%{transform:translateY(4px) scale(.7);opacity:0}25%{opacity:.9}100%{transform:translateY(-32px) scale(.2);opacity:0}}'
      + '@keyframes tnxGold{0%{transform:translateY(0);opacity:0}30%{opacity:.85}100%{transform:translateY(-70px);opacity:0}}'
      + '@keyframes tnxStars{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:.9;transform:scale(1)}}'
      + '@keyframes tnxRainbow{50%{background-position:100% 0}}'
      // 個人偏好：全關 / 離畫面暫停 / 單卡靜態
      + '.tnAnimOff .tnfxw,.tnAnimOff .tnfxw *{animation:none!important}'
      + '.tnfxStatic,.tnfxStatic *{animation:none!important}'
      + '.tnAnimPause.tnfxw,.tnAnimPause.tnfxw *{animation-play-state:paused!important}'
      // 跟隨系統減少動態：僅使用者「自己打開」followReduce 時才掛 .tnFollowReduce（預設不掛）
      + '@media (prefers-reduced-motion:reduce){.tnFollowReduce .tnfxw,.tnFollowReduce .tnfxw *{animation:none!important}.tnFollowReduce .tnxParts,.tnFollowReduce .tnxRing{display:none}}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  root.TIER_EFFECTS = {
    LV: LV, rgba: rgba, cardWrap: cardWrap, badgeStyle: badgeStyle, injectCss: injectCss,
    colorOf: function (level) { return LV[CLV(level)].c; },
    // 相容舊 API（FX 編輯器等呼叫不炸）
    layer: { badge: function (mod, ctx) { return badgeStyle((ctx && ctx.level) || 0, ctx && ctx.color); } },
    DEFAULTS: {}, TRACKS: [], modsForLevel: function () { return {}; },
    base: function (level) { var d = LV[CLV(level)]; return { bw: d.bw, bs: d.fs, gs: d.g, color: d.c, gray: CLV(level) === 0 }; },
    version: '2.0'
  };
})(typeof window !== 'undefined' ? window : this);
