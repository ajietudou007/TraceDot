const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');

const RELEASES_URL = 'https://github.com/ajietudou007/TraceDot/releases';
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '迹点点 TraceDot',
    backgroundColor: '#fbfbfd',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // 外部链接用系统浏览器打开，不在应用内导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- 更新渠道（electron-updater + GitHub Releases） ----------
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
    // 未签名 Mac 包无法自动增量更新：降级为打开发布页手动下载
    const msg = String(err && err.message ? err.message : err);
    if (updaterReady && pendingDownload) {
      pendingDownload = false;
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: '迹点点 TraceDot',
          message: '自动更新不可用，是否打开发布页面手动下载新版本？',
          buttons: ['打开发布页', '稍后'],
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
        buttons: ['立即下载', '稍后提醒', '打开发布页']
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
          message: '无法连接更新服务器，是否打开发布页手动查看？',
          buttons: ['打开发布页', '稍后']
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
    { label: '发布页（手动下载）', click: () => shell.openExternal(RELEASES_URL) }
  ];
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  setupUpdater();
  // 启动后静默检查一次（仅打包环境）
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(false), 3000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
