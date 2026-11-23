'use strict';
/* The search box: a hotkey (Ctrl+Alt+Space by default) turns the notch into a search bar for apps, files,
   maths, unit conversion, clipboard history, NotchMine / Windows commands and the web.
   - Files come from Everything (voidtools.com) when it runs, else from the Windows search index. Both go through
     a small helper process (bridge/search.ps1) that waits on stdin and is stopped after a few idle minutes.
   - The list of apps (everything in Start) is cached on disk, so the box is instant even before the helper is up.
   - What you open is remembered (search-history.json) so your usual picks rise to the top. Nothing leaves the PC
     except a web search you choose, which opens in your browser. */

const { app, BrowserWindow, WebContentsView, ipcMain, shell, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const W = 700, H = 820;               // css px; the window is transparent, the box inside grows with the results (and the answer page)
const IDLE_MS = 10 * 60 * 1000;       // stop the helper after this long without a search
// the answer page shown inside the box for questions: the engine's own results page, in its compact (phone) layout
const PREVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
// Google's page starts with its own logo, search bar and tabs (already in our box): start at the results instead,
// past the "search in another language" box too (but not past "Did you mean…"). Other engines show from the top.
const PREVIEW_SCROLL = `(() => {
  const c = document.querySelector('#center_col');
  if (!c) return;
  let y = c.getBoundingClientRect().top + scrollY;
  const t = document.querySelector('#taw');
  if (t && t.offsetHeight && !/did you mean|showing results|search instead/i.test(t.innerText)) y = t.getBoundingClientRect().bottom + scrollY;
  window.scrollTo(0, Math.max(0, y - 6));
})()`;
const PREVIEW_CSS = '::-webkit-scrollbar{width:8px;height:8px;background:transparent}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.45);border-radius:4px}';
const ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
  ecosia: 'https://www.ecosia.org/search?q=',
};

let ctx = null;                       // what main.js lends us (settings, the notch's spot, commands…)
let sw = null;                        // the search window
let open = false;
let hotkeyNow = '';                   // the accelerator registered right now
const userDir = () => app.getPath('userData');

// ------------------------------------------------------------------ the helper process
let helper = null, helperBuf = '', helperSeq = 0, helperIdle = 0, helperReady = null;
const waiting = new Map();             // id → { resolve, timer }
let evRunning = null;                  // last known: Everything answers

