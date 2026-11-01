'use strict';
const { app, BrowserWindow, dialog, shell, session, systemPreferences } = require('electron');
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
    // Deny implicit permission checks: media must go through the explicit prompt below.
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
      permission === 'clipboard-sanitized-write' && contents && contents.getURL() === APP_URL &&
      origin === `http://${HOST}:${PORT}` && details.isMainFrame === true);
    // Only the bundled main frame can request microphone/camera, after explicit user approval.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const allowed = permission === 'media' && contents && contents.getURL() === APP_URL &&
        details.isMainFrame === true && details.requestingUrl === APP_URL &&
        Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 &&
        details.mediaTypes.every(type => type === 'audio' || type === 'video');
      if (!allowed) { callback(false); return; }
      const types = [...new Set(details.mediaTypes)];
      const prompts = {
        ru: ['Разрешить', 'Отмена', 'Разрешить доступ к микрофону для записи?', 'Разрешить доступ к камере и микрофону для записи?'],
        en: ['Allow', 'Cancel', 'Allow microphone access to record?', 'Allow camera and microphone access to record?'],
        de: ['Erlauben', 'Abbrechen', 'Mikrofonzugriff für die Aufnahme erlauben?', 'Kamera- und Mikrofonzugriff für die Aufnahme erlauben?'],
        uk: ['Дозволити', 'Скасувати', 'Дозволити доступ до мікрофона для запису?', 'Дозволити доступ до камери та мікрофона для запису?'],
        fr: ['Autoriser', 'Annuler', 'Autoriser le microphone pour enregistrer ?', 'Autoriser la caméra et le microphone pour enregistrer ?']
      };
      const labels = prompts[app.getLocale().slice(0, 2)] || prompts.en;
      dialog.showMessageBox(window, {
        type: 'question', buttons: labels.slice(0, 2), defaultId: 1, cancelId: 1,
        message: labels[types.includes('video') ? 3 : 2]
      }).then(async result => {
        if (result.response !== 0 || contents.isDestroyed() || contents.getURL() !== APP_URL) return callback(false);
        if (process.platform === 'darwin') {
          for (const type of types) {
            const granted = await systemPreferences.askForMediaAccess(type === 'video' ? 'camera' : 'microphone');
            if (!granted) return callback(false);
          }
        }
        callback(true);
      }).catch(() => callback(false));
    });
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
