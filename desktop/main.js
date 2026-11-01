const { app, BrowserWindow, shell, Menu, dialog, screen, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

/* 手动下载统一走官网下载区：Windows 安装包与单文件网页版已切 Gitee 国内线路直发，
   macOS 两个包仍走 GitHub（页面自动择优公益加速线路）。
   GitHub 发布页仍从「项目主页」进入，用于查历史版本。 */
const RELEASES_URL = 'https://jidiandian.top/#download';
const APP_VERSION = '5.4.0-Preview';
let win = null;

/* ---------- 壳与网页分离 ----------
   壳只负责窗口；应用本体是一份 HTML，放在用户可写目录里。
   内容更新时只要替换这份 HTML，不必重新打包 dmg/exe。
   Electron 中 file:// 的 origin 与具体路径无关，所以从 asar 内迁到用户目录后，
   IndexedDB / localStorage 里的票根数据仍然连续。 */
/* 内容热更新清单走 Gitee：raw.giteeusercontent.com 是版本无关地址（跟 main 分支走），
   改仓库里的 release/latest.json 并推送，两端（GitHub/Gitee）同步后即全量生效。
   小文件（清单几百字节）走 raw 直连；12 MB 的应用本体过不了 Gitee raw 的
   「large file require login」限制，由清单里的 url 指向 Gitee Release 资产分发。 */
const PAGE_MANIFEST = 'https://raw.giteeusercontent.com/ajiepotato/TraceDot/raw/main/release/latest.json';
/* 内测页面清单：拿到内测权限的用户走这条；拉不到时自动回退正式清单 */
const PAGE_MANIFEST_BETA = 'https://raw.giteeusercontent.com/ajiepotato/TraceDot/raw/main/release/latest-beta.json';
const PAGE_MAX_BYTES = 128 * 1024 * 1024;
const PAGE_MIN_BYTES = 1024 * 1024;

function pageDir() {
  return path.join(app.getPath('userData'), 'page');
}
function pagePath() {
  return path.join(pageDir(), 'index.html');
}
function pageVerPath() {
  return path.join(pageDir(), 'version.txt');
}
function seedPath(name) {
  return path.join(__dirname, 'app', name);
}

function readFileTrim(p) {
  try {
    return String(fs.readFileSync(p, 'utf8')).trim();
  } catch (e) {
    return '';
  }
}

function readPageVersion() {
  return readFileTrim(pageVerPath());
}

function writePageVersion(v) {
  try {
    fs.writeFileSync(pageVerPath(), String(v));
  } catch (e) {
    console.warn('write page version failed:', e && e.message);
  }
}

/* ---------- 内测通道 ----------
   网页里登录并拿到内测权限后会调用 window.jddDesktop.setChannel('beta')，
   壳只落一个标记文件；页面清单据此在内测 / 正式之间切换。
   权限撤销时网页写回 'stable'，即回到正式页面。 */
const BETA_CHANNEL_VALUES = ['beta', 'stable'];

function betaChannelPath() {
  return path.join(app.getPath('userData'), 'beta-channel.txt');
}

function isBetaChannel() {
  return readFileTrim(betaChannelPath()) === 'beta';
}

function writeBetaChannel(ch) {
  const v = String(ch || '').trim();
  if (BETA_CHANNEL_VALUES.indexOf(v) < 0) {
    console.warn('ignore invalid beta channel:', ch);
    return;
  }
  try {
    fs.writeFileSync(betaChannelPath(), v);
  } catch (e) {
    console.warn('write beta channel failed:', e && e.message);
  }
}

/* 按通道取页面清单：内测通道先拉 BETA 清单，拉不到（404 / 网络故障）
   就回退正式清单 —— 回退不算失败，不能因此挡住内容更新。 */
function fetchPageManifest() {
  const beta = isBetaChannel();
  return fetchText(beta ? PAGE_MANIFEST_BETA : PAGE_MANIFEST)
    .then((body) => ({ body: body, beta: beta }))
    .catch((err) => {
      if (!beta) throw err;
      console.warn('beta manifest unavailable, fallback to stable:', err && err.message);
      return fetchText(PAGE_MANIFEST).then((body) => ({ body: body, beta: false }));
    });
}

/* 把版本号拆成「数字段 + 后缀」：5.4.0-Preview → { nums:'5.4.0', tag:'preview' } */
function splitVer(v) {
  const s = String(v || '').trim();
  const m = /^([0-9.]*)(.*)$/.exec(s);
  const nums = (m && m[1] ? m[1] : '').replace(/\.+$/, '');
  const tag = (m && m[2] ? m[2] : '').trim().replace(/^[-_.\s]+/, '').toLowerCase();
  return { nums: nums, tag: tag };
}

/* 逐段比较版本号，返回 1 / 0 / -1。
   数字段相同时，带后缀的版本（如 5.4.0-Preview）视为比同号正式版更新 ——
   内测内容就是「同号的 Preview」，不带这条规则永远检测不到内测更新。 */
function cmpVer(a, b) {
  const va = splitVer(a);
  const vb = splitVer(b);
  const pa = (va.nums || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (vb.nums || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (va.tag && !vb.tag) return 1;
  if (!va.tag && vb.tag) return -1;
  if (va.tag !== vb.tag) return va.tag > vb.tag ? 1 : -1;
  return 0;
}

/* 旧内容页迁移（V5.4.1 起）：10/29 那批 V5.4.0 页面没有 window.jddDesktop 通道桥，
   版本号又比壳自带种子高，导致内测通道永远打不开。首次启动检测一次，缺桥就用种子重铺。 */
function pageBridgeMarkPath() {
  return path.join(pageDir(), 'desktop-bridge.txt');
}

function pageHasDesktopBridge() {
  if (fs.existsSync(pageBridgeMarkPath())) return true;
  let text = '';
  try {
    text = fs.readFileSync(pagePath(), 'utf8');
  } catch (e) {
    return false;
  }
  if (text.indexOf('jddDesktop') < 0) return false;
  try {
    fs.writeFileSync(pageBridgeMarkPath(), 'ok');
  } catch (e) {
    /* 标记写失败不影响本轮判断 */
  }
  return true;
}

/* 首次启动、或壳自带的内容比本地新时，把内置种子铺到用户目录 */
function ensurePage() {
  fs.mkdirSync(pageDir(), { recursive: true });

  const seedHtml = seedPath('index.html');
  const seedVer = readFileTrim(seedPath('version.txt'));
  const localVer = readPageVersion();

  let localSize = 0;
  try {
    localSize = fs.statSync(pagePath()).size;
  } catch (e) {
    localSize = 0;
  }

  // 本地缺失/损坏：铺种子
  if (localSize < PAGE_MIN_BYTES) {
    fs.copyFileSync(seedHtml, pagePath());
    writePageVersion(seedVer || app.getVersion());
    return;
  }

  /* 旧页没有桌面通道桥：版本号可能比种子高，但功能比种子旧，
     内测通道也打不开，这里强制用种子重铺一次（迁移标记只触发一次）。 */
  if (!pageHasDesktopBridge()) {
    fs.copyFileSync(seedHtml, pagePath());
    writePageVersion(seedVer || app.getVersion());
    return;
  }

  // 壳升级后自带更新的内容：直接覆盖（仅当种子确实更新，避免回退热更新的内容）
  if (seedVer && cmpVer(seedVer, localVer) > 0) {
    fs.copyFileSync(seedHtml, pagePath());
    writePageVersion(seedVer);
  }
}

function loadApp() {
  try {
    ensurePage();
    win.loadFile(pagePath());
  } catch (e) {
    console.warn('page seed failed, fallback to built-in:', e && e.message);
    win.loadFile(seedPath('index.html'));
  }
}

/* 把重定向的 Location 补全成绝对地址。
   HTTP 允许 Location 是相对路径（'/x/y' 或 '../p'），而 https.get 只接受绝对 URL，
   直接传会抛 Invalid URL —— 用 URL 构造器以原请求地址为基准补全。 */
function resolveLocation(base, loc) {
  try {
    return new URL(String(loc), base).toString();
  } catch (e) {
    return String(loc);
  }
}

function fetchText(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TraceDot-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        /* Location 可能是相对路径（如只给「/release/latest.json」），
           直接拿去做 https.get 会抛 Invalid URL —— 用 URL 构造器按原地址补全 */
        resolve(fetchText(resolveLocation(url, res.headers.location), timeout));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        if (body.length > 65536) req.destroy(new Error('清单异常'));
      });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout || 15000, () => req.destroy(new Error('请求超时')));
  });
}

