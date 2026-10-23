/* 迹点点 TraceDot · 官网交互层
   只负责：移动菜单开合、滚动导航高亮、下载加速线路择优。
   液态玻璃本体在 glass.css，本文件不触碰任何视觉令牌。 */
(function () {
  'use strict';

  /* ── 1. 移动端菜单 ─────────────────────────────────────────────── */
  var burger = document.getElementById('burger');
  var menu = document.getElementById('mobileMenu');

  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('open');
    if (burger) burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mm-open');
  }

  if (burger && menu) {
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('mm-open', open);
    });
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeMenu();
    });
    document.addEventListener('click', function (e) {
      if (menu.classList.contains('open') && !menu.contains(e.target)) closeMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 992) closeMenu();
    });
  }

  /* ── 2. 滚动导航高亮（IntersectionObserver，无滚动监听抖动） ───── */
  var navLinks = [].slice.call(document.querySelectorAll('#navLinks a'));
  if (navLinks.length && 'IntersectionObserver' in window) {
    var byId = {};
    navLinks.forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) === '#') byId[href.slice(1)] = a;
    });

    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var hit = null;
      Object.keys(visible).forEach(function (id) {
        if (visible[id] && byId[id] && !hit) hit = byId[id];
      });
      if (!hit) return;
      navLinks.forEach(function (a) { a.classList.toggle('on', a === hit); });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  /* ── 3. 下载加速线路自动择优（仅 macOS 两个包） ──────────────────
     href 里始终写 GitHub 原始地址（JS 被禁也能用），页面加载后按
     mirrors.json 的优先级探测，命中第一条可用线路就改写 href。
     选中结果缓存 24 小时；全部不可用时回落 GitHub 直连，不阻断下载。 */
  var nodes = [].slice.call(document.querySelectorAll('a.js-gh-dl'));
  if (nodes.length) {
    var KEY = 'jdd-gh-line.v1';
    var TTL = 24 * 3600 * 1000;
    var PROBE_TIMEOUT = 6000;
    var BUILTIN = ['https://ghproxy.net/', 'https://gh-proxy.com/', 'https://ghfast.top/'];
    var hint = document.getElementById('dlLineHint');

    nodes.forEach(function (a) { a.setAttribute('data-gh', a.href); });

    function label(prefix) {
      try { return new URL(prefix).host; } catch (e) { return prefix; }
    }

    function apply(prefix) {
      nodes.forEach(function (a) {
        a.href = prefix ? prefix + a.getAttribute('data-gh') : a.getAttribute('data-gh');
      });
      if (hint) hint.textContent = prefix ? '（当前线路：' + label(prefix) + '）' : '（当前线路：GitHub 直连）';
      window.jddDownloadLine = prefix || '';
    }

    /* 探测目标用同一次发布里的 latest.yml（几百字节），
       404 也证明线路是通的 */
    function testUrl(prefix) {
      var u = nodes[0].getAttribute('data-gh');
      return prefix + u.slice(0, u.lastIndexOf('/') + 1) + 'latest.yml';
    }

    function once(url, mode) {
      return new Promise(function (resolve, reject) {
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () {
          if (ctl) { try { ctl.abort(); } catch (e) {} }
          reject(new Error('timeout'));
        }, PROBE_TIMEOUT);
        fetch(url, { mode: mode, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
          .then(function (res) {
            clearTimeout(timer);
            try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) {}
            if (res.type === 'opaque') return resolve('weak');
            if (res.status === 429 || res.status >= 500) return reject(new Error('status ' + res.status));
            resolve('ok');
          })
          .catch(function (err) { clearTimeout(timer); reject(err); });
      });
    }

    function probe(prefix) {
      var url = testUrl(prefix);
      return once(url, 'cors')
        .catch(function () { return once(url, 'no-cors'); })
        .then(function (level) { return { prefix: prefix, level: level }; })
        .catch(function () { return null; });
    }

    function cached() {
      try {
        var c = JSON.parse(localStorage.getItem(KEY) || '0');
        if (c && c.prefix && Date.now() - c.ts < TTL) return c.prefix;
      } catch (e) {}
      return '';
    }

    function remember(prefix) {
      try { localStorage.setItem(KEY, JSON.stringify({ prefix: prefix, ts: Date.now() })); } catch (e) {}
    }

    function loadList() {
      return fetch('mirrors.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var list = (j && Array.isArray(j.proxies) ? j.proxies : []).filter(function (p) {
            return typeof p === 'string' && /^https?:\/\//i.test(p);
          });
          return list.length ? list : BUILTIN;
        })
        .catch(function () { return BUILTIN; });
    }

    var hit = cached();
    if (hit) apply(hit);

    loadList().then(function (list) {
      if (hit && list.indexOf(hit) !== -1) return;
      Promise.all(list.map(probe)).then(function (rs) {
        var good = rs.filter(Boolean);
        var best = good[0];
        apply(best ? best.prefix : '');
        remember(best ? best.prefix : '');
      });
    });
  }
})();
