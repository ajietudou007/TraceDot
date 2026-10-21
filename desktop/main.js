const { app, BrowserWindow, shell, Menu, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

/* 手动下载统一走官网下载区：那里的包由 Cloudflare R2 加速，比 GitHub Releases 快得多。
   GitHub 发布页仍从「项目主页」进入，用于查历史版本。 */
const RELEASES_URL = 'https://jidiandian.top/#download';
const APP_VERSION = '5.1.3';
let win = null;

/* ---------- 壳与网页分离 ----------
   壳只负责窗口；应用本体是一份 HTML，放在用户可写目录里。
   内容更新时只要替换这份 HTML，不必重新打包 dmg/exe。
   Electron 中 file:// 的 origin 与具体路径无关，所以从 asar 内迁到用户目录后，
   IndexedDB / localStorage 里的票根数据仍然连续。 */
const PAGE_MANIFEST = 'https://jidiandian.top/release/latest.json';
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

/* 逐段比较版本号，返回 1 / 0 / -1 */
function cmpVer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
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

function fetchText(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'TraceDot-Desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(fetchText(res.headers.location, timeout));
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

function downloadTo(url, dest, timeout, redirects) {
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
        file.close(() => fs.unlink(part, () => {}));
        settled = true;
        resolve(downloadTo(res.headers.location, dest, timeout, (redirects || 0) + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error('HTTP ' + res.statusCode));
        return;
      }
      res.on('data', (chunk) => {
        size += chunk.length;
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

  fetchText(PAGE_MANIFEST)
    .then((body) => {
      let manifest;
      try {
        manifest = JSON.parse(body);
      } catch (e) {
        throw new Error('更新清单格式错误');
      }
      const remote = String(manifest.version || '').trim();
      const local = readPageVersion();
      if (!remote) throw new Error('更新清单缺少版本号');
      if (cmpVer(remote, local) <= 0) {
        if (interactive) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: '迹点点 TraceDot',
            message: '应用内容已是最新版本。'
          });
        }
        return null;
      }

      const url = manifest.url || 'https://jidiandian.top/release/' + manifest.file;
      return downloadTo(url, pagePath() + '.next').then(() => {
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
            title: '内容已更新',
            message: `新内容 V${remote} 已就绪，重启后生效。`,
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

  autoUpdater.autoDownload = false; // 先询问用户再下载
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
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

  autoUpdater.on('update-available', (info) => {
    pendingDownload = true;
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