/* ---------- 下载进度窗（V5.1.5） ----------
   壳与网页分离后，内容更新只下载一个约 12 MB 的 HTML，原来从「点确定」到「重启生效」
   中间完全没有任何反馈，网络慢时用户会以为程序卡死。这里给一个无边框小窗：
   进度条 + 百分比 + 已下载 / 总大小，同时把进度同步到任务栏（Windows）/ Dock（macOS）。
   窗口用 data: URL 装一张静态 DOM，后续只改 #f 的 width 与 #s 的文本，不加载任何外部资源。 */
let progWin = null;
let progState = { pct: 0, text: '准备中', title: '正在下载…' };

const PROG_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'html,body{margin:0;height:100%;overflow:hidden}',
  'body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;',
  '  background:#fff;box-sizing:border-box;padding:20px 22px;color:#1f2937;',
  '  -webkit-app-region:drag;cursor:default;user-select:none}',
  '.t{font-size:13px;font-weight:600;letter-spacing:.01em}',
  '.s{margin-top:6px;font-size:11px;color:#8b95a1;font-variant-numeric:tabular-nums}',
  '.bar{margin-top:13px;height:6px;border-radius:3px;background:#eef1ef;overflow:hidden}',
  '.f{height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,#2F9E62,#57C68C);',
  '  transition:width .18s ease-out}',
  '</style></head><body>',
  '<div class="t" id="t"></div><div class="s" id="s"></div>',
  '<div class="bar"><div class="f" id="f"></div></div>',
  '</body></html>'
].join('');

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/* 把当前状态刷进进度窗。页面还没加载完时 executeJavaScript 会 reject，
   直接吞掉即可 —— did-finish-load 里会补一次全量刷新。 */
