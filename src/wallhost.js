'use strict';
/* NotchMine wallpaper host: a separate process that does nothing but host the live wallpaper windows
   (renderer/wallpaper.html, one per screen).

   Why a process of its own: to sit behind the desktop icons, a wallpaper window becomes a child of Explorer's
   desktop window, and Windows then ties the input of the thread that owns it to Explorer's. If that thread were
   NotchMine's busy main process (cursor polling, mouse hook, bridge messages…), every hiccup there would freeze
   the desktop and the taskbar. Here the owning thread only pumps the wallpaper windows' messages.

   main.js starts it with --nm-wallpaper-host --nm-pipe=<named pipe> and talks to it with JSON lines over that pipe
   (an Electron main process on Windows gets no usable stdin):
     main → host  {type:'displays', list:[{id, bounds}]}  {type:'settings', settings}  {type:'weather', weather}
                  {type:'paused', map:{id: bool}}  {type:'bg', path, key}  {type:'close', id}  {type:'quit'}
     host → main  {type:'hwnd', id, hwnd, rect}  (main has the bridge place it behind the icons)
                  {type:'closed', id}  (closed without being asked: Explorer restarted)  {type:'log', message} */

const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const readline = require('readline');

app.setPath('userData', path.join(app.getPath('userData'), 'wallpaper-host'));   // its own cache, no lock fights

const PIPE = (process.argv.find(a => a.startsWith('--nm-pipe=')) || '').slice('--nm-pipe='.length);
let sock = null;
const out = m => { try { if (sock && !sock.destroyed) sock.write(JSON.stringify(m) + '\n'); } catch { /* main is gone */ } };
const log = message => out({ type: 'log', message });
const S = { settings: {}, weather: null, paused: {}, bg: null, bgKey: null };
const wins = new Map();                       // display id → { win, closing }

function sendAll(channel, payload) {
  for (const e of wins.values()) if (!e.win.isDestroyed()) e.win.webContents.send(channel, payload);
}

function create(d) {
  const w = new BrowserWindow({
    x: d.bounds.x - 40000, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,   // off-screen until it's placed
    frame: false, show: false, skipTaskbar: true, focusable: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, hasShadow: false, backgroundColor: '#000000', title: 'NotchMine Wallpaper',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  const e = { win: w, closing: false };
  wins.set(d.id, e);
  w.loadFile(path.join(__dirname, 'renderer', 'wallpaper.html'));
  w.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 2) log(`[wallpaper ${d.id}] ${message} (${path.basename(source)}:${line})`);
  });
  w.webContents.on('render-process-gone', (_ev, info) => log(`[wallpaper ${d.id}] renderer gone: ${info.reason}`));
  w.once('ready-to-show', () => {
    w.showInactive();
    const rect = screen.dipToScreenRect(null, d.bounds);          // the desktop works in physical pixels
    out({ type: 'hwnd', id: d.id, hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(), rect });
  });
  w.on('closed', () => {
    if (wins.get(d.id) === e) wins.delete(d.id);
    if (!e.closing) out({ type: 'closed', id: d.id });
  });
}
function close(id) {
  const e = wins.get(id);
  if (!e) return;
  e.closing = true;
  wins.delete(id);
  if (!e.win.isDestroyed()) e.win.destroy();
}
function syncDisplays(list) {
  const ids = new Set(list.map(d => d.id));
  for (const id of [...wins.keys()]) if (!ids.has(id)) close(id);
  for (const d of list) if (!wins.has(d.id)) create(d);
}

// "My wallpaper": decode and scale the picture here, so the main process never stalls on it
function loadBg(p, key) {
  if (key === S.bgKey) return;
  S.bgKey = key;
  let url = null;
  if (p) {
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) { try { img = nativeImage.createFromBuffer(fs.readFileSync(p)); } catch { /* unreadable */ } }
    if (!img.isEmpty()) {
      const max = Math.max(...screen.getAllDisplays().map(d => Math.round(Math.max(d.size.width, d.size.height) * d.scaleFactor)));
      const big = img.getSize().width > max ? img.resize({ width: max, quality: 'best' }) : img;
      url = 'data:image/jpeg;base64,' + big.toJPEG(92).toString('base64');
    } else log('[wallpaper] could not read your wallpaper: ' + p);
  }
  S.bg = url;
  sendAll('wp-bg', url);
}

ipcMain.handle('wp-init', e => {
  const id = [...wins.entries()].find(([, x]) => !x.win.isDestroyed() && x.win.webContents === e.sender)?.[0];
  return { settings: S.settings, weather: S.weather, paused: !!S.paused[id], bg: S.bg };
});

function onMessage(m) {
  switch (m.type) {
    case 'displays': syncDisplays(m.list || []); break;
    case 'settings': S.settings = m.settings || {}; sendAll('settings', S.settings); break;
    case 'weather': S.weather = m.weather || null; sendAll('wp-weather', S.weather); break;
    case 'paused':
      S.paused = m.map || {};
      for (const [id, e] of wins) if (!e.win.isDestroyed()) e.win.webContents.send('wp-paused', !!S.paused[id]);
      break;
    case 'bg': if (m.path) loadBg(m.path, m.key); else { S.bg = null; S.bgKey = null; sendAll('wp-bg', null); } break;
    case 'audio':                    // the notch's sound levels (audiofeed.js); this process never captures any itself
      sendAll('audio', { rate: m.rate, size: m.size, freq: Uint8Array.from(m.freq || []), td: m.td ? Uint8Array.from(m.td) : null });
      break;
    case 'close': close(m.id); break;
    case 'quit': for (const id of [...wins.keys()]) close(id); app.quit(); break;
  }
}

app.on('window-all-closed', () => { /* stay: main decides when we quit */ });
function bye() { for (const id of [...wins.keys()]) close(id); app.quit(); }
app.whenReady().then(() => {
  if (!PIPE) { bye(); return; }
  sock = net.connect(PIPE, () => out({ type: 'ready' }));
  sock.on('error', bye);
  const rl = readline.createInterface({ input: sock });
  rl.on('line', line => { let m; try { m = JSON.parse(line); } catch { return; } try { onMessage(m); } catch (err) { log('[wallpaper host] ' + err.message); } });
  sock.on('close', bye);                                     // NotchMine quit or crashed
});
