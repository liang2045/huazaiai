'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');

const APP_NAME = 'Huazai AI';
const LEGACY_USER_DATA_NAME = 'Liang';
const APP_VERSION = '3.2.3';
const BASE_PORT = 18766;

let mainWindow = null;
let backendProcess = null;
let backendPort = BASE_PORT;
let logBuffer = [];

app.setName(APP_NAME);

function configureUserDataPath() {
  if (!app.isPackaged) return;
  const appDataDir = app.getPath('appData');
  const legacyUserDataDir = path.join(appDataDir, LEGACY_USER_DATA_NAME);
  const currentUserDataDir = path.join(appDataDir, APP_NAME);
  app.setPath('userData', fs.existsSync(legacyUserDataDir) ? legacyUserDataDir : currentUserDataDir);
}

function isPackaged() {
  return app.isPackaged;
}

function getUserDataDir() {
  return isPackaged() ? app.getPath('userData') : path.resolve(__dirname, '..');
}

function dbgLog(message) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${message}`;
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 300) logBuffer.shift();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadingHtml(status = '正在启动服务...') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <style>
    html,body{margin:0;width:100%;height:100%;background:#080808;color:#f4f4f0;font-family:Inter,Arial,"Microsoft YaHei",sans-serif;}
    body{display:grid;place-items:center;}
    .wrap{text-align:center;transform:translateY(-2vh);}
    .brand{font-size:28px;font-weight:750;letter-spacing:.02em;}
    .sub{margin-top:12px;color:#a1a1aa;font-size:13px;}
    .bar{width:220px;height:3px;margin:24px auto 0;border-radius:999px;background:#27272a;overflow:hidden;}
    .bar:before{content:"";display:block;width:42%;height:100%;border-radius:999px;background:#f4f3ee;animation:slide 1.2s ease-in-out infinite;}
    @keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">${APP_NAME}</div>
    <div class="sub">${escapeHtml(status)}</div>
    <div class="bar"></div>
  </div>
</body>
</html>`;
}

function errorHtml(error) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>html,body{margin:0;background:#080808;color:#f4f4f0;font-family:Consolas,"Microsoft YaHei",monospace;}body{padding:28px}.title{font-size:22px;font-weight:700}.err{margin-top:18px;white-space:pre-wrap;color:#fca5a5;background:#1f1111;border:1px solid #7f1d1d;border-radius:10px;padding:16px}.log{margin-top:16px;white-space:pre-wrap;color:#a1a1aa;font-size:12px}</style>
</head><body><div class="title">${APP_NAME} 启动失败</div><div class="err">${escapeHtml(error && error.stack ? error.stack : error)}</div><div class="log">${escapeHtml(logBuffer.join('\n'))}</div></body></html>`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: true,
    backgroundColor: '#080808',
    title: `${APP_NAME} v${APP_VERSION}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml())}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferred, maxTries = 20) {
  for (let i = 0; i < maxTries; i += 1) {
    const candidate = preferred + i;
    if (await isPortFree(candidate)) return candidate;
  }
  return preferred + Math.floor(Math.random() * 900) + 100;
}

async function startBackend() {
  backendPort = await findFreePort(BASE_PORT);
  dbgLog(`[backend] port=${backendPort}`);

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(backendPort),
    HOST: '127.0.0.1',
    LIANG_USER_DATA: getUserDataDir(),
    LIANG_PACKAGED: isPackaged() ? '1' : '0',
    LIANG_RES: isPackaged() ? process.resourcesPath : path.resolve(__dirname, '..'),
    LIANG_FRONTEND_DIST: isPackaged()
      ? path.join(process.resourcesPath, 'frontend')
      : path.resolve(__dirname, '..', 'dist'),
  };

  const runner = path.join(__dirname, 'backend-runner.cjs');
  backendProcess = spawn(process.execPath, [runner], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (data) => dbgLog(`[backend] ${String(data).trim()}`));
  backendProcess.stderr.on('data', (data) => dbgLog(`[backend:err] ${String(data).trim()}`));
  backendProcess.on('exit', (code, signal) => {
    dbgLog(`[backend] exited code=${code} signal=${signal || ''}`);
  });
}

function waitForBackend(port, maxTries = 80) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      n += 1;
      const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        if (n >= maxTries) return resolve(false);
        setTimeout(tick, 100);
      });
    };
    tick();
  });
}

ipcMain.handle('liang:get-info', () => ({
  packaged: isPackaged(),
  backendPort,
  userData: getUserDataDir(),
  version: APP_VERSION,
}));

ipcMain.handle('liang:open-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return { ok: false, error: 'missing path' };
  }
  const error = await shell.openPath(targetPath);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('liang:open-external', async (_event, url) => {
  if (!url || typeof url !== 'string') {
    return { ok: false, error: 'missing url' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('liang:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
});

function safeFileName(name) {
  return String(name || `download-${Date.now()}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 180);
}

function inferFileName(url, fallback) {
  if (fallback) return safeFileName(fallback);
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(decodeURIComponent(pathname));
    if (base && base !== '/' && base.includes('.')) return safeFileName(base);
  } catch (_) {}
  return safeFileName(`download-${Date.now()}`);
}

function uniqueTargetPath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let target = path.join(targetDir, fileName);
  let i = 1;
  while (fs.existsSync(target)) {
    target = path.join(targetDir, `${parsed.name}-${i}${parsed.ext}`);
    i += 1;
  }
  return target;
}

ipcMain.handle('liang:download-to-directory', async (_event, payload) => {
  const targetDir = payload && typeof payload.directory === 'string' ? payload.directory : '';
  let url = payload && typeof payload.url === 'string' ? payload.url : '';
  if (!targetDir || !url) return { ok: false, error: 'missing directory or url' };
  fs.mkdirSync(targetDir, { recursive: true });
  if (url.startsWith('/')) url = `http://127.0.0.1:${backendPort}${url}`;
  const fileName = inferFileName(url, payload.fileName);
  const target = uniqueTargetPath(targetDir, fileName);

  if (url.startsWith('data:')) {
    const match = /^data:.*?;base64,(.*)$/i.exec(url);
    if (!match) return { ok: false, error: 'unsupported data url' };
    fs.writeFileSync(target, Buffer.from(match[1], 'base64'));
    return { ok: true, path: target };
  }

  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buffer);
  return { ok: true, path: target };
});

app.whenReady().then(async () => {
  configureUserDataPath();
  createMainWindow();
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    await startBackend();
    const ready = await waitForBackend(backendPort);
    if (!ready) throw new Error('Backend did not become ready in time.');
    const url = `http://127.0.0.1:${backendPort}/`;
    dbgLog(`[main] loading ${url}`);
    await mainWindow.loadURL(url);
  } catch (error) {
    dbgLog(`[fatal] ${error && error.stack ? error.stack : error}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml(error))}`);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (!backendProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], { windowsHide: true });
    } else {
      backendProcess.kill('SIGTERM');
    }
  } catch (_) {}
});