function progFlush() {
  if (!progWin || progWin.isDestroyed()) return;
  const js =
    '(function(){var t=document.getElementById("t"),s=document.getElementById("s"),f=document.getElementById("f");' +
    'if(t)t.textContent=' + JSON.stringify(progState.title) + ';' +
    'if(s)s.textContent=' + JSON.stringify(progState.text) + ';' +
    'if(f)f.style.width="' + Math.max(0, Math.min(100, progState.pct)).toFixed(1) + '%";' +
    'return 1})()';
  progWin.webContents.executeJavaScript(js).catch(() => {});
}

function progOpen(title) {
  progState = { pct: 0, text: '正在连接…', title: title || '正在下载…' };
  if (progWin && !progWin.isDestroyed()) {
    progFlush();
    return;
  }
  progWin = new BrowserWindow({
    width: 400,
    height: 132,
    parent: win && !win.isDestroyed() ? win : undefined,
    modal: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  progWin.on('closed', () => {
    progWin = null;
  });
  progWin.webContents.on('did-finish-load', progFlush);
  progWin.once('ready-to-show', () => {
    if (progWin && !progWin.isDestroyed()) progWin.show();
  });
  progWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PROG_HTML)).catch(() => {});
}

/* pct 未知（服务器不给 Content-Length）时传 -1，任务栏显示不确定态 */
function progSet(pct, text) {
  progState.pct = Number.isFinite(pct) && pct >= 0 ? pct : 0;
  if (text != null) progState.text = String(text);
  progFlush();
  if (win && !win.isDestroyed()) {
    try {
      win.setProgressBar(Number.isFinite(pct) && pct >= 0 ? Math.min(1, pct / 100) : 2);
    } catch (e) {
      /* 个别平台不支持任务栏进度，忽略 */
    }
  }
}

function progClose() {
  if (progWin && !progWin.isDestroyed()) progWin.destroy();
  progWin = null;
  if (win && !win.isDestroyed()) {
    try {
      win.setProgressBar(-1);
    } catch (e) {
      /* ignore */
    }
  }
}