function helperPath() {
  return path.join(__dirname, '..', 'bridge', 'search.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}
function startHelper() {
  if (helper) return helperReady;
  helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath()],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const me = helper;
  helperBuf = '';
  helperReady = new Promise(res => waiting.set('ready', { resolve: res, timer: setTimeout(() => { waiting.delete('ready'); res(null); }, 15000) }));
  me.stdout.setEncoding('utf8');
  me.stdout.on('data', chunk => {
    helperBuf += chunk;
    let i;
    while ((i = helperBuf.indexOf('\n')) >= 0) {
      const line = helperBuf.slice(0, i).trim();
      helperBuf = helperBuf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      const w = waiting.get(m.id);
      if (!w) continue;
      waiting.delete(m.id);
      clearTimeout(w.timer);
      w.resolve(m.error ? null : m.data);
    }
  });
  me.stderr.on('data', d => { if (!app.isPackaged) console.error('[search]', String(d).trim()); });
  me.on('exit', () => {
    if (helper === me) helper = null;
    for (const [id, w] of waiting) { clearTimeout(w.timer); w.resolve(null); waiting.delete(id); }
  });
  helperReady.then(r => { if (r) refreshApps(); });
  return helperReady;
}
function stopHelper() {
  clearTimeout(helperIdle);
  if (helper) { try { helper.stdin.end(); } catch { /* gone */ } setTimeout(() => { try { helper && helper.kill(); } catch { /* gone */ } }, 3000); }
}
function touchHelper() {
  clearTimeout(helperIdle);
  helperIdle = setTimeout(() => { if (!open) stopHelper(); else touchHelper(); }, IDLE_MS);
}
async function ask(cmd, arg = '', timeout = 4000) {
  startHelper();
  touchHelper();
  await helperReady;
  if (!helper) return null;
  const id = 'q' + (++helperSeq);
  const clean = String(arg).replace(/[\t\r\n]+/g, ' ');
  return new Promise(resolve => {
    waiting.set(id, { resolve, timer: setTimeout(() => { waiting.delete(id); resolve(null); }, timeout) });
    try { helper.stdin.write(`${id}\t${cmd}${clean ? '\t' + clean : ''}\n`); } catch { waiting.delete(id); resolve(null); }
  });
}

// ------------------------------------------------------------------ apps in Start (cached)
const APPS_FILE = () => path.join(userDir(), 'search-apps.json');
let apps = null;
function loadApps() {
  if (apps) return apps;
  try { apps = JSON.parse(fs.readFileSync(APPS_FILE(), 'utf8')); } catch { apps = []; }
  if (!Array.isArray(apps)) apps = [];
  return apps;
}
let appsAt = 0;
async function refreshApps() {
  if (Date.now() - appsAt < 60000) return;
  appsAt = Date.now();
  const list = await ask('apps', '', 30000);
  if (!Array.isArray(list) || !list.length) return;
  const seen = new Set();
  apps = list.filter(a => a && a.n && a.id && !seen.has(a.id.toLowerCase()) && seen.add(a.id.toLowerCase()))
    .map(a => ({ n: String(a.n), id: String(a.id) }));
  try { fs.writeFileSync(APPS_FILE(), JSON.stringify(apps)); } catch { /* read-only */ }
  if (sw && !sw.isDestroyed() && open) sw.webContents.send('search-apps', apps);
}

// ------------------------------------------------------------------ history (your usual picks rise to the top)
const HIST_FILE = () => path.join(userDir(), 'search-history.json');
let hist = null, histT = 0;
// when Windows last started (to the minute): Recent is cleared on a new start
const bootTime = () => Math.round((Date.now() - os.uptime() * 1000) / 60000) * 60000;
function loadHist() {
  if (hist) return hist;
  try { hist = JSON.parse(fs.readFileSync(HIST_FILE(), 'utf8')); } catch { hist = null; }
  if (!hist || typeof hist !== 'object') hist = {};
  hist.counts = hist.counts && typeof hist.counts === 'object' ? hist.counts : {};
  hist.picks = hist.picks && typeof hist.picks === 'object' ? hist.picks : {};
  hist.recent = Array.isArray(hist.recent) ? hist.recent : [];
  // the PC was restarted (or shut down without NotchMine hearing it, e.g. power loss): start with an empty Recent.
  // What you open most still ranks first; only the "Recent" list is per session.
  const boot = bootTime();
  if (!hist.boot || Math.abs(hist.boot - boot) > 5 * 60000) { hist.recent = []; hist.boot = boot; saveHist(); }
  return hist;
}
// Windows is shutting down, restarting or signing out: clear Recent now (with Fast Startup, a shutdown doesn't
// reset the start time, so the check above alone wouldn't notice)
function clearRecentNow() {
  const h = loadHist();
  h.recent = [];
  h.boot = 0;                                            // next start clears again, whatever the start time says
  clearTimeout(histT);
  try { fs.writeFileSync(HIST_FILE(), JSON.stringify(h)); } catch { /* read-only */ }
}
function saveHist() {
  clearTimeout(histT);
  histT = setTimeout(() => { try { fs.writeFileSync(HIST_FILE(), JSON.stringify(hist)); } catch { /* read-only */ } }, 500);
}
const RECENT_MAX = 40;                // kept across all kinds; the box shows a few of each
function remember(item, q) {
  const h = loadHist();
  if (!item || !item.key || /^(calc|unit|tip):/.test(item.key)) return;
  if (item.kind === 'web') {
    // a web search or question: into Recent (newest first), so you can run it again; it doesn't change the ranking
    const text = String((item.run && item.run.q) || q || '').trim().slice(0, 200);
    if (!text) return;
    const keep = { key: 'web:' + text.toLowerCase(), kind: 'web', title: text, sub: 'Web search', run: { kind: 'web', q: text }, icon: { glyph: 'search', accent: true } };
    h.recent = [keep, ...h.recent.filter(r => r.key !== keep.key)].slice(0, RECENT_MAX);
    saveHist();
    return;
  }
  const c = h.counts[item.key] || { n: 0, t: 0 };
  c.n++; c.t = Date.now();
  h.counts[item.key] = c;
  const ql = String(q || '').trim().toLowerCase();
  if (ql) for (let i = 1; i <= Math.min(ql.length, 24); i++) h.picks[ql.slice(0, i)] = item.key;
  // what the box shows before you type: the last things you opened, with what's needed to open them again
  const keep = { key: item.key, kind: item.kind, title: item.title, sub: item.sub || '', tag: typeof item.tag === 'string' ? item.tag.slice(0, 20) : '', run: item.run, icon: item.icon || null };
  h.recent = [keep, ...h.recent.filter(r => r.key !== item.key)].slice(0, RECENT_MAX);
  // keep the file small
  const keys = Object.keys(h.counts);
  if (keys.length > 600) keys.sort((a, b) => h.counts[a].t - h.counts[b].t).slice(0, keys.length - 500).forEach(k => delete h.counts[k]);
  const pk = Object.keys(h.picks);
  if (pk.length > 1500) pk.slice(0, pk.length - 1200).forEach(k => delete h.picks[k]);
  saveHist();
}

// ------------------------------------------------------------------ icons
const icons = new Map();               // key → Promise<data URL | null>
const GENERIC_EXT = /\.(exe|lnk|ico|url|appref-ms|msc|cpl|scr)$/i;
function iconFor(key) {
  if (typeof key !== 'string') return null;
  let k = key;
  if (key.startsWith('file:')) {
    const p = key.slice(5);
    // most files share their type's icon: ask once per extension (programs and shortcuts have their own)
    if (!GENERIC_EXT.test(p)) {
      let isDir = false;
      try { isDir = fs.statSync(p).isDirectory(); } catch { /* gone */ }
      k = isDir ? 'dir:' : 'ext:' + (path.extname(p).toLowerCase() || '.');
      if (!icons.has(k)) icons.set(k, app.getFileIcon(p, { size: 'normal' }).then(i => i.toDataURL()).catch(() => null));
      return icons.get(k);
    }
    if (!icons.has(k)) icons.set(k, app.getFileIcon(p, { size: 'normal' }).then(i => i.toDataURL()).catch(() => null));
    return icons.get(k);
  }
  if (key.startsWith('app:')) {
    if (!icons.has(k)) icons.set(k, ask('appicon', key.slice(4), 6000).then(d => (d ? 'data:image/png;base64,' + d : null)));
    return icons.get(k);
  }
  return null;
}

// ------------------------------------------------------------------ the window
function place() {
  const spot = ctx.spot();                       // { display, cx, y, island }
  const d = spot.display || screen.getPrimaryDisplay();
  const z = ctx.zoom();
  const w = Math.round(W * z), h = Math.round(Math.min(H * z, d.workArea.height));
  const x = Math.round(Math.max(d.bounds.x, Math.min(d.bounds.x + d.bounds.width - w, spot.cx - w / 2)));
  sw.setBounds({ x, y: Math.round(spot.y), width: w, height: h });
  return { island: !!spot.island, offset: (spot.cx - x) / z };
}
function createWindow() {
  sw = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'NotchMine Search',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  sw.setAlwaysOnTop(true, 'screen-saver');
  sw.loadFile(path.join(__dirname, 'renderer', 'search.html'));
  sw.webContents.on('did-finish-load', () => sw.webContents.setZoomFactor(ctx.zoom()));
  sw.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  sw.webContents.on('will-navigate', e => e.preventDefault());
  sw.on('blur', () => { if (open && !sw.webContents.isDevToolsOpened()) hide(); });
  sw.on('session-end', clearRecentNow);                  // Windows: shutdown, restart or sign-out
  sw.on('closed', () => { sw = null; pv = null; pvUrl = ''; open = false; ctx.searching(false); });
  if (!app.isPackaged) {
    sw.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[search] ${message} (${path.basename(source)}:${line})`);
    });
  }
  return new Promise(res => sw.webContents.once('did-finish-load', res));
}
function payload(extra) {
  const s = ctx.settings();
  return {
    apps: loadApps(), shortcuts: (s.shortcuts || []).map(x => ({ id: x.id, name: x.name, target: x.target, icon: x.icon || null })),
    clipboard: s.searchClipboard === false ? [] : ctx.clipboard(), history: loadHist(), everything: evRunning,
    settings: { theme: s.theme, searchEngine: s.searchEngine || 'google', searchFiles: s.searchFiles !== false, searchClipboard: s.searchClipboard !== false, searchPreview: s.searchPreview !== false, scale: ctx.zoom() },
    accent: ctx.accent(), home: os.homedir(), ...extra,
  };
}
async function show() {
  if (open) return;
  startHelper();
  touchHelper();
  if (!sw || sw.isDestroyed()) await createWindow();
  sw.webContents.setZoomFactor(ctx.zoom());
  const where = place();
  open = true;
  ctx.searching(true);
  sw.webContents.send('search-open', payload(where));
  sw.show();
  sw.focus();
  sw.webContents.focus();
  ask('status', '', 3000).then(st => {
    evRunning = !!(st && st.running);
    if (sw && open) sw.webContents.send('search-status', { ...(st || { running: false }), installed: !!everythingExe() });
  });
}
function hide() {
  if (!open) return;
  open = false;
  ctx.searching(false);
  hidePreview(true);
  if (sw && !sw.isDestroyed()) { sw.webContents.send('search-close'); sw.hide(); }
}
const toggle = () => (open ? hide() : show());

// ------------------------------------------------------------------ the answer page (questions → the engine's results, inside the box)
// A small browser view laid over a placeholder in the box. It shows the page as the engine serves it to any browser
// (nothing is copied out of it). A click on a result opens it in your browser; Esc in it closes the box.
let pv = null, pvUrl = '', pvWanted = false, pvQuery = '';
function previewUrl(q) {
  const s = ctx.settings();
  return (ENGINES[s.searchEngine] || ENGINES.google) + encodeURIComponent(q);
}
function ensurePreview() {
  if (pv) return pv;
  pv = new WebContentsView({ webPreferences: { partition: 'persist:nm-websearch', contextIsolation: true, sandbox: true, nodeIntegration: false } });
  pv.setBackgroundColor('#000000');
  try { pv.setBorderRadius(14); } catch { /* older Electron */ }
  pv.setVisible(false);
  const wc = pv.webContents;
  wc.setUserAgent(PREVIEW_UA);
  wc.setAudioMuted(true);
  const external = url => {
    if (!/^https?:\/\//i.test(url)) return;
    shell.openExternal(url);
    if (pvQuery) remember({ key: 'web:', kind: 'web', run: { kind: 'web', q: pvQuery } }, pvQuery);   // you used this answer
    hide();
  };
  wc.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => {
    // the engine's own pages (another results page, a tab like Images) stay here; anything else opens in the browser
    let same = false;
    try { same = new URL(url).hostname === new URL(pvUrl).hostname && /[?&]q=/.test(url); } catch { /* bad URL */ }
    if (!same) { e.preventDefault(); external(url); }
  });
  wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); hide(); } });
  const state = st => { if (sw && !sw.isDestroyed() && open) sw.webContents.send('search-preview-state', st); };
  wc.on('did-start-loading', () => state({ loading: true }));
  wc.on('dom-ready', () => {
    if (wc.getURL() === 'about:blank') return;
    wc.insertCSS(PREVIEW_CSS).catch(() => {});
    // show it once it's scrolled to the answer (or after a moment, whatever the page does)
    let shown = false;
    const reveal = () => { if (shown) return; shown = true; if (pvWanted && open) pv.setVisible(true); state({ loading: false }); };
    setTimeout(reveal, 1200);
    wc.executeJavaScript(PREVIEW_SCROLL).catch(() => {}).finally(reveal);
  });
  wc.on('did-fail-load', (_e, code, _d, url, main) => { if (main && code !== -3) state({ loading: false, error: true }); });
  sw.contentView.addChildView(pv);
  return pv;
}
function showPreview(q, r) {
  if (!sw || sw.isDestroyed() || !open || typeof q !== 'string' || !q.trim() || !r) return;
  const view = ensurePreview(), z = ctx.zoom();
  view.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.max(1, Math.round(r.width * z)), height: Math.max(1, Math.round(r.height * z)) });
  pvWanted = true;
  pvQuery = q.trim().slice(0, 300);
  const url = previewUrl(pvQuery);
  if (url !== pvUrl) {
    pvUrl = url;
    view.setVisible(false);                              // until the new page is ready (the box shows "Searching…")
    view.webContents.loadURL(url);
  } else if (!view.webContents.isLoading()) view.setVisible(true);
}
function hidePreview(blank) {
  pvWanted = false;
  if (!pv) return;
  pv.setVisible(false);
  if (blank) { pvUrl = ''; pv.webContents.loadURL('about:blank').catch(() => {}); }
}

// ------------------------------------------------------------------ the hotkey
function registerHotkey(accel) {
  if (hotkeyNow) { try { globalShortcut.unregister(hotkeyNow); } catch { /* never mind */ } hotkeyNow = ''; }
  if (!accel || ctx.settings().searchOn === false) return true;
  let ok = false;
  try { ok = globalShortcut.register(accel, toggle); } catch { ok = false; }
  if (ok) hotkeyNow = accel;
  return ok;
}
const hotkey = () => ctx.settings().searchHotkey || 'Ctrl+Alt+Space';

// ------------------------------------------------------------------ opening things
function run(item, q, alt) {
  const r = item && item.run;
  if (!r || typeof r !== 'object') return;
  const s = ctx.settings();
  if (alt === 'reveal' || alt === 'copypath') {                     // a file's second actions (Ctrl+Enter, Ctrl+Shift+C)
    if (r.kind !== 'file' || typeof r.path !== 'string') return;
    if (alt === 'copypath') { ctx.copyText(r.path); hide(); return; }
    if (fs.existsSync(r.path)) shell.showItemInFolder(r.path);
    remember(item, q);
    hide();
    return;
  }
  switch (r.kind) {
    case 'app': {
      const id = String(r.id || '');
      if (!id) return;
      spawn('explorer.exe', ['shell:AppsFolder\\' + id], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      break;
    }
    case 'file': if (typeof r.path === 'string' && fs.existsSync(r.path)) shell.openPath(r.path); break;
    case 'shortcut': ctx.launchShortcut(r.id); break;
    case 'command': ctx.command(String(r.name || '')); break;
    case 'copy': if (typeof r.text === 'string') ctx.copyText(r.text); break;
    case 'url': if (/^https?:\/\//i.test(r.url || '')) shell.openExternal(r.url); break;
    case 'web': {
      const base = ENGINES[s.searchEngine] || ENGINES.google;
      shell.openExternal(base + encodeURIComponent(String(r.q || q || '').trim()));
      break;
    }
    case 'get-everything': shell.openExternal('https://www.voidtools.com/downloads/'); break;
    case 'start-everything': startEverything(); return;
    default: return;
  }
  remember(item, q);
  hide();
}
function everythingExe() {
  const c = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).map(d => path.join(d, 'Everything', 'Everything.exe'));
  return c.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || '';
}
function startEverything() {
  const exe = everythingExe();
  if (!exe) { shell.openExternal('https://www.voidtools.com/downloads/'); return false; }
  spawn(exe, ['-startup'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => ask('status').then(st => {
    evRunning = !!(st && st.running);
    if (sw && open) sw.webContents.send('search-status', { ...(st || { running: false }), installed: true });
  }), 2500);
  return true;
}

// ------------------------------------------------------------------ wiring
function init(c) {
  ctx = c;
  ipcMain.handle('search-files', async (_e, q) => {
    if (typeof q !== 'string' || q.trim().length < 2 || ctx.settings().searchFiles === false) return null;
    const r = await ask('files', q.slice(0, 200), 5000);
    if (r && r.engine) evRunning = r.engine === 'everything';
    return r;
  });
  ipcMain.handle('search-icon', (_e, key) => iconFor(key));
  ipcMain.on('search-run', (_e, item, q, alt) => run(item, q, alt));
  ipcMain.on('search-hide', () => hide());
  ipcMain.on('search-preview', (_e, req) => {
    if (!req || ctx.settings().searchPreview === false) { hidePreview(false); return; }
    showPreview(req.q, req.rect);
  });
  ipcMain.on('search-preview-open', (_e, q) => {        // "Open in browser": the same results, full size
    if (typeof q === 'string' && q.trim()) { shell.openExternal(previewUrl(q.trim())); hide(); }
  });
  ipcMain.on('search-drag', async (e, p) => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return;
    let ic;
    try { ic = await app.getFileIcon(p, { size: 'normal' }); } catch { return; }
    e.sender.startDrag({ file: p, icon: ic });
  });
  ipcMain.on('search-forget', (_e, key) => {
    const h = loadHist();
    delete h.counts[key];
    h.recent = h.recent.filter(r => r.key !== key);
    for (const k of Object.keys(h.picks)) if (h.picks[k] === key) delete h.picks[k];
    saveHist();
  });
  // Settings → Search
  ipcMain.handle('search-status', async () => {
    const st = await ask('status', '', 4000);
    evRunning = !!(st && st.running);
    return { ...(st || { running: false }), installed: !!everythingExe(), hotkey: hotkeyNow, apps: loadApps().length };
  });
  ipcMain.handle('search-hotkey', (_e, accel) => {
    if (typeof accel !== 'string' || accel.length > 60) return { ok: false };
    const before = hotkey();
    if (!registerHotkey(accel)) { registerHotkey(before); return { ok: false, error: 'taken' }; }
    ctx.set({ searchHotkey: accel });
    return { ok: true, hotkey: accel };
  });
  ipcMain.on('search-hotkey-pause', (_e, on) => { if (on) registerHotkey(''); else registerHotkey(hotkey()); });
  ipcMain.on('search-everything', (_e, what) => { if (what === 'start') startEverything(); else shell.openExternal('https://www.voidtools.com/downloads/'); });
  ipcMain.on('search-open', () => show());

  registerHotkey(hotkey());
  // warm up a little after start, so the first search is instant: the window and the app list
  setTimeout(() => {
    if (ctx.settings().searchOn === false) return;
    if (!sw) createWindow();
    startHelper();
    touchHelper();
  }, 6000);
}
// main.js calls this when a setting changes
function onSettings(patch) {
  if ('searchOn' in patch) { registerHotkey(hotkey()); if (patch.searchOn === false) { hide(); stopHelper(); } }
  if ('scale' in patch && sw && !sw.isDestroyed()) sw.webContents.setZoomFactor(ctx.zoom());
  if ('accent' in patch && sw && !sw.isDestroyed()) sw.webContents.send('search-accent', patch.accent);
}
function quit() { stopHelper(); }

module.exports = { init, show, hide, toggle, onSettings, quit, hotkeyLabel: () => hotkeyNow };
