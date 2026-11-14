/* 迹点点官网 · 交互脚本
   - 轨道舞台：鼠标轻微视差（rAF 节流，只写 CSS 变量，不触发重排）
   - 导航滚动态、移动端菜单
   - 进场动画（IntersectionObserver，无脚本时内容直接可见）
   - 更新日志：阶段筛选 / 展开收起
*/
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 导航 */
  var nav = document.getElementById('siteNav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('is-stuck', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var burger = document.getElementById('burger');
  var menu = document.getElementById('mobileMenu');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        menu.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* 轨道视差 */
  var tilt = document.getElementById('orbitTilt');
  if (tilt && !reduce && window.matchMedia('(pointer:fine)').matches) {
    var raf = 0, tx = 0, ty = 0;
    var frame = function () {
      raf = 0;
      tilt.style.setProperty('--mx', tx.toFixed(3));
      tilt.style.setProperty('--my', ty.toFixed(3));
    };
    window.addEventListener('pointermove', function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(frame);
    }, { passive: true });
  }

  /* 进场动画 */
  var items = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  /* 桌面端 GitHub 包：按 mirrors.json 优先级择优加速，失败回落直连 */
  var ghLinks = [].slice.call(document.querySelectorAll('a.js-gh-dl'));
  if (ghLinks.length) {
    var KEY = 'jdd-gh-line.v1';
    var TTL = 24 * 3600 * 1000;
    var BUILTIN = ['https://ghproxy.net/', 'https://gh-proxy.com/', 'https://ghfast.top/'];
    var hint = document.getElementById('dlLineHint');

    ghLinks.forEach(function (a) { a.setAttribute('data-gh', a.href); });

    var applyLine = function (prefix) {
      ghLinks.forEach(function (a) {
        a.href = prefix ? prefix + a.getAttribute('data-gh') : a.getAttribute('data-gh');
      });
      if (hint) {
        var host = prefix;
        try { host = new URL(prefix).host; } catch (e) {}
        hint.textContent = prefix ? '下载加速线路：' + host : '下载线路：GitHub 直连';
      }
    };

    var probe = function (prefix) {
      var target = ghLinks[0].getAttribute('data-gh');
      var url = prefix + target.slice(0, target.lastIndexOf('/') + 1) + 'latest.yml';
      var attempt = function (mode) {
        return new Promise(function (resolve, reject) {
          var ctl = typeof AbortController === 'function' ? new AbortController() : null;
          var timer = setTimeout(function () {
            if (ctl) { try { ctl.abort(); } catch (e) {} }
            reject(new Error('timeout'));
          }, 6000);
          fetch(url, { mode: mode, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
            .then(function (res) {
              clearTimeout(timer);
              try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
              if (res.type === 'opaque') return resolve(true);
              if (res.status === 429 || res.status >= 500) return reject(new Error('status'));
              resolve(true);
            })
            .catch(function (err) { clearTimeout(timer); reject(err); });
        });
      };
      return attempt('cors').catch(function () { return attempt('no-cors'); })
        .then(function () { return prefix; }).catch(function () { return null; });
    };

    var cachedLine = '';
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || '0');
      if (saved && saved.prefix && Date.now() - saved.ts < TTL) cachedLine = saved.prefix;
    } catch (e) {}
    if (cachedLine) applyLine(cachedLine);

    fetch('mirrors.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var list = (j && Array.isArray(j.proxies) ? j.proxies : []).filter(function (p) {
          return typeof p === 'string' && /^https?:\/\//i.test(p);
        });
        return list.length ? list : BUILTIN;
      })
      .catch(function () { return BUILTIN; })
      .then(function (list) {
        if (cachedLine && list.indexOf(cachedLine) !== -1) return;
        Promise.all(list.map(probe)).then(function (rs) {
          var best = rs.filter(Boolean)[0] || '';
          applyLine(best);
          try { localStorage.setItem(KEY, JSON.stringify({ prefix: best, ts: Date.now() })); } catch (e) {}
        });
      });
  }

  /* 更新日志 */
  var entries = [].slice.call(document.querySelectorAll('.cl-entry'));
  if (entries.length && document.getElementById('clStream')) {
    var stage = 'all';
    var stages = [].slice.call(document.querySelectorAll('.cl-stage'));
    var chips = [].slice.call(document.querySelectorAll('.cl-chip'));

    var counter = function (key) {
      return entries.filter(function (e) { return key === 'all' || e.dataset.stage === key; }).length;
    };
    chips.forEach(function (c) {
      var b = c.querySelector('b');
      if (b) b.textContent = counter(c.dataset.stage);
    });

    var apply = function () {
      entries.forEach(function (e) { e.hidden = stage !== 'all' && e.dataset.stage !== stage; });
      stages.forEach(function (s) {
        s.hidden = !entries.some(function (e) {
          return e.dataset.stage === s.dataset.stage && !e.hidden;
        });
      });
    };
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        stage = c.dataset.stage;
        chips.forEach(function (x) { x.classList.toggle('on', x === c); });
        apply();
      });
    });

    var expand = document.getElementById('clExpand');
    var collapse = document.getElementById('clCollapse');
    if (expand) expand.addEventListener('click', function () {
      [].slice.call(document.querySelectorAll('.cl-entry details')).forEach(function (d) { d.open = true; });
    });
    if (collapse) collapse.addEventListener('click', function () {
      [].slice.call(document.querySelectorAll('.cl-entry details')).forEach(function (d) { d.open = false; });
    });
  }
})();