function downloadTo(url, dest, timeout, redirects, onProgress) {
  if ((redirects || 0) > 5) return Promise.reject(new Error('重定向过多'));
  return new Promise((resolve, reject) => {
    const part = dest + '.part';
    const file = fs.createWriteStream(part);
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      file.close(() => fs.unlink(part, () => {}));
      reject(err);
    };

    const req = https.get(url, { headers: { 'User-Agent': 'TraceDot-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        settled = true;
        const next = resolveLocation(url, res.headers.location);
        /* 必须等旧流彻底关闭、半成品删干净，再跟随重定向去开新流。
           原来这里是 file.close(() => unlink) 之后就立刻递归 —— 旧流的 unlink 回调
           会把新流刚建好的同名 .part 删掉，最终 rename 报 ENOENT。
           （重定向要把 onProgress 一起带过去，否则跟随跳转后进度就断了。） */
        file.destroy();
        file.once('close', () => {
          fs.unlink(part, () => {
            downloadTo(next, dest, timeout, (redirects || 0) + 1, onProgress).then(resolve, reject);
          });
        });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error('HTTP ' + res.statusCode));
        return;
      }
      /* 总大小：优先 Content-Length；服务器不返回时传 0，进度窗会退化成
         「已下载 xx MB」的不确定态，仍然有反馈 */
      const total = parseInt(res.headers['content-length'], 10) || 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (onProgress) {
          try {
            onProgress(size, total);
          } catch (e) {
            /* 进度回调出错不能影响下载本身 */
          }
        }
        if (size > PAGE_MAX_BYTES) {
          req.destroy();
          fail(new Error('内容文件超出大小上限'));
        }
      });
      res.on('error', fail);
      res.pipe(file);
      file.on('finish', () => {
        if (settled) return;
        settled = true;
        file.close(() => {
          if (size < PAGE_MIN_BYTES) {
            fs.unlink(part, () => {});
            reject(new Error('内容文件不完整'));
            return;
          }
          try {
            fs.renameSync(part, dest);
            resolve(dest);
          } catch (e) {
            fs.unlink(part, () => {});
            reject(e);
          }
        });
      });
      file.on('error', fail);
    });
    req.on('error', fail);
    req.setTimeout(timeout || 180000, () => req.destroy(new Error('下载超时')));
  });
}

let contentChecking = false;

/* 检查网页内容更新：只换 HTML，不动壳 */
function checkContent(interactive) {
  if (contentChecking) return;
  contentChecking = true;

  fetchPageManifest()
    .then((src) => {
      let manifest;
      try {
        manifest = JSON.parse(src.body);
      } catch (e) {
        throw new Error('更新清单格式错误');
      }
      const beta = src.beta;
      const remote = String(manifest.version || '').trim();
      const local = readPageVersion();
      if (!remote) throw new Error('更新清单缺少版本号');
      if (cmpVer(remote, local) <= 0) {
        if (interactive) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: beta ? '迹点点 TraceDot（内测版）' : '迹点点 TraceDot',
            message: beta ? '内测版：应用内容已是最新版本。' : '应用内容已是最新版本。'
          });
        }
        return null;
      }

      /* 清单没给 url 时按「版本 tag + 文件名」拼 Gitee Release 资产地址 */
      const url = manifest.url || 'https://gitee.com/ajiepotato/TraceDot/releases/download/v' + remote + '/' + manifest.file;
      /* 内容文件稳定在 12 MB 上下；万一服务器没给 Content-Length，就用它当分母估进度，
         总比让进度条干等着强（估到 95% 封顶，真正的 100% 只在写入完成时给） */
      const EST_BYTES = 12 * 1024 * 1024;
      progOpen((beta ? '正在下载内测版内容' : '正在下载应用内容') + ' V' + remote);
      return downloadTo(url, pagePath() + '.next', 180000, 0, (got, total) => {
        const denom = total > 0 ? total : EST_BYTES;
        const pct = total > 0 ? (got / total) * 100 : Math.min(95, (got / denom) * 100);
        progSet(pct, fmtBytes(got) + (total > 0 ? ' / ' + fmtBytes(total) : '') + ' · ' + pct.toFixed(0) + '%');
      }).then(() => {
        progSet(100, '下载完成，正在写入…');
        progClose();
        try {
          fs.copyFileSync(pagePath(), pagePath() + '.prev');
        } catch (e) {
          /* 保留上一版失败不阻塞更新 */
        }
        fs.renameSync(pagePath() + '.next', pagePath());
        writePageVersion(remote);

        return dialog
          .showMessageBox(win, {
            type: 'info',
            title: beta ? '内测版内容已更新' : '内容已更新',
            message: `新内容 V${remote} 已就绪，重启后生效。${beta ? '（内测版）' : ''}`,
            detail: '壳程序无需重新下载，重启即可。',
            buttons: ['立即重启', '稍后'],
            defaultId: 0
          })
          .then((r) => {
            if (r.response === 0) {
              app.relaunch();
              app.exit(0);
            }
          });
      });
    })
    .catch((err) => {
      progClose();
      console.warn('content update failed:', err && err.message);
      if (interactive) {
        dialog.showMessageBox(win, {
          type: 'warning',
          title: '检查内容更新失败',
          message: String((err && err.message) || err)
        });
      }
    })
    .finally(() => {
      contentChecking = false;
    });
}

