'use strict';
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createLocalServer, HOST, PORT } = require('./local-server');
const APP_URL = `http://${HOST}:${PORT}/index.html`;
let window = null;
let server = null;

// A second launch focuses the existing window, rather than connecting to an unknown service.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.enableSandbox();
  app.whenReady().then(() => {
    const htmlPath = app.isPackaged
      ? path.join(process.resourcesPath, 'variant-b.html')
      : path.join(__dirname, '..', 'variant-b.html');
    let html;
    try { html = fs.readFileSync(htmlPath); }
    catch (error) { dialog.showErrorBox('Material Chat', `Could not load the app: ${error.message}`); app.quit(); return; }
    server = createLocalServer(html);
    server.once('error', error => {
      dialog.showErrorBox('Material Chat', `Could not start the local app. Port ${PORT} may already be in use.\n${error.message}`);
      app.quit();
    });
    server.listen({ host: HOST, port: PORT, exclusive: true }, () => {
      window = new BrowserWindow({
        title: 'Material Chat', width: 1280, height: 800, minWidth: 360, minHeight: 560,
        backgroundColor: '#f5f5fa', icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
      });
      window.setMenuBarVisibility(false);
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== APP_URL && url !== `http://${HOST}:${PORT}/`) {
          event.preventDefault();
          openExternal(url);
        }
      });
      window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
      window.on('closed', () => { window = null; });
      window.loadURL(APP_URL).catch(error => dialog.showErrorBox('Material Chat', error.message));
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (server) server.close(); });
}

function openExternal(value) {
  try {
    const url = new URL(value);
    if (['https:', 'mailto:', 'tel:', 'tg:'].includes(url.protocol)) shell.openExternal(url.href).catch(() => {});
  } catch (_) { /* Ignore invalid or unsafe URLs. */ }
}
