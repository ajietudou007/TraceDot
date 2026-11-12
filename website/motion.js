/* 迹点点 TraceDot · 官网动效与阅读层
   ---------------------------------------------------------------------------
   职责（与 glass.js 完全隔离，玻璃本体不动）：
     1. 鼠标追踪：全页光标光池 + 极光微视差 + 首屏展台 3D 旋转 + 卡片 tilt/glare
     2. 滚动显现：IntersectionObserver，无 JS / 打印 / 减少动态时内容始终可见
     3. 更新日志密度：默认只展开最近 2 个版本的明细，长文折叠但一字不删
   参考：hyphentech.top 的 .tilt/.glare 与 hero --rx/--ry 交互模型。
   所有光色沿用既有品牌黄 #F3EB30 的低透明度，不引入新色相。 */
(function () {
  'use strict';

  var mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = mqFine.matches;
  var reduce = mqReduce.matches;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function byClass(name) { return document.querySelector('.' + name); }

  /* ── 1. 全局光标光池 + 极光视差 + 首屏展台旋转 ─────────────────── */
  var pool = document.createElement('div');
  pool.id = 'fx-cursor';
  pool.setAttribute('aria-hidden', 'true');
  document.body.appendChild(pool);
  document.body.classList.add('fx-ready');

  if (fine && !reduce) {
    var aurora = byClass('aurora');
    var stage = document.querySelector('.hero-stage .glass-card.stage');
    var heroBox = byClass('hero-grid') || document.querySelector('.cl-hero');
    var mx = window.innerWidth / 2;
    var my = window.innerHeight / 2;
    var queued = false;

    function frame() {
      queued = false;
      pool.style.setProperty('--fx-cx', mx + 'px');
      pool.style.setProperty('--fx-cy', my + 'px');

      if (aurora) {
        var ax = (mx / window.innerWidth - .5) * 26;
        var ay = (my / window.innerHeight - .5) * 26;
        aurora.style.setProperty('--fx-ax', ax.toFixed(1) + 'px');
        aurora.style.setProperty('--fx-ay', ay.toFixed(1) + 'px');
      }

      if (stage && heroBox) {
        var r = heroBox.getBoundingClientRect();
        if (r.width && r.height) {
          var nx = clamp01((mx - r.left) / r.width);
          var ny = clamp01((my - r.top) / r.height);
          /* 与参考站同款角度区间：ry -12°~+4°，rx -4°~+8°，跟随但不晃眼 */
          stage.style.setProperty('--fx-ry', (-12 + 16 * nx).toFixed(2) + 'deg');
          stage.style.setProperty('--fx-rx', (8 - 12 * ny).toFixed(2) + 'deg');
        }
      }
    }

    var firstMove = true;
    document.addEventListener('pointermove', function (e) {
      mx = e.clientX; my = e.clientY;
      /* 第一次直接执行：rAF 在后台标签页 / 无帧渲染环境里可能迟迟不来，
         光池会一直停在默认位置。之后仍按帧节流。 */
      if (firstMove) { firstMove = false; frame(); return; }
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }, { passive: true });
  }

  /* ── 2. 卡片 3D 倾斜 + 光标跟随光斑 ───────────────────────────────
     光斑是真 DOM 节点（不碰 .glass-card::before / ::after），
     且只挂在内容型小卡上：大面板不位移，避免整页跳动。 */
  var tiltSel = '.mod, .mini, .metric, .cl-hl, .dl-card, .stack-item';
  var cards = [].slice.call(document.querySelectorAll(tiltSel));
  cards.forEach(function (el) {
    var glare = document.createElement('span');
    glare.className = 'fx-glare';
    glare.setAttribute('aria-hidden', 'true');
    el.insertBefore(glare, el.firstChild);
    el.classList.add('fx-tilt');

    if (!fine || reduce) return;
    el.addEventListener('pointerenter', function () {
      el.classList.add('fx-active');
      /* 直接置位，不只依赖 :hover / class 选择器：
         合成事件、触摸笔、嵌入预览里 hover 状态未必成立 */
      glare.style.opacity = '1';
    });
    el.addEventListener('pointerleave', function () {
      el.classList.remove('fx-active');
      glare.style.opacity = '';
      el.style.transform = '';
    });
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var px = (e.clientX - r.left) / r.width - .5;
      var py = (e.clientY - r.top) / r.height - .5;
      el.style.transform = 'perspective(900px) rotateY(' + (8 * px).toFixed(2) +
        'deg) rotateX(' + (-6 * py).toFixed(2) + 'deg) translateY(-3px)';
      el.style.setProperty('--gx', ((px + .5) * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', ((py + .5) * 100).toFixed(1) + '%');
    }, { passive: true });
  });

  /* ── 3. 滚动显现 ───────────────────────────────────────────────────
     data-* 只在观测器就绪后写入 → JS 失效时页面照常显示。 */
  if (!reduce && 'IntersectionObserver' in window) {
    var sel = [
      '.hero-copy', '.hero-stage',
      '.sec-center', '.sec-head', '.glass-card.pad',
      '.grid-4 > .mod', '.grid-2 > *',
      '.cl-hero > *', '.cl-bar', '.cl-stage', '.cl-entry',
      '.foot > *'
    ].join(',');
    var nodes = [].slice.call(document.querySelectorAll(sel));
    var marked = [];

    nodes.forEach(function (el) {
      /* 父级已负责入场时，子元素不重复套一层动画 */
      if (el.parentElement && el.parentElement.closest('[data-fx-reveal]')) return;
      el.setAttribute('data-fx-reveal', '');
      var p = el.parentElement;
      if (p && p.matches('.grid-4, .grid-2, .metrics-cards, .cl-stats, .grid-3')) {
        var i = [].slice.call(p.children).indexOf(el);
        el.style.setProperty('--fx-delay', Math.min(i % 4, 3) * 70 + 'ms');
      }
      marked.push(el);
    });

    var pending = marked.slice();
    function reveal(el) {
      el.classList.add('is-in');
      var i = pending.indexOf(el);
      if (i >= 0) pending.splice(i, 1);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        /* 已经在视口上方（锚点直达）的元素也要立即可见 */
        if (en.isIntersecting || en.boundingClientRect.top < 0) {
          reveal(en.target);
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: .06 });

    marked.forEach(function (el) { io.observe(el); });

    /* 确定性兜底：IO 的首次回调可能早于最终布局（无头渲染、锚点直达、
       字体异步加载后的重排），此时视口会被算成 0 高，元素永远停在 opacity:0。
       用 getBoundingClientRect 再扫一遍，保证「看得见的一定显示」。 */
    function sweep() {
      if (!pending.length) return;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      pending.slice().forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh * .94 && r.bottom > -40) reveal(el);
      });
    }
    var sweepQueued = false;
    window.addEventListener('scroll', function () {
      if (sweepQueued) return;
      sweepQueued = true;
      requestAnimationFrame(function () { sweepQueued = false; sweep(); });
    }, { passive: true });
    window.addEventListener('resize', sweep, { passive: true });
    window.addEventListener('load', sweep);
    setTimeout(sweep, 120);
    setTimeout(sweep, 600);
  }

  /* ── 4. 更新日志：默认收起较早版本的明细 ───────────────────────────
     只改 open 状态，不删任何一句；「展开全部明细」按钮仍可一键全开。 */
  var details = [].slice.call(document.querySelectorAll('.cl-entry details.cl-more'));
  if (details.length > 2) {
    for (var i = 2; i < details.length; i++) details[i].open = false;

    if (location.hash) {
      var target = document.querySelector(location.hash);
      if (target && target.classList && target.classList.contains('cl-entry')) {
        var d = target.querySelector('details.cl-more');
        if (d) d.open = true;
      }
    }

    var tools = document.getElementById('clTools') || document.querySelector('.cl-tools');
    if (tools && !document.querySelector('.fx-hint')) {
      var hint = document.createElement('span');
      hint.className = 'fx-hint';
      hint.textContent = '默认展开最近 2 个版本';
      tools.appendChild(hint);
    }
  }
})();