/* ---------- 渲染性能：让老显卡也走硬件光栅化 ----------
   ignore-gpu-blocklist：Chromium 会按驱动版本把一批 Intel 核显列入黑名单，
   命中后整窗退回软件合成，滚动与毛玻璃会卡到无法使用；这里强制忽略黑名单。
   enable-gpu-rasterization：2D 光栅化走 GPU，弱核显上收益明显。 */
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

/* ---------- 云端接口跨域（V5.4.0 加云端功能）----------
   应用本体是 file:// 页面，它的 Origin 是字面量 "null"，不在云端服务端的 CORS
   白名单里（安卓 WebView 的 Origin 是 https://localhost，所以安卓端不用管）。
   这里在主进程给云端域名的响应补上 CORS 头，只放行迹点点自己的接口域名。
   备份包下载要读 x-jdd-version / x-jdd-sha256 / x-jdd-records 等自定义响应头，
   必须同时补 Access-Control-Expose-Headers，否则 JS 侧读不到。 */
const CLOUD_API_HOSTS = ['https://api.jidiandian.top'];
const CLOUD_EXPOSE_HEADERS = 'authorization, content-type, x-jdd-version, x-jdd-sha256, x-jdd-records, x-jdd-created-at';

function setupCloudCors() {
  try {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      if (CLOUD_API_HOSTS.some((h) => String(details.url || '').startsWith(h))) {
        headers['access-control-allow-origin'] = ['*'];
        headers['access-control-allow-methods'] = ['GET,POST,PUT,DELETE,OPTIONS'];
        headers['access-control-allow-headers'] = ['*'];
        headers['access-control-expose-headers'] = [CLOUD_EXPOSE_HEADERS];
      }
      callback({ responseHeaders: headers });
    });
  } catch (e) {
    console.warn('cloud cors setup failed:', e && e.message);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    /* 标题跟随网页内容版本，而不是壳版本 */
    title: '迹点点 TraceDot V' + (readPageVersion() || APP_VERSION),
    backgroundColor: '#fbfbfd',
    autoHideMenuBar: true,
    /* 先隐藏、首帧就绪再显示：避免白底闪一下再重绘整窗（老机器上这一步很明显） */
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      /* 12 MB 单文件里有大段内联脚本，缓存编译结果，二次启动更快 */
      v8CacheOptions: 'code'
    }
  });

  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) win.show();
  });

  loadApp();

  /* 把屏幕刷新率交给渲染进程：应用内的帧率/动画时长判定以它为基准，
     否则 30Hz 外接屏会被自己的 33ms 帧长误判。 */
  try {
    const hz = Number(screen.getPrimaryDisplay().displayFrequency) || 60;
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript('window.__JDD_HZ__=' + hz).catch(() => {});
    });
  } catch (e) {
    console.warn('display frequency probe failed:', e && e.message);
  }

  // 外部链接用系统浏览器打开，不在应用内导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- 壳更新渠道（electron-updater + GitHub Releases） ----------
const { autoUpdater } = require('electron-updater');

let updaterReady = false;
let pendingDownload = false;
let pendingCheck = false;

function setupUpdater() {
  // 打包环境才启用；开发模式（electron .）跳过，避免报错
  if (!app.isPackaged) return;

  /* macOS 包未签名（build.mac.identity = null），Squirrel.Mac 换不掉 app bundle：
     自动下载只会「下完装不上」，用户重启还是旧版本、下次启动又弹同一个版本。
     所以 mac 上不走自动下载，发现新版本时直接引导去官网下载页手动安装。 */
  const manualUpdate = process.platform === 'darwin';

  autoUpdater.autoDownload = false; // 先询问用户再下载
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    progClose();
    // 未签名 Mac 包无法自动增量更新：降级为打开下载页手动下载
    const msg = String(err && err.message ? err.message : err);
    if (updaterReady && pendingDownload) {
      pendingDownload = false;
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: '迹点点 TraceDot',
          message: '自动更新不可用，是否打开下载页面手动下载新版本？',
          buttons: ['打开下载页', '稍后'],
          defaultId: 0
        })
        .then((r) => {
          if (r.response === 0) shell.openExternal(RELEASES_URL);
        });
    }
    console.warn('updater error:', msg);
  });

  /* 壳更新（安装包，几十 MB）也复用同一个进度窗与任务栏进度 ——
     原来只在下载完成后才弹一次，中间几分钟同样是空白 */
  autoUpdater.on('download-progress', (p) => {
    const pct = Number(p && p.percent) || 0;
    progSet(
      pct,
      fmtBytes(p && p.transferred) + ' / ' + fmtBytes(p && p.total) + ' · ' + pct.toFixed(0) + '%'
    );
  });

  autoUpdater.on('update-available', (info) => {
    pendingDownload = !manualUpdate;
    if (manualUpdate) {
      dialog
        .showMessageBox(win, {
          type: 'info',
          title: '发现新版本',
          message: `发现新版本 V${info.version}，macOS 需手动安装。`,
          detail:
            '点「打开下载页」获取安装包，下载后把「迹点点」拖进「应用程序」覆盖旧版即可，本机数据不会丢失。',
          buttons: ['打开下载页', '稍后提醒'],
          defaultId: 0,
          cancelId: 1
        })
        .then((r) => {
          if (r.response === 0) shell.openExternal(RELEASES_URL);
        });
      return;
    }
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 V${info.version}，是否立即下载？`,
        detail: '下载完成后将在退出或重启时自动安装。',
        buttons: ['立即下载', '稍后提醒', '打开下载页']
      })
      .then((r) => {
        if (r.response === 0) {
          pendingDownload = false;
          progOpen('正在下载新版本 V' + info.version + '…');
          autoUpdater.downloadUpdate();
        } else if (r.response === 2) {
          pendingDownload = false;
          shell.openExternal(RELEASES_URL);
        }
      });
  });

  autoUpdater.on('update-not-available', () => {
    if (pendingCheck) {
      pendingCheck = false;
      dialog.showMessageBox(win, {
        type: 'info',
        title: '迹点点 TraceDot',
        message: '当前已是最新版本。'
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    progClose();
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: '更新已就绪',
        message: `新版本 V${info.version} 已下载，立即重启安装还是稍后自动安装？`,
        buttons: ['立即重启安装', '稍后'],
        defaultId: 0
      })
      .then((r) => {
        if (r.response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
        // 选择“稍后”时，应用下次退出会自动完成安装
      });
  });

  updaterReady = true;
}

function checkForUpdates(interactive) {
  if (!app.isPackaged) {
    if (interactive) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: '迹点点 TraceDot',
        message: '当前为开发模式，更新检查仅在打包后的应用中生效。'
      });
    }
    return;
  }
  if (interactive) pendingCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('check failed:', err && err.message);
    pendingCheck = false;
    if (interactive) {
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: '检查更新失败',
          message: '无法连接更新服务器，是否打开下载页手动查看？',
          buttons: ['打开下载页', '稍后']
        })
        .then((r) => {
          if (r.response === 0) shell.openExternal(RELEASES_URL);
        });
    }
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{ role: 'appMenu', submenu: [{ label: '关于 迹点点', role: 'about' }, { type: 'separator' }, ...appMenuExtra()] }]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: '帮助',
      submenu: [
        ...(!isMac ? appMenuExtra() : []),
        { type: 'separator' },
        { label: '项目主页', click: () => shell.openExternal('https://github.com/ajietudou007/TraceDot') },
        { label: '官方网站', click: () => shell.openExternal('https://jidiandian.top/website/') },
        { role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function appMenuExtra() {
  return [
    { label: '检查更新…', click: () => checkForUpdates(true) },
    { label: '检查内容更新…', click: () => checkContent(true) },
    { label: '官网下载页（手动下载）', click: () => shell.openExternal(RELEASES_URL) }
  ];
}

app.whenReady().then(() => {
  /* 网页侧设置通道：落标记文件；刚切到内测时立刻拉一次内测内容清单，
     用户申请获批后不用再手动点「检查内容更新」。 */
  ipcMain.on('jdd:set-beta-channel', (e, ch) => {
    const wasBeta = isBetaChannel();
    writeBetaChannel(ch);
    if (!wasBeta && isBetaChannel()) setTimeout(() => checkContent(false), 500);
  });
  try {
    setupCloudCors();
  } catch (e) {
    console.warn('cloud cors failed:', e && e.message);
  }
  try {
    ensurePage();
  } catch (e) {
    console.warn('ensure page failed:', e && e.message);
  }
  buildMenu();
  createWindow();
  setupUpdater();
  if (app.isPackaged) {
    // 壳更新先查；内容更新稍后错开，避免同时弹窗
    setTimeout(() => checkForUpdates(false), 3000);
    setTimeout(() => checkContent(false), 9000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
