'use strict';

const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage,
  clipboard, shell, globalShortcut, dialog, powerSaveBlocker, desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec, execFile } = require('child_process');
const net = require('net');

// the live wallpaper's own process (see wallhost.js): nothing else of NotchMine runs in it
if (process.argv.includes('--nm-wallpaper-host')) { require('./wallhost'); return; }
const lyrics = require('./lyrics');
const artwork = require('./artwork');
const gameart = require('./gameart');
const phone = require('./phone');
const search = require('./search');

// ------------------------------------------------------------------ constants
const WIN_W = 820;   // transparent canvas; the visible notch is drawn inside it
const WIN_H = 360;
const STACK_H = 1000; // Stacked layout: the panel is a tall column (as tall as the screen's work area allows)
const ASSETS = path.join(__dirname, '..', 'assets');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.notchmine.app');

// ------------------------------------------------------------------ settings
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  city: '',                 // set in Settings → Widgets → Weather city
  lat: null,
  lon: null,
  use24h: false,
  showSeconds: false,
  launchAtLogin: false,
  clipboardHistory: true,
  fullscreenMode: 'dim',   // a full-screen app (movie, game) on the notch's screen: 'show' | 'dim' (thin + see-through until hovered) | 'hide'
  theme: 'midnight',        // midnight | graphite | glass | aurora | weather (colours follow the weather outside)
  wxPill: true,             // rain / snow across the pill (idle or playing music); rain also all over the open panel
  accentMode: 'auto',       // auto (album art) | purple | blue | teal | green | orange | pink | red
  scale: 1,                 // 0.9 | 1 | 1.15 | 1.3
  openDelay: 140,           // ms of hover before the notch opens
  visualizer: true,         // real audio visualizer (system loopback)
  notifications: true,      // mirror Windows notifications into the notch
  notifHideText: false,     // show only the app name in pop-ups
  shortcuts: [],            // [{ id, name, target, icon }]
  lyrics: true,             // fetch synced lyrics from lrclib.net (title/artist only)
  onlineArtwork: true,      // when a player shares no album art, look it up on iTunes Search (title/artist only)
  lyricsInPill: true,       // show the current lyric line in the collapsed pill
  catchScreenshots: true,   // screenshots / copied images pop into the notch
  trackDownloads: true,     // finished downloads pop into the notch
  devicePopups: true,       // USB drives, audio output changes, Caps/Num Lock
  privacyDots: true,        // camera / microphone in-use indicator
  focusSilence: true,       // hold notification pop-ups during a focus session
  gestures: true,           // swipe = skip, double-click = play/pause, middle-click = mute
  artFx: 'sun',             // music icon effect while playing: 'sun' | 'orb' | 'none' (more can be added)
  fxSensitivity: 50,        // 0-100: how strongly the sun / orb reacts (sparks, beat bursts, orb spin)
  shape: 'notch',           // 'notch' = glued to the top edge, 'island' = floating pill
  layout: 'tabs',           // opened panel: 'tabs' = one wide section at a time | 'stacked' = every section in a tall column
  partyScreens: 'all',      // party mode on: 'all' screens | 'notch' (the notch's screen) | 'main'
  partyTheme: 'club',       // 'club' (orb/sun + lights) | 'synthwave' | 'warp'
  deskEq: false,            // see-through equalizer along the bottom of the screen
  deskEqIntensity: 60,      // 0-100: how bright / strong the bars are
  deskEqHeight: 45,         // 0-100: how high the bars can jump
  deskEqPos: 'above',       // 'above' the taskbar | 'bottom' of the screen (over the taskbar)
  deskEqScreens: 'all',     // 'all' | 'notch'
  deskEqMirror: true,       // bass in the middle, highs to the sides (else left → right)
  deskEqStyle: 'bars',      // look of the desktop equalizer: one of STYLES in renderer/deskeq.js (Settings → Style)
  ambient: false,           // ambient screen: a full-screen movie on one screen colours the other screens
  ambTrigger: 'fullscreen', // when: 'fullscreen' (a full-screen app on another screen) | 'always' (follows the main screen too)
  ambStyle: 'glow',         // glow | reflect | mood | edge | lava | solid (renderer/ambient.js)
  ambEq: 'bars',            // equalizer on top, in the scene's colours: 'none' or one of the eqstyles.js looks
  ambBright: 70,            // 0-100
  ambSat: 40,               // 0-100: colour boost
  ambSpeed: 50,             // 0-100: how quickly the colours follow the picture
  ambEqHeight: 40,          // 0-100
  ambPulse: true,           // brighter on the beat
  ambCutFlash: true,        // a soft flash when the scene changes
  ambPeek: true,            // fades away while the mouse is on that screen
  ambGames: false,          // also while a game runs
  wpOn: false,              // live wallpaper behind the desktop icons (Settings → Wallpaper)
  wpMode: 'auto',           // 'auto' = follows the weather | 'manual' = always wpStyle
  wpStyle: 'rain',          // rain | storm | snow | sunny | cloudy | night | aurora | music
  wpBack: 'scene',          // what's behind the effects: 'scene' (an animated sky) | 'mine' (your own Windows wallpaper)
  wpNight: 'night',         // Automatic on a clear night: 'night' (stars) | 'aurora'
  wpAmount: 60,             // 10-100: how much rain / snow / stars
  wpDim: 15,                // 0-60: darkens it so desktop icons stay readable
  wpBeat: true,             // pulse with the music
  wpScreens: 'all',         // 'all' | 'notch'
  wpPauseFs: true,          // stop drawing behind full-screen apps, games and maximized windows
  wpBatteryStill: true,     // hold a still frame while on battery
  tbStyle: 'windows',       // taskbar: 'windows' (the normal one) | 'dockeq' (dock + music) | 'dock' | 'bar' (full width)
  tbLast: 'dockeq',         // the NotchMine style to return to (Ctrl+Alt+T, the tray menu)
  tbHover: true,            // the dock rests small and opens up on hover
  tbSize: 'm',              // dock size: 's' | 'm' | 'l'
  tbNp: true,               // now-playing pill (Dock + music)
  tbEq: true,               // equalizer behind the dock (Dock + music) / neon edge (Full-width bar)
  tbFloatEq: false,         // equalizer along the bottom (Floating dock): off unless switched on in Settings → Taskbar
  tbScreens: 'all',         // 'all' | 'main'
  tbPins: null,             // pinned apps [{ path, name, lnk }]; first time: copied from the Windows taskbar
  tbOrig: null,             // the Windows taskbar's own auto-hide setting while ours is on (to restore it, even after a crash)
  tbOrigLayout: null,       // { al, mode }: Windows' own taskbar alignment + search button while ours is on (see tbLayout)
  partyLights: { beams: true, glow: true, particles: true, albumArt: true },
  partyAwake: true,         // keep the display awake while partying
  posX: 0.5,                // 0 = left edge, 0.5 = centre, 1 = right edge (of the chosen display)
  posY: 0,                  // island shape only: 0 = top … 1 = as low as it can go
  sideMode: true,           // move to the right edge (vertical) while one of sideApps is active
  sideApps: [{ exe: 'chrome.exe', name: 'Google Chrome', path: '' }],
  gameMode: true,           // a game in front: the notch moves to the top-right corner and shows game stats
  gameAuto: true,           // spot games by itself (Windows' game list, game library folders, a question for unknown ones)
  gameQuiet: true,          // hold notification pop-ups while playing
  gameArtOnline: true,      // no poster in Steam's files on this PC: look it up on the Steam store (game name only)
  gameApps: [],             // always a game: [{ exe, name, path }]
  notGames: [],             // never a game: [{ exe, name, path }]
  sideFade: true,           // side mode: the resting pill is almost see-through until the mouse touches it
  sideFadeBg: 95,           // 0-100: how see-through the pill's background gets then (100 = gone)
  sideFadeFg: 85,           // 0-100: how see-through its icons / info get then (100 = gone)
  idleStats: { date: true, weather: true, cpu: true, ram: true, gpu: true, net: true, battery: true, alerts: true },   // idle pill
  idleMinimal: false,       // idle pill shows only sky + time + date + weather (+ urgent things); the rest on hover
  phoneWarned: false,       // user ticked "don't show the phone-drop warning again"
  accentCustom: '#a78bfa',  // used when accentMode is 'custom'
  vizPalette: 'accent',     // colours of equalizer / spectrum / sun / orb / sparks: 'accent' | preset | 'custom'
  vizCustom: ['#a78bfa', '#ff3787', '#40c8e0'],
  vizCustomCount: 3,        // how many of the custom colours are used (1-3)
  displayId: null,          // null = primary display
  notes: '',
  shelf: [],                // file paths kept on the shelf
  pomodoroWork: 25,
  pomodoroBreak: 5,
  searchOn: true,           // the search box (apps, files, maths, the web…) on a hotkey
  searchHotkey: 'Ctrl+Alt+Space',
  searchEngine: 'google',   // web searches from the box: google | bing | duckduckgo | brave | ecosia
  searchFiles: true,        // files and folders (Everything when it runs, else the Windows search index)
  searchClipboard: true,    // clipboard history in the results
  searchPreview: true,      // questions ("capital of india"): the search engine's answer page right in the box
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^﻿/, '')) }; } catch { /* first run */ }
if ('hideInFullscreen' in settings) {   // migrate v1.2 on/off setting (on was the default, so it becomes the new default)
  settings.fullscreenMode = settings.hideInFullscreen === false ? 'show' : 'dim';
  delete settings.hideInFullscreen;
}
delete settings.sideFadeOpacity;          // early build of side-mode fade: replaced by sideFadeBg / sideFadeFg
if (!['show', 'dim', 'hide'].includes(settings.fullscreenMode)) settings.fullscreenMode = DEFAULTS.fullscreenMode;
if ('artAccent' in settings) {   // migrate v1 setting
  if (settings.artAccent === false && settings.accentMode === 'auto') settings.accentMode = 'purple';
  delete settings.artAccent;
}
const zoom = () => [0.9, 1, 1.15, 1.3].includes(settings.scale) ? settings.scale : 1;
const winH = () => (settings.layout === 'stacked' ? STACK_H : WIN_H);   // css px

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) { console.error('save settings', e); }
  }, 300);
}

// ------------------------------------------------------------------ window
let win = null;
let tray = null;
let hitRect = { x: 0, y: 0, width: 0, height: 0 };
let hovering = false;
let userHidden = false;
let fullscreenDisplayId = null;   // the display a full-screen foreground app fills (null = none)
let fullscreenOn = false;         // that display is the notch's
let pickerOpen = false;

function targetDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => d.id === settings.displayId) || screen.getPrimaryDisplay();
}

// ---- where the notch sits
// The pill's centre ("anchor") can go almost to the screen's edges. The window itself always stays
// fully on that screen; the renderer slides the pill inside the window to the anchor, and keeps an
// opened panel inside the window (so near an edge the panel opens inward).
// Notch shape: glued to the top edge. Island shape: anywhere on screen (x and y).
const EDGE = 120;                       // css px: closest the pill's centre gets to a side edge
let anchorCss = WIN_W / 2;              // pill centre inside the window, css px (sent to the renderer)
const isIsland = () => settings.shape === 'island';
function xRange(d) { const m = EDGE * zoom(); return [d.bounds.x + m, d.bounds.x + d.bounds.width - m]; }
// Stacked stops at the taskbar, so a tall column never hides under it
function winHeight(d) {
  const room = settings.layout === 'stacked' ? d.workArea.y + d.workArea.height - d.bounds.y : d.bounds.height;
  return Math.min(Math.round(winH() * zoom()), room);
}
function yRange(d) { return [d.bounds.y, d.bounds.y + Math.max(0, d.bounds.height - winHeight(d))]; }
function placeAt(d, cx, y) {
  const z = zoom(), w = Math.round(WIN_W * z), h = winHeight(d);
  const x = Math.round(Math.max(d.bounds.x, Math.min(d.bounds.x + d.bounds.width - w, cx - w / 2)));
  const top = isIsland() ? Math.round(y ?? d.bounds.y) : d.bounds.y;
  win.setBounds({ x, y: top, width: w, height: h });
  anchorCss = (cx - x) / z;
  send('anchor', anchorCss);
}
// ---- side mode: while a chosen app (e.g. Chrome) is in front, sit vertically in the middle of the right edge
const SIDE_H = 720;
let sideActive = false;
let lastFg = null;
const recentApps = [];          // apps seen in front lately, for the picker in Settings
// taskbar, Start, Alt-Tab, tray overflow, menus: passing through these keeps the current mode
const SHELL_CLASSES = /^(Shell_TrayWnd|Shell_SecondaryTrayWnd|Windows\.UI\.Core\.CoreWindow|NotifyIconOverflowWindow|TopLevelWindowForOverflowXamlIsland|XamlExplorerHostIslandWindow|ForegroundStaging|MultitaskingViewFrame|#32768)$/;
const DESKTOP_CLASSES = /^(Progman|WorkerW)$/;      // the desktop itself: nothing maximized in front
let sideHwnd = 0;                                    // the window that sent us to the side (watched)
function onForeground(m) {
  const self = path.basename(process.execPath).toLowerCase();
  if (!m.exe || m.exe === self || SHELL_CLASSES.test(m.cls || '')) return;
  if (DESKTOP_CLASSES.test(m.cls || '')) { lastFg = null; evaluateGame(); evaluateSide(); return; }
  lastFg = m;
  const i = recentApps.findIndex(a => a.exe === m.exe);
  if (i >= 0) recentApps.splice(i, 1);
  recentApps.unshift({ exe: m.exe, name: m.name || m.exe, path: m.path || '' });
  if (recentApps.length > 14) recentApps.length = 14;
  evaluateGame();
  evaluateSide();
}
// The watched window was minimized, made smaller or closed: go back to the usual spot.
let sideTestNoWatch = false;
let snapFgLock = false;           // self-test only: the game steps fake the foreground app      // self-test only: the fake window it uses doesn't exist
function onTracked(msg) {
  if (sideTestNoWatch || !sideActive || msg.hwnd !== sideHwnd) return;
  if (msg.state === 3) return;                               // still maximized
  if (lastFg && lastFg.hwnd === sideHwnd) lastFg = { ...lastFg, max: false };
  evaluateSide();
}
function evaluateSide() {
  const m = lastFg;
  let on = false;
  // side mode only while a listed app is in front AND maximized, on the notch's screen
  // …but not while a full-screen app (a movie) fills that screen: then the notch stays at the top as a thin line
  const fsQuiet = fullscreenOn && settings.fullscreenMode !== 'show';
  if (m && m.max && !fsQuiet && !gameOn() && settings.sideMode && (settings.sideApps || []).some(a => a.exe === m.exe)) {
    const c = screen.screenToDipPoint({ x: Math.round((m.l + m.r) / 2), y: Math.round((m.t + m.b) / 2) });
    on = screen.getDisplayNearestPoint(c).id === targetDisplay().id;
  }
  const hwnd = on ? m.hwnd : 0;
  if (hwnd !== sideHwnd) { sideHwnd = hwnd; bridgeCmd(`track ${hwnd}`); }
  if (on === sideActive) return;
  sideActive = on;
  if (!app.isPackaged) console.log('[side]', on ? 'ON' : 'off', m ? `${m.exe} max=${m.max}` : '(desktop)');
  placeWindow();                                             // off → back to the saved position
  send('side', on);
}

// ---- game mode: a game in front -> the notch moves to the top-right corner and shows game stats
// A game is: on the user's list, in Windows' own game list (Game Bar remembers every game it saw), or
// installed in a game library folder. An unknown app that runs full screen and keeps the graphics
// card busy gets a question ("Is this a game?") instead of switching on by itself.
let windowsGames = new Set(), windowsGameExes = new Set();
const GAME_DIRS = /\\(steamapps\\common|epic games|xboxgames|gog galaxy\\games|gog games|riot games|battle\.net|ea games|origin games|ubisoft game launcher\\games|rockstar games|amazon games\\library)\\/i;
const LAUNCHERS = /^(steam|steamwebhelper|epicgameslauncher|epicwebhelper|battle\.net|riotclientservices|riotclientux|eadesktop|origin|galaxyclient|upc|ubisoftconnect|rockstarlauncher|launcher|xboxpcapp|gamebar|crashreportclient|unrealcefsubprocess)\.exe$/i;
let game = null;                 // the session: { exe, name, path, pid, start, peakGpu, gpuSum, gpuN, icon }
let gameShown = false;           // game mode is on screen (the game is in front)
let gameStartTimer = 0, gameEndTimer = 0, gameCandidate = null;
const gameOn = () => !!(game && gameShown);
const listed = (list, m) => (list || []).some(a => a.exe === m.exe);
function isGame(m) {
  if (!m || !m.exe || !settings.gameMode) return false;
  if (listed(settings.notGames, m)) return false;
  if (listed(settings.gameApps, m)) return true;
  if (!settings.gameAuto || LAUNCHERS.test(m.exe)) return false;
  const p = (m.path || '').toLowerCase();
  if (p) return windowsGames.has(p) || GAME_DIRS.test(p);
  return windowsGameExes.has(m.exe);                       // no path (a protected process): go by the exe name
}
function gamePayload() {
  if (!gameOn()) return null;
  return { exe: game.exe, name: game.name, path: game.path, start: game.start, icon: game.icon || null, poster: game.poster || null, hero: game.hero || null };
}
function gameNameOf(m) {
  const n = (m.name || '').trim();
  return n && n.toLowerCase() !== m.exe.replace(/\.exe$/i, '').toLowerCase() ? n : m.exe.replace(/\.exe$/i, '');
}
function evaluateGame() {
  const m = lastFg;
  if (isGame(m)) {
    clearTimeout(gameEndTimer); gameEndTimer = 0;
    if (game && game.exe === m.exe) {                         // back in the same game: carry on right away
      if (m.pid) game.pid = m.pid;
      if (!gameShown) showGame(true);
      return;
    }
    if (gameCandidate && gameCandidate.exe === m.exe) return;
    gameCandidate = m;
    clearTimeout(gameStartTimer);
    gameStartTimer = setTimeout(() => {                      // in front for a few seconds: it's really being played
      const c = gameCandidate; gameCandidate = null;
      if (!c || !lastFg || lastFg.exe !== c.exe) return;
      if (game) finishGame();                                // a different game: wrap up the old session
      game = { exe: c.exe, name: gameNameOf(c), path: c.path || '', pid: c.pid || 0, start: Date.now(), peakGpu: 0, gpuSum: 0, gpuN: 0, icon: null };
      showGame(true);
      const g = game;
      if (g.path) exeIcon(g.path).then(ic => { if (game === g && ic) { g.icon = ic; if (gameShown) send('game', gamePayload()); } }).catch(() => {});
      gameart.find({ exe: g.exe, path: g.path, name: g.name, online: settings.gameArtOnline !== false })      // the game's poster
        .then(a => { if (game === g && a && a.poster) { g.poster = a.poster; g.hero = a.hero; if (gameShown) send('game', gamePayload()); } });
    }, 3000);
    return;
  }
  gameCandidate = null; clearTimeout(gameStartTimer);
  if (game && !settings.gameMode) { clearTimeout(gameEndTimer); gameEndTimer = 0; game = null; showGame(false); return; }   // switched off
  if (gameShown && !gameEndTimer) {
    gameEndTimer = setTimeout(() => {                        // left the game for a while: back to the normal notch
      gameEndTimer = 0;
      showGame(false);
      if (!gameAlive()) finishGame();                        // closed (not just Alt-Tabbed away)
    }, 5000);
  }
}
function showGame(on) {
  if (gameShown === on) return;
  gameShown = on;
  if (!app.isPackaged) console.log('[game]', on ? `ON ${game && game.exe}` : 'off');
  evaluateSide();
  placeWindow();
  refreshVisibility();
  send('game', gamePayload());
}
function gameAlive() {
  if (!game || !game.pid) return false;
  try { process.kill(game.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }   // EPERM: alive, just not ours
}
function finishGame() {
  if (!game) return;
  const g = game;
  game = null;
  if (gameShown) showGame(false);
  send('game-summary', { name: g.name, icon: g.icon || null, poster: g.poster || null, ms: Date.now() - g.start, peakGpu: g.peakGpu, avgGpu: g.gpuN ? Math.round(g.gpuSum / g.gpuN) : null });
}
// a paused session (Alt-Tabbed away) ends once the game is closed
setInterval(() => { if (game && !gameShown && !gameEndTimer && !gameAlive()) finishGame(); }, 5000);

// unknown app, full screen on the notch's screen, graphics card busy for a while -> ask once
let askAcc = 0, askExe = '';
const askedExes = new Set();
function onGameGpu(g, fgUtil) {
  if (gameOn() && g) { game.peakGpu = Math.max(game.peakGpu, g.util); game.gpuSum += g.util; game.gpuN++; }
  const m = lastFg;
  const unknown = m && m.exe && settings.gameMode && settings.gameAuto && !gameOn() && !gameCandidate && !isGame(m) &&
    !askedExes.has(m.exe) && !LAUNCHERS.test(m.exe);
  if (!unknown || !fullscreenOn || fgUtil < 40) { askAcc = 0; askExe = ''; return; }
  if (askExe !== m.exe) { askExe = m.exe; askAcc = 0; }
  if (++askAcc < 12) return;                                 // about 15 s of steady load
  askedExes.add(m.exe);
  askAcc = 0;
  exeIcon(m.path).catch(() => null).then(ic => send('game-ask', { exe: m.exe, name: gameNameOf(m), path: m.path || '', icon: ic || null }));
}
ipcMain.on('game-answer', (_e, a) => {
  if (!a || typeof a.exe !== 'string') return;
  const entry = { exe: a.exe, name: String(a.name || a.exe), path: String(a.path || '') };
  const strip = list => (list || []).filter(x => x.exe !== entry.exe);
  settings.gameApps = a.game ? [...strip(settings.gameApps), entry] : strip(settings.gameApps);
  settings.notGames = a.game ? strip(settings.notGames) : [...strip(settings.notGames), entry];
  saveSettings();
  send('settings', settings);
  if (!a.game && game && game.exe === entry.exe) { clearTimeout(gameEndTimer); gameEndTimer = 0; game = null; showGame(false); }   // "not a game": stop now, no summary
  evaluateGame();
});

function placeWindow() {
  if (!win || dragTimer) return;
  const d = targetDisplay();
  if (gameOn()) {                                            // gaming: top-right corner (the renderer keeps the pill inside)
    placeAt(d, d.bounds.x + d.bounds.width, d.bounds.y + (isIsland() ? Math.round(8 * zoom()) : 0));
    return;
  }
  if (sideActive) {
    const z = zoom(), w = Math.round(WIN_W * z);
    if (settings.layout === 'stacked') {                     // the tall column: centred in the work area
      const a = d.workArea, h = Math.round(Math.min(STACK_H * z, a.height));
      win.setBounds({ x: d.bounds.x + d.bounds.width - w, y: Math.round(a.y + (a.height - h) / 2), width: w, height: h });
      return;
    }
    const h = Math.round(Math.min(SIDE_H * z, d.bounds.height));
    win.setBounds({ x: d.bounds.x + d.bounds.width - w, y: Math.round(d.bounds.y + (d.bounds.height - h) / 2), width: w, height: h });
    return;
  }
  const [x0, x1] = xRange(d), [y0, y1] = yRange(d);
  const fx = Math.max(0, Math.min(1, Number.isFinite(settings.posX) ? settings.posX : 0.5));
  const fy = Math.max(0, Math.min(1, Number.isFinite(settings.posY) ? settings.posY : 0));
  placeAt(d, x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy);
}

// ---- dragging: along the top (notch) or anywhere (island), onto any screen
let dragTimer = null, dragGrabX = 0, dragGrabY = 0, dragDisplay = null, dragCx = 0, dragY = 0;
function pillCenterX() { return win.getBounds().x + anchorCss * zoom(); }
function dragStart() {
  if (!win || dragTimer || sideActive || gameOn()) return;   // side mode and game mode have a fixed spot
  const p = screen.getCursorScreenPoint();
  dragGrabX = p.x - pillCenterX();
  dragGrabY = p.y - win.getBounds().y;
  dragDisplay = targetDisplay();
  send('drag-state', true);
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    const [x0, x1] = xRange(d), [y0, y1] = yRange(d);
    let cx = Math.max(x0, Math.min(x1, p.x - dragGrabX));
    const mid = d.bounds.x + d.bounds.width / 2;
    if (Math.abs(cx - mid) < 24 * zoom()) cx = mid;            // gentle snap to the middle
    let y = Math.max(y0, Math.min(y1, p.y - dragGrabY));
    if (y - y0 < 24 * zoom()) y = y0;                            // …and to the top
    dragDisplay = d; dragCx = cx; dragY = y;
    placeAt(d, cx, y);
  }, 16);
}
function dragEnd() {
  if (!dragTimer) return;
  clearInterval(dragTimer);
  dragTimer = null;
  send('drag-state', false);
  const d = dragDisplay || targetDisplay();
  const [x0, x1] = xRange(d), [y0, y1] = yRange(d);
  settings.displayId = d.id;
  settings.posX = x1 > x0 ? Math.round(((dragCx - x0) / (x1 - x0)) * 1000) / 1000 : 0.5;
  settings.posY = isIsland() && y1 > y0 ? Math.round(((dragY - y0) / (y1 - y0)) * 1000) / 1000 : 0;
  saveSettings();
  send('settings', settings);
  refreshVisibility();             // full-screen state + the equalizer follow the notch to its screen
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function applyScale() {
  if (!win) return;
  win.webContents.setZoomFactor(zoom());
  placeWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: winH(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'NotchMine',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  placeWindow();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); });
  win.webContents.on('did-finish-load', applyScale);
  win.on('blur', () => send('blur'));
  // Keep links/popups out of the notch
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (!app.isPackaged) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[renderer] ${message} (${path.basename(source)}:${line})`);
    });
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (channel === 'settings') sendSettingsWin('settings', payload);   // the settings window mirrors every change
}

// ------------------------------------------------------------------ settings window
// Its own normal window (renderer/settings.html), so the notch stays light and there's room for more options.
// Opened from the notch's gear or the tray. Changes made here go through 'settings-set' like any other.
let setWin = null;
function sendSettingsWin(channel, payload) {
  if (setWin && !setWin.isDestroyed()) setWin.webContents.send(channel, payload);
}
function openSettings(sec) {
  if (setWin && !setWin.isDestroyed()) {
    if (setWin.isMinimized()) setWin.restore();
    setWin.show();
    setWin.focus();
    if (sec) sendSettingsWin('settings-goto', sec);
    return setWin;
  }
  const wa = targetDisplay().workArea;
  const width = Math.min(940, wa.width - 40), height = Math.min(660, wa.height - 40);
  setWin = new BrowserWindow({
    width, height, minWidth: 680, minHeight: 460,
    x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2),
    show: false, title: 'NotchMine Settings', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#141417',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#141417', symbolColor: '#e8e8ee', height: 40 },
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  setWin.removeMenu();
  setWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), sec ? { query: { sec } } : undefined);
  setWin.once('ready-to-show', () => { if (setWin && !setWin.isDestroyed()) setWin.show(); });
  setWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  setWin.webContents.on('will-navigate', e => e.preventDefault());
  if (!app.isPackaged) {
    setWin.webContents.on('console-message', (_e, level, message, line, source) => {
      if (level >= 2) console.log(`[settings] ${message} (${path.basename(source)}:${line})`);
    });
  }
  setWin.on('closed', () => { setWin = null; });
  return setWin;
}
ipcMain.on('open-settings', (_e, sec) => openSettings(typeof sec === 'string' ? sec : ''));
ipcMain.handle('settings-init', () => ({ settings, weather: lastWx, accent: lastAccent, version: app.getVersion() }));

function setVisible(visible) {
  if (!win) return;
  if (visible && !win.isVisible()) { win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); }
  if (!visible && win.isVisible()) win.hide();
}
function refreshVisibility() {
  fullscreenOn = fullscreenDisplayId !== null && fullscreenDisplayId === targetDisplay().id;
  evaluateSide();                                           // side mode steps aside during full-screen (no-op if unchanged)
  setVisible(!userHidden && !partyWins.length && !(fullscreenOn && settings.fullscreenMode === 'hide' && !gameOn()));
  send('fullscreen', fullscreenOn && settings.fullscreenMode === 'dim' && !gameOn());   // renderer fades to a thin line
  syncDeskEq();
  syncAmbient();
  wpPauseSync();
  dockVisibility();
}
function onFullscreen(msg) {
  let id = null;
  const m = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/.exec(msg.monitor || '');
  if (msg.value && m) {
    const [l, t, r, b] = m.slice(1).map(Number);
    try { id = screen.getDisplayMatching(screen.screenToDipRect(null, { x: l, y: t, width: r - l, height: b - t })).id; }
    catch { id = targetDisplay().id; }
  } else if (msg.value) id = targetDisplay().id;            // older bridge: no monitor info
  if (!app.isPackaged) console.log('[fullscreen]', msg.value ? `ON display ${id} (notch on ${targetDisplay().id})` : 'off', `mode=${settings.fullscreenMode}`);
  // NotchMine's own windows in front (clicking the notch, or Windows focusing it when a full-screen browser is
  // minimized) don't count either way: the bridge skips them (ForegroundFullscreenMonitor), so 'off' is real.
  fullscreenDisplayId = id;
  refreshVisibility();
}

// ------------------------------------------------------------------ desktop equalizer (click-through bars along the bottom)
let eqWins = [];               // { win, displayId }
const EQ_FRAC = 0.42;          // window height as a share of the screen (bars use part of it, per the Height setting)
function eqBounds(d) {
  const h = Math.round(d.bounds.height * EQ_FRAC);
  const bottom = settings.deskEqPos === 'bottom' ? d.bounds.y + d.bounds.height : d.workArea.y + d.workArea.height;
  return { x: d.bounds.x, y: bottom - h, width: d.bounds.width, height: h };
}
function syncDeskEq() {
  if (!app.isReady()) return;
  const want = settings.deskEq && !partyWins.length && !gameOn() && !(fullscreenDisplayId !== null && settings.fullscreenMode !== 'show');
  const displays = !want ? [] : settings.deskEqScreens === 'all' ? screen.getAllDisplays() : [targetDisplay()];
  const ids = new Set(displays.map(d => d.id));
  for (const e of eqWins.slice()) {
    if (!ids.has(e.displayId) && !e.win.isDestroyed()) e.win.close();
  }
  eqWins = eqWins.filter(e => ids.has(e.displayId) && !e.win.isDestroyed());
  for (const d of displays) {
    const have = eqWins.find(e => e.displayId === d.id);
    if (have) { have.win.setBounds(eqBounds(d)); continue; }
    const w = new BrowserWindow({
      ...eqBounds(d), frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, title: 'NotchMine Equalizer',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    w.setIgnoreMouseEvents(true);                    // never blocks the mouse
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'renderer', 'deskeq.html'));
    w.once('ready-to-show', () => { w.setBounds(eqBounds(d)); w.showInactive(); });
    eqWins.push({ win: w, displayId: d.id });
  }
}
// Clicking the taskbar (or Start, a tray icon…) lifts it to the top of the always-on-top windows, so with
// Position = Bottom of screen it would cover the bars until the equalizer restarts. Lift the bars back over it:
// right after the foreground changes, and every moment in between (it's one cheap window call per screen).
function raiseDeskEq() {
  for (const e of eqWins) {
    if (e.win.isDestroyed() || !e.win.isVisible()) continue;
    e.win.setAlwaysOnTop(true, 'screen-saver');
    e.win.moveTop();
  }
}
setInterval(() => { if (eqWins.length && settings.deskEqPos === 'bottom') raiseDeskEq(); }, 700);

// ------------------------------------------------------------------ ambient screen (Settings → Ambient)
// A movie (any full-screen app) on one screen colours the others. renderer/ambient.html captures that screen at a
// tiny size, works out its colours scene by scene and paints them, plus an equalizer to the sound, across each other
// screen. Click-through, and it fades away while the mouse is on its screen. Needs two or more screens.
let ambWins = [];                // { win, displayId, info, peek }
let ambPreviewUntil = 0, ambPreviewT = 0, ambSeq = 0, ambPeekT = 0;
function ambSource() {
  const all = screen.getAllDisplays();
  if (all.length < 2 || partyWins.length) return null;
  if (Date.now() < ambPreviewUntil) {            // Preview: the screen the Settings window is on colours the others
    return setWin && !setWin.isDestroyed() ? screen.getDisplayMatching(setWin.getBounds()) : screen.getPrimaryDisplay();
  }
  if (!settings.ambient || (gameOn() && !settings.ambGames)) return null;
  if (fullscreenDisplayId !== null) return all.find(d => d.id === fullscreenDisplayId) || null;
  return settings.ambTrigger === 'always' ? screen.getPrimaryDisplay() : null;
}
// where the movie screen is, seen from screen d: its colours spill in from that edge
function ambSide(d, src) {
  const dx = (src.bounds.x + src.bounds.width / 2) - (d.bounds.x + d.bounds.width / 2);
  const dy = (src.bounds.y + src.bounds.height / 2) - (d.bounds.y + d.bounds.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
}
async function syncAmbient() {
  if (!app.isReady()) return;
  const seq = ++ambSeq;
  const src = ambSource();
  const targets = src ? screen.getAllDisplays().filter(d => d.id !== src.id) : [];
  let sourceId = '';
  if (targets.length) {
    try {
      const list = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const hit = list.find(x => String(x.display_id) === String(src.id));
      sourceId = hit ? hit.id : '';
      if (!hit && !app.isPackaged) console.warn('[ambient] no capture source for display', src.id);
    } catch (e) { console.warn('[ambient] screen sources:', e.message); }
    if (seq !== ambSeq) return;                // a newer sync is on its way
  }
  const want = sourceId ? targets : [];
  const ids = new Set(want.map(d => d.id));
  for (const e of ambWins) if (!ids.has(e.displayId) && !e.win.isDestroyed()) e.win.destroy();
  ambWins = ambWins.filter(e => ids.has(e.displayId) && !e.win.isDestroyed());
  const preview = Date.now() < ambPreviewUntil;
  for (const d of want) {
    const info = { sourceId, side: ambSide(d, src), preview };
    const have = ambWins.find(e => e.displayId === d.id);
    if (have) {
      have.win.setBounds(d.bounds);
      if (JSON.stringify(have.info) !== JSON.stringify(info)) { have.info = info; have.win.webContents.send('amb-src', info); }
      continue;
    }
    const w = new BrowserWindow({
      ...d.bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
      minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      show: false, title: 'NotchMine Ambient',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    w.setIgnoreMouseEvents(true);                    // never blocks the mouse
    w.setAlwaysOnTop(true, 'screen-saver');
    if (!app.isPackaged) w.webContents.on('console-message', (_ev, level, message) => console.log(message.startsWith('[ambient]') ? message : `[ambient ${d.id}] ${message}`));
    w.loadFile(path.join(__dirname, 'renderer', 'ambient.html'));
    w.once('ready-to-show', () => {
      w.setBounds(d.bounds);
      w.showInactive();
      if (win && !win.isDestroyed() && win.isVisible()) win.moveTop();   // the notch stays on top of it
    });
    const rec = { win: w, displayId: d.id, info, peek: false };
    w.on('closed', () => { ambWins = ambWins.filter(x => x !== rec); });
    ambWins.push(rec);
  }
  if (ambWins.length && !ambPeekT) ambPeekT = setInterval(ambPeek, 200);
  if (!ambWins.length && ambPeekT) { clearInterval(ambPeekT); ambPeekT = 0; }
  wpPauseSync();
}
// the mouse on an ambient screen: it fades away so that screen can be used (it is click-through anyway)
function ambPeek() {
  const at = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  for (const e of ambWins) {
    if (e.win.isDestroyed()) continue;
    const peek = settings.ambPeek !== false && !e.info.preview && at === e.displayId;
    if (peek !== e.peek) { e.peek = peek; e.win.webContents.send('amb-peek', peek); wpPauseSync(); }
  }
}
ipcMain.handle('amb-init', e => {
  const rec = ambWins.find(x => !x.win.isDestroyed() && x.win.webContents === e.sender);
  return { settings, accent: lastAccent, media: lastState.media || null, ...(rec ? rec.info : {}), peek: rec ? rec.peek : false, dev: !app.isPackaged };
});
ipcMain.on('amb-preview', () => {                // Settings → Ambient → Preview: 20 seconds
  if (screen.getAllDisplays().length < 2) return;
  ambPreviewUntil = Date.now() + 20000;
  clearTimeout(ambPreviewT);
  ambPreviewT = setTimeout(() => { ambPreviewUntil = 0; syncAmbient(); }, 20100);
  syncAmbient();
});

// ------------------------------------------------------------------ party mode (full-screen light show)
let partyWins = [];
let partyBlocker = null;
let lastAccent = '167, 139, 250';
function sendParty(channel, payload) {      // party screens + desktop equalizer windows (+ the wallpaper host)
  for (const w of partyWins) if (!w.isDestroyed()) w.webContents.send(channel, payload);
  for (const e of eqWins) if (!e.win.isDestroyed()) e.win.webContents.send(channel, payload);
  for (const e of ambWins) if (!e.win.isDestroyed()) e.win.webContents.send(channel, payload);
  if (channel === 'settings') wpHostSend({ type: 'settings', settings: payload });
}

// ------------------------------------------------------------------ live wallpaper (behind the desktop icons)
// One window per screen running renderer/wallpaper.html, hosted by a separate process (wallhost.js explains why:
// a window behind the icons shares its input with Explorer, so it must never belong to this busy process).
// The host creates them off-screen, then the bridge makes each a child of the desktop right below the icons
// (Desk.Attach in bridge.ps1). A wallpaper stops drawing while its screen is covered. While the wallpaper is on,
// the bridge also watches the desktop and the taskbar: if they stop responding, the wallpaper switches itself off.
let wpHost = null;             // the host process while the wallpaper is on
const wpRecs = new Map();      // display id → { hwnd, attached }
let wpPausedMap = {};
let wpRestarts = 0;            // host crashes in a row (gives up after 3)
let lastWx = null;             // the weather the notch last reported (Automatic follows it)
let fgMaxDisplay = null;       // the screen the active maximized window covers
function wpDisplays() {
  if (!settings.wpOn) return [];
  return settings.wpScreens === 'notch' ? [targetDisplay()] : screen.getAllDisplays();
}
function wpPausedFor(id) {
  if (partyWins.length) return true;                          // party mode covers the screens anyway
  if (ambWins.some(e => e.displayId === id && !e.peek)) return true;   // the ambient screen covers it
  if (settings.wpPauseFs === false) return false;
  return gameOn() || fullscreenDisplayId === id || fgMaxDisplay === id;
}
// messages go over a private named pipe (an Electron process on Windows has no usable stdin); queued until it connects
function wpHostSend(m) {
  if (!wpHost) return;
  const line = JSON.stringify(m) + '\n';
  if (wpHost.sock && !wpHost.sock.destroyed) { try { wpHost.sock.write(line); } catch { /* host gone */ } }
  else wpHost.queue.push(line);
}
function wpPauseSync() {
  if (!wpHost) return;
  const map = {};
  for (const d of wpDisplays()) map[d.id] = wpPausedFor(d.id);
  if (JSON.stringify(map) === JSON.stringify(wpPausedMap)) return;
  wpPausedMap = map;
  wpHostSend({ type: 'paused', map });
}
function startWpHost() {
  const pipe = `\\\\.\\pipe\\notchmine-wallpaper-${process.pid}-${Date.now()}`;
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), '--nm-wallpaper-host', `--nm-pipe=${pipe}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const h = spawn(process.execPath, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  h.queue = [];
  h.server = net.createServer(sock => {
    if (h.sock || wpHost !== h) { sock.destroy(); return; }    // only the one host we started
    h.sock = sock;
    for (const line of h.queue.splice(0)) sock.write(line);
    let buf = '';
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (wpHost === h) onWpHost(m);
      }
    });
    sock.on('error', () => { /* the host went away: 'exit' handles it */ });
  });
  h.server.listen(pipe);
  wpHost = h;
  wpPausedMap = {};
  h.stderr.on('data', d => {
    const s = String(d).trim();
    if (!app.isPackaged && s && !/cache_util|disk_cache|gpu_|Autofill/i.test(s)) console.log('[wallpaper host]', s);
  });
  h.on('error', err => console.warn('[wallpaper] host could not start:', err.message));
  h.on('exit', code => {
    try { h.server.close(); } catch { /* closed */ }
    if (wpHost !== h) return;                                  // stopped on purpose
    wpHost = null; wpRecs.clear(); wpPausedMap = {};
    bridgeCmd('wp watch off');
    bridgeCmd('wp refresh');
    console.warn('[wallpaper] host exited', code);
    if (settings.wpOn && ++wpRestarts <= 3) setTimeout(() => syncWallpaper(), 3000);
  });
  wpHostSend({ type: 'settings', settings });
  wpHostSend({ type: 'weather', weather: lastWx });
  if (settings.wpBack === 'mine') syncMyWallpaper(true);
}
function stopWpHost() {
  const h = wpHost;
  if (!h) return;
  wpHost = null; wpRecs.clear(); wpPausedMap = {};
  bridgeCmd('wp watch off');
  try { if (h.sock && !h.sock.destroyed) h.sock.write(JSON.stringify({ type: 'quit' }) + '\n'); } catch { /* gone */ }
  setTimeout(() => { try { h.kill(); } catch { /* gone */ } try { h.server.close(); } catch { /* closed */ } }, 1500);
  setTimeout(() => bridgeCmd('wp refresh'), 300);             // the normal wallpaper shows again at once
}
function syncWallpaper(rebuild) {
  if (!app.isReady()) return;
  const displays = wpDisplays();
  if (!displays.length) { stopWpHost(); return; }
  if (!wpHost) startWpHost();
  let removed = false;
  for (const id of [...wpRecs.keys()]) {
    if (!rebuild && displays.some(d => d.id === id)) continue;
    wpHostSend({ type: 'close', id }); wpRecs.delete(id); removed = true;
  }
  if (removed) setTimeout(() => bridgeCmd('wp refresh'), 200);
  wpHostSend({ type: 'displays', list: displays.map(d => ({ id: d.id, bounds: d.bounds })) });
  wpPauseSync();
}
function onWpHost(m) {
  switch (m.type) {
    case 'hwnd': {
      wpRecs.set(m.id, { hwnd: String(m.hwnd), attached: false });
      const r = m.rect || {};
      bridgeCmd(`wp attach ${m.hwnd} ${Math.round(r.x)} ${Math.round(r.y)} ${Math.round(r.width)} ${Math.round(r.height)}`);
      break;
    }
    case 'closed':                     // not closed by us: Explorer restarted and took it. Come back once it's up.
      wpRecs.delete(m.id);
      setTimeout(() => syncWallpaper(), 3000);
      break;
    case 'log': if (!app.isPackaged) console.log(m.message); break;
  }
}
function onWpAttached(m) {
  const id = [...wpRecs.entries()].find(([, r]) => r.hwnd === String(m.hwnd))?.[0];
  if (id === undefined) return;
  if (m.mode) {
    wpRecs.get(id).attached = true;
    wpRestarts = 0;
    bridgeCmd('wp watch on');
    if (!app.isPackaged) console.log('[wallpaper] placed behind the icons:', m.mode);
    return;
  }
  console.warn('[wallpaper] could not place it behind the desktop icons');
  wpHostSend({ type: 'close', id });
  wpRecs.delete(id);
}
// the bridge saw the desktop or the taskbar stop responding while the wallpaper was on: switch it off for good
function onWpHang(m) {
  if (!wpHost) return;
  console.warn('[wallpaper] the desktop stopped responding (' + (m.what || '?') + '): switching the live wallpaper off');
  const h = wpHost;
  stopWpHost();
  try { h.kill(); } catch { /* gone */ }                      // at once: that's what frees Explorer
  settings.wpOn = false;
  saveSettings();
  send('settings', settings);
  if (tray) tray.setContextMenu(buildTrayMenu());
  send('notif', { id: Date.now(), app: 'NotchMine', title: 'Live wallpaper switched off', body: 'The desktop stopped responding while it was on. You can turn it back on in Settings → Wallpaper.', time: Date.now(), icon: null });
}
// the active window changed: a maximized one hides the wallpaper on its screen
function wpForeground(m) {
  const self = path.basename(process.execPath).toLowerCase();
  if (m.exe === self || SHELL_CLASSES.test(m.cls || '')) return;     // the notch, the taskbar… change nothing
  if (DESKTOP_CLASSES.test(m.cls || '') || !m.max) fgMaxDisplay = null;
  else fgMaxDisplay = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: (m.l + m.r) / 2, y: (m.t + m.b) / 2 })).id;
  wpPauseSync();
}

// ---- "My wallpaper" (Settings → Wallpaper → Background): your own Windows wallpaper behind the live effects.
// Found in the registry (or Windows' own copy of it); the host process decodes and scales it. Checked again every
// 30 s, so changing the wallpaper in Windows follows along. Here only a small preview is made, for Settings.
let myWp = { key: null, thumb: null, path: null };
function myWallpaperPath() {
  return new Promise(res => execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, out) => {
    const m = !err && /WallPaper\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(out || '');
    const p = m && m[1].trim();
    if (p && fs.existsSync(p)) return res(p);
    const t = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
    res(fs.existsSync(t) ? t : null);
  }));
}
async function loadMyWallpaper() {                   // true when the picture changed
  const p = await myWallpaperPath();
  let key = '';
  try { key = p ? `${p}|${fs.statSync(p).mtimeMs}` : ''; } catch { /* gone */ }
  if (key === myWp.key) return false;
  let thumb = null;
  if (p) {
    try { thumb = (await nativeImage.createThumbnailFromPath(p, { width: 320, height: 200 })).toDataURL(); } catch {
      try { const img = nativeImage.createFromBuffer(fs.readFileSync(p)); if (!img.isEmpty()) thumb = img.resize({ width: 320 }).toDataURL(); } catch { /* unreadable */ }
    }
  }
  myWp = { key, thumb, path: p };
  return true;
}
async function syncMyWallpaper(force) {
  const want = settings.wpOn && settings.wpBack === 'mine';
  const changed = want ? await loadMyWallpaper() : false;
  if (force || changed) wpHostSend(want && myWp.path ? { type: 'bg', path: myWp.path, key: myWp.key } : { type: 'bg' });
  if (changed) sendSettingsWin('my-wallpaper', { path: myWp.path, thumb: myWp.thumb });
}
setInterval(() => { if (wpHost && settings.wpBack === 'mine') syncMyWallpaper(); }, 30000);
ipcMain.handle('my-wallpaper', async () => { await loadMyWallpaper(); return { path: myWp.path, thumb: myWp.thumb }; });
ipcMain.on('weather-report', (_e, w) => {
  lastWx = w && typeof w.code === 'number' ? { code: w.code, isDay: w.isDay !== false, text: typeof w.text === 'string' ? w.text.slice(0, 60) : '' } : null;
  wpHostSend({ type: 'weather', weather: lastWx });
  sendSettingsWin('wp-weather', lastWx);
  dockPush();
});

// ------------------------------------------------------------------ NotchMine taskbar (the dock)
// Settings → Taskbar. With a NotchMine style the Windows taskbar is hidden (bridge: Bar.Hide) and one dock window
// per screen (renderer/dock.html) sits along the bottom: see-through and click-through except the dock itself.
// The dock registers as an app bar, so maximized windows stop above it. Going back to 'windows' (the button,
// Ctrl+Alt+T, the tray menu) restores the Windows taskbar exactly as it was; if NotchMine quits or crashes,
// the bridge restores it by itself (and the next start does too, from tbOrig).
const TB_CUSTOM = ['dockeq', 'dock', 'bar'];
const DOCK_WIN_H = 360;                                          // the window: the dock + room for the window list on hover
const DOCK_RESERVE = { dockeq: 64, dock: 64, bar: 48 };          // the strip maximized windows leave free (DIP)
let dockWins = [];               // { win, displayId, hwnd, reserved }
let tasks = [];                  // open windows, from the bridge
let fgHwnd = null;               // the active window
let tbApplied = false;           // the Windows taskbar is hidden by us
const tbCustom = () => TB_CUSTOM.includes(settings.tbStyle);

// pinned apps: the first time (and on Settings → Taskbar → Copy from Windows taskbar), the same ones in the same
// order as on the Windows taskbar. Normal programs have a shortcut in the "User Pinned\TaskBar" folder; Store apps
// (WhatsApp, Teams, Microsoft Store…) have none: they're only in Windows' own pin list (Taskband\Favorites in the
// registry), which also holds the order. A Store app pin is { aumid, id, name }; it opens through shell:AppsFolder.
const PKG_AUMID = /^[A-Za-z0-9][A-Za-z0-9.\-]*_[a-z0-9]{13}![A-Za-z0-9.\-]+$/;   // a Store app's app ID
function pinsFromFolder() {
  const dir = path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const pins = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.lnk')) continue;
      const lnk = path.join(dir, f);
      try {
        const t = shell.readShortcutLink(lnk);
        // File Explorer's shortcut has no target file, only its icon (explorer.exe)
        const icon = (t.icon || '').replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);
        const target = t.target || (/\.exe$/i.test(icon) ? icon : '');
        if (target && fs.existsSync(target)) pins.push({ path: target, name: f.slice(0, -4), lnk });
      } catch { /* a broken shortcut */ }
    }
  } catch { /* no pinned folder */ }
  return pins;
}
let pinImport = null;
function importWindowsPins() {
  if (pinImport) return pinImport;
  const files = pinsFromFolder();
  const reg = new Promise(res => execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Taskband', '/v', 'Favorites'],
    { windowsHide: true, maxBuffer: 4 << 20 }, (err, out) => res(!err && /Favorites\s+REG_BINARY\s+([0-9A-F]+)/i.exec(out || ''))));
  // the Store apps' names, as Start shows them
  const names = new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-StartApps | ConvertTo-Json -Compress'],
    { windowsHide: true, maxBuffer: 8 << 20, timeout: 20000 }, (err, out) => {
      const map = new Map();
      try { for (const a of [].concat(JSON.parse(out))) if (a && a.AppID) map.set(String(a.AppID).toLowerCase(), String(a.Name || '')); } catch { /* none */ }
      res(map);
    }));
  pinImport = Promise.all([reg, names]).then(([hex, nameOf]) => {
    // the list is binary; names and app IDs sit in it as UTF-16 text, in pin order (at either byte alignment)
    const found = [];
    if (hex) {
      const buf = Buffer.from(hex[1], 'hex');
      for (const off of [0, 1]) {
        const s = buf.subarray(off).toString('utf16le');
        for (const m of s.matchAll(/[A-Za-z0-9][A-Za-z0-9.\-]*_[a-z0-9]{13}![A-Za-z0-9.\-]+/g)) found.push({ at: m.index * 2 + off, aumid: m[0] });
        for (const f of files) { const i = s.indexOf(path.basename(f.lnk)); if (i >= 0) found.push({ at: i * 2 + off, file: f }); }
      }
    }
    found.sort((a, b) => a.at - b.at);
    const pins = [], seen = new Set();
    for (const o of found) {
      const k = o.aumid ? 'id:' + o.aumid.toLowerCase() : o.file.lnk;
      if (seen.has(k)) continue;
      seen.add(k);
      if (o.file) { pins.push(o.file); continue; }
      const name = nameOf.get(o.aumid.toLowerCase()) || o.aumid.replace(/^[^.]*\./, '').replace(/_.*$/, '').replace(/Desktop$/, '');
      pins.push({ aumid: o.aumid, id: o.aumid, name, path: '' });
    }
    for (const f of files) if (!seen.has(f.lnk)) pins.push(f);       // a shortcut the list doesn't name: at the end
    settings.tbPins = pins;
    settings.tbPinsV = 3;
    saveSettings();
    if (!app.isPackaged) console.log('[dock] pinned apps from the Windows taskbar:', pins.map(p => p.name).join(', '));
    pinImport = null;
    dockPush();
    return pins;
  }).catch(e => { pinImport = null; console.warn('[dock] could not read the Windows taskbar pins:', e.message); });
  return pinImport;
}
function tbPins() {
  if (Array.isArray(settings.tbPins) && settings.tbPinsV === 3) return settings.tbPins;
  importWindowsPins();                                              // until it's read: the shortcut files alone
  return Array.isArray(settings.tbPins) ? settings.tbPins : pinsFromFolder();
}
// one pin (to remove it): Store apps by app ID, programs by shortcut + exe
const pinKey = p => p.aumid ? 'id:' + p.aumid.toLowerCase() : `${p.lnk || ''}|${appKey(p.path)}`;
// open an app: its shortcut, a Store app through Windows' app list, else the exe
function launchApp(x) {
  if (x.lnk && fs.existsSync(x.lnk)) { shell.openPath(x.lnk); return; }
  const aumid = x.aumid || (PKG_AUMID.test(x.id || '') ? x.id : '');
  if (aumid) { spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return; }
  shell.openPath(x.path);
}
// Windows puts windows on taskbar buttons by "app ID" (Chrome profiles and web apps each get their own); the
// bridge reads it for windows (tasks) and for pinned shortcuts (asked once each, below)
const lnkIds = new Map();        // shortcut → app ID ('' = none), undefined while asking
const idWait = new Map();
let idSeq = 0;
function pinId(p) {
  if (!p.lnk) return p.id || '';                                 // pinned from the dock: remembered with it
  if (!lnkIds.has(p.lnk)) {
    lnkIds.set(p.lnk, '');
    const id = 'a' + (++idSeq); idWait.set(id, p.lnk);
    bridgeCmd(`aumid ${id} ${p.lnk}`);
  }
  return lnkIds.get(p.lnk) || '';
}
function onAumid(m) {
  const lnk = idWait.get(m.id);
  if (!lnk) return;
  idWait.delete(m.id);
  lnkIds.set(lnk, String(m.value || ''));
  dockPush();
}
const appKey = p => (p || '').toLowerCase();
const prettyName = p => path.basename(p || '', '.exe').replace(/^./, c => c.toUpperCase());
// NotchMine's Settings window on the dock (see dockApps): its handle as the bridge writes it, and its icon
const OWN_SETTINGS = 'own:settings';
function settingsHwnd() {
  if (!setWin || setWin.isDestroyed()) return '';
  try { const b = setWin.getNativeWindowHandle(); return String(b.length >= 8 ? b.readBigInt64LE(0) : b.readInt32LE(0)); } catch { return ''; }
}
let ownIcon;
function ownIconUrl() {
  if (ownIcon === undefined) {
    try { const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')); ownIcon = img.isEmpty() ? null : img.resize({ width: 48, height: 48, quality: 'best' }).toDataURL(); } catch { ownIcon = null; }
  }
  return ownIcon;
}
// the apps the dock shows: pinned first (in order), then the other running ones; each with its windows
function dockApps() {
  const pins = tbPins();
  const apps = pins.map(p => {
    const id = pinId(p);
    return { key: id ? 'id:' + id.toLowerCase() : appKey(p.path), id, name: p.name, path: p.path, lnk: p.lnk, aumid: p.aumid, pinned: true, windows: [] };
  });
  const self = appKey(process.execPath);
  const setHwnd = settingsHwnd();
  for (const t of tasks) {
    // NotchMine's own windows (also another copy of it) stay off the dock, except Settings: a normal window that
    // can be minimized, so it needs a button to come back from
    if (setHwnd && t.hwnd === setHwnd) {
      apps.push({ key: OWN_SETTINGS, id: '', name: 'NotchMine Settings', path: '', own: true, pinned: false, windows: [{ hwnd: t.hwnd, title: t.title, min: t.min }] });
      continue;
    }
    if (t.pid === process.pid || !t.path) continue;
    if (appKey(t.path) === self) continue;
    const id = t.aumid || '';
    const k = id ? 'id:' + id.toLowerCase() : appKey(t.path);
    let a = apps.find(x => x.key === k);
    // no app ID of its own (File Explorer, many classic apps): it belongs to the pinned app with the same exe
    if (!a && !id) a = apps.find(x => x.pinned && appKey(x.path) === appKey(t.path));
    if (!a) {
      const prof = /UserData\.(.+)$/i.exec(id);              // Chrome / Edge: another profile gets its own button
      const name = prof ? `${prettyName(t.path)} (${prof[1].replace(/^Profile(\d+)$/i, 'Profile $1')})` : /_crx_/i.test(id) ? t.title : prettyName(t.path);
      a = { key: k, id, name, path: t.path, pinned: false, windows: [] };
      apps.push(a);
    }
    a.windows.push({ hwnd: t.hwnd, title: t.title, min: t.min });
  }
  return apps;
}
const dockIcons = new Map();     // "index|file" → data URL (48 px, extracted by the bridge)
const lnkIcons = new Map();      // shortcut → "index|file" of the icon it names (web apps, Office, store installers…)
const iconWait = new Map();      // bridge request id → "index|file"
let iconSeq = 0;
function dockIconSrc(a) {
  // a Store app (pinned, or running from WindowsApps): its icon as Start shows it, by app ID
  if (a.aumid) return `app|${a.aumid}`;
  if (!a.lnk && PKG_AUMID.test(a.id || '') && /[\\/]WindowsApps[\\/]/i.test(a.path || '')) return `app|${a.id}`;
  if (!a.lnk) return `0|${a.path}`;
  if (!lnkIcons.has(a.lnk)) {
    let src = `0|${a.path}`;
    try {
      const t = shell.readShortcutLink(a.lnk);
      const f = t.icon && t.icon.replace(/%([^%]+)%/g, (m, v) => process.env[v] || m);
      if (f && fs.existsSync(f)) src = `${t.iconIndex || 0}|${f}`;
    } catch { /* keep the exe */ }
    lnkIcons.set(a.lnk, src);
  }
  return lnkIcons.get(a.lnk);
}
function dockIconLoad(src) {
  const id = 'i' + (++iconSeq);
  iconWait.set(id, src);
  if (src.startsWith('app|')) { bridgeCmd(`appicon ${id} ${src.slice(4)}`); return; }
  const [index, ...file] = src.split('|');
  bridgeCmd(`icon ${id} ${index} ${file.join('|')}`);
}
function onIcon(m) {
  const src = iconWait.get(m.id);
  if (!src) return;
  iconWait.delete(m.id);
  if (m.data) { dockIcons.set(src, 'data:image/png;base64,' + m.data); dockPush(); return; }
  if (src.startsWith('app|')) return;                                 // no picture for that Store app: keep its letter
  exeIcon(src.split('|').slice(1).join('|')).then(u => { dockIcons.set(src, u); dockPush(); });   // fallback: Electron's own
}
// the floating dock has its own equalizer switch; Dock + music and the full-width bar share tbEq
const dockEqOn = () => (settings.tbStyle === 'dock' ? settings.tbFloatEq : settings.tbEq) !== false;
function dockState() {
  const apps = dockApps();
  let missing = false;
  for (const a of apps) {
    a.active = a.windows.some(w => w.hwnd === fgHwnd && !w.min);
    if (a.own) { a.icon = ownIconUrl(); continue; }
    // a pinned shortcut may name its own icon file (web apps like YouTube Music do); otherwise the exe's icon
    const src = dockIconSrc(a);
    if (!dockIcons.has(src)) { dockIcons.set(src, null); missing = true; dockIconLoad(src); }
    a.icon = dockIcons.get(src) || null;
  }
  const m = lastState.media || {};
  return {
    style: settings.tbStyle, hover: settings.tbHover !== false, size: settings.tbSize || 'm',
    np: settings.tbNp !== false, eq: dockEqOn(),
    apps, fg: fgHwnd, accent: lastAccent, wx: lastWx, volume: lastState.volume || null, conn: lastState.conn || null,
    media: m.active ? { title: m.title, artist: m.artist, thumb: m.thumb || null, playing: m.status === 'Playing' } : null,
    loading: missing,
  };
}
let dockPushT = 0;
function dockPush() {
  if (!dockWins.length) return;
  clearTimeout(dockPushT);
  dockPushT = setTimeout(() => {
    const st = dockState();
    for (const e of dockWins) if (!e.win.isDestroyed()) e.win.webContents.send('dock-state', st);
  }, 60);
}

function dockDisplays() { return settings.tbScreens === 'main' ? [screen.getPrimaryDisplay()] : screen.getAllDisplays(); }
function dockBounds(d) { return { x: d.bounds.x, y: d.bounds.y + d.bounds.height - DOCK_WIN_H, width: d.bounds.width, height: DOCK_WIN_H }; }
// The strip is reserved by a tiny invisible window of its own: Windows nudges an app bar's window out of the
// strip it reserves, which pushed the dock up. The dock window itself stays pinned to the bottom edge.
function dockReserve(e, d) {
  if (!e.abWin) {
    e.abWin = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: 1, height: 1, show: false, frame: false, skipTaskbar: true, focusable: false, title: 'NotchMine Dock Space' });
    e.hwnd = e.abWin.getNativeWindowHandle().readBigUInt64LE(0).toString();
  }
  const h = Math.round((DOCK_RESERVE[settings.tbStyle] || 72) * ({ s: .85, m: 1, l: 1.15 }[settings.tbSize] || 1));
  if (e.reserved === h) return;
  e.reserved = h;
  const r = screen.dipToScreenRect(null, { x: d.bounds.x, y: d.bounds.y + d.bounds.height - h, width: d.bounds.width, height: h });
  bridgeCmd(`tb appbar ${e.hwnd} ${r.x} ${r.y} ${r.x + r.width} ${r.y + r.height}`);
}
function dockCreate(d) {
  const w = new BrowserWindow({
    ...dockBounds(d), frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    show: false, title: 'NotchMine Dock',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  const e = { win: w, displayId: d.id };
  w.webContents.on('console-message', (_ev, level, message) => { if (!app.isPackaged && level >= 2) console.log(`[dock ${d.id}] ${message}`); });   // TEMP DIAG
  w.setIgnoreMouseEvents(true, { forward: true });             // only the dock itself catches the mouse
  w.setAlwaysOnTop(true, 'floating');
  w.loadFile(path.join(__dirname, 'renderer', 'dock.html'));
  w.once('ready-to-show', () => {
    w.setBounds(dockBounds(d));
    dockReserve(e, d);
    dockVisibility();
  });
  // keep it on the bottom edge whatever moves it (a work-area change, another app bar…)
  let fixT = 0;
  w.on('move', () => {
    clearTimeout(fixT);
    fixT = setTimeout(() => {
      if (w.isDestroyed()) return;
      const want = dockBounds(screen.getAllDisplays().find(x => x.id === e.displayId) || d), b = w.getBounds();
      if (b.x !== want.x || b.y !== want.y || b.width !== want.width) w.setBounds(want);
    }, 120);
  });
  w.on('closed', () => { dockWins = dockWins.filter(x => x !== e); });
  dockWins.push(e);
}
function dockClose(e) {
  if (e.hwnd) bridgeCmd(`tb appbar-off ${e.hwnd}`);
  if (e.abWin && !e.abWin.isDestroyed()) e.abWin.destroy();
  if (!e.win.isDestroyed()) e.win.destroy();
}
// full-screen apps, games and party mode: the dock steps aside (the Windows taskbar would too)
function dockVisibility() {
  for (const e of dockWins) {
    if (e.win.isDestroyed()) continue;
    const hide = partyWins.length || gameOn() || fullscreenDisplayId === e.displayId;
    if (hide && e.win.isVisible()) e.win.hide();
    else if (!hide && !e.win.isVisible()) {
      e.win.showInactive();
      e.win.setAlwaysOnTop(true, 'floating');                  // shown again: back over other windows (it came back below them)
      e.over = undefined;                                      // and the click-through state is set afresh
    }
  }
}
function syncDock(rebuild) {
  if (!app.isReady() || !bridge) return;
  if (!tbCustom()) {
    for (const e of dockWins) dockClose(e);
    dockWins = [];
    bridgeCmd('tb tasks off');
    if (tbApplied || settings.tbOrig != null) {
      bridgeCmd(settings.tbOrig != null ? `tb restore ${settings.tbOrig}` : 'tb show');
      tbApplied = false; settings.tbOrig = null; saveSettings();
    }
    tbLayoutBack();
    return;
  }
  if (!tbApplied) { bridgeCmd(`tb hide ${settings.tbOrig != null ? settings.tbOrig : -1}`); tbApplied = true; }
  tbLayout();
  bridgeCmd('tb tasks on');
  const displays = dockDisplays();
  const ids = new Set(displays.map(d => d.id));
  for (const e of dockWins) if (rebuild || !ids.has(e.displayId)) { e.gone = true; dockClose(e); }
  dockWins = dockWins.filter(e => !e.gone);
  for (const d of displays) {
    const have = dockWins.find(e => e.displayId === d.id);
    if (!have) dockCreate(d);
    else { have.reserved = null; dockReserve(have, d); }       // the style or size changed the strip
  }
  dockVisibility();
  dockPush();
}
// Start and search are Windows' own, and Windows opens them where its own (hidden) taskbar keeps them. So the
// Windows taskbar is laid out like ours (bridge: Bar.Layout): left-aligned with a search box for the full-width bar
// (Start opens at the left, and Win+S types into the Windows box that lands right on our Search pill), centred with
// a search icon for the docks (Start and search open centred above the dock, search typing in its own panel).
// The user's own values come back with the Windows taskbar (and after a crash, from tbOrigLayout).
let tbLayoutSent = '';
function tbLayout() {
  const want = settings.tbStyle === 'bar' ? '0 2' : '1 1';
  if (want === tbLayoutSent) return;
  tbLayoutSent = want;
  const o = settings.tbOrigLayout;
  bridgeCmd(`tb layout ${want} ${o ? o.al : -2} ${o ? o.mode : -2}`);
}
function tbLayoutBack() {
  if (!tbLayoutSent && !settings.tbOrigLayout) return;
  const o = settings.tbOrigLayout;
  bridgeCmd(o ? `tb layout-restore ${o.al} ${o.mode}` : 'tb layout-back');
  tbLayoutSent = '';
  if (o) { settings.tbOrigLayout = null; saveSettings(); }
}
function setTaskbarStyle(style) {
  if (TB_CUSTOM.includes(style)) settings.tbLast = style;
  settings.tbStyle = style;
  saveSettings();
  syncDock();
  send('settings', settings);
  if (tray) tray.setContextMenu(buildTrayMenu());
}
const toggleTaskbar = () => setTaskbarStyle(tbCustom() ? 'windows' : (settings.tbLast || 'dockeq'));

ipcMain.handle('dock-init', () => dockState());
// Click-through is decided here, by polling the cursor against the boxes the dock renderer reports (the dock, the
// pills, the window list), like the notch does. It used to follow the renderer's own mousemove / mouseleave, but
// those arrive through Electron's forwarding (a low-level mouse hook Windows silently removes if the app is ever
// slow to answer it) and flipping click-through makes Chromium report a fake mouseleave: either way the dock could
// end up click-through with the mouse resting on an icon, so clicks went to the window behind it.
ipcMain.on('dock-rects', (e, rects) => {
  const rec = dockWins.find(x => !x.win.isDestroyed() && x.win.webContents === e.sender);
  if (!rec || !Array.isArray(rects)) return;
  rec.rects = rects.filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite)).slice(0, 40);
  dockWatch();
});
let dockWatchT = 0;
function dockWatch() {
  if (dockWatchT) return;
  dockWatchT = setInterval(() => {
    if (!dockWins.length) { clearInterval(dockWatchT); dockWatchT = 0; return; }
    const p = screen.getCursorScreenPoint();
    for (const e of dockWins) {
      if (e.win.isDestroyed()) continue;
      let over = false;
      if (e.rects && e.win.isVisible()) {
        const b = e.win.getBounds(), x = p.x - b.x, y = p.y - b.y;   // window DIP = the page's CSS px (no zoom)
        over = e.rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
      }
      if (over === e.over) continue;
      e.over = over;
      e.win.setIgnoreMouseEvents(!over, { forward: true });
      e.win.webContents.send('dock-over', over);
    }
  }, 30);
}
ipcMain.on('dock-cmd', (e, c) => {
  if (!app.isPackaged) console.log('[DIAG dock-cmd]', JSON.stringify(c));   // TEMP DIAG
  if (!c || typeof c !== 'object') return;
  const apps = dockApps();
  const a = c.key ? apps.find(x => x.key === c.key) : null;
  const launch = launchApp;
  switch (c.cmd) {
    case 'app': {                  // like the Windows taskbar: open it, bring it up, or minimize it
      if (!a) return;
      if (a.own) {                 // NotchMine Settings: our own window, so Electron can do it directly
        if (!setWin || setWin.isDestroyed()) openSettings();
        else if (!setWin.isMinimized() && setWin.isFocused()) setWin.minimize();
        else openSettings();       // restores, shows and focuses it
        return;
      }
      if (!a.windows.length) { launch(a); return; }
      const fg = a.windows.find(w => w.hwnd === fgHwnd && !w.min);
      if (fg && a.windows.length === 1) bridgeCmd(`win min ${fg.hwnd}`);
      else if (fg) { const i = a.windows.indexOf(fg); bridgeCmd(`win activate ${a.windows[(i + 1) % a.windows.length].hwnd}`); }   // several: cycle
      else bridgeCmd(`win activate ${a.windows[0].hwnd}`);
      break;
    }
    case 'menu': {                 // right-click on an app
      if (!a) return;
      const rec = dockWins.find(x => !x.win.isDestroyed() && x.win.webContents === e.sender);
      const tmpl = a.own ? [                                     // NotchMine Settings: nothing to pin or launch
        { label: 'Open', click: () => openSettings() },
        { label: 'Close window', click: () => { if (setWin && !setWin.isDestroyed()) setWin.close(); } },
      ] : [
        ...a.windows.map(w => ({ label: (w.title || a.name).slice(0, 60), click: () => bridgeCmd(`win activate ${w.hwnd}`) })),
        ...(a.windows.length ? [{ type: 'separator' }] : []),
        { label: a.name, enabled: false },
        { label: a.windows.length ? 'Open new window' : 'Open', click: () => launch(a) },
        a.pinned
          ? { label: 'Unpin from dock', click: () => { settings.tbPins = tbPins().filter(p => pinKey(p) !== pinKey(a)); saveSettings(); dockPush(); } }
          : { label: 'Pin to dock', click: () => {
            const store = PKG_AUMID.test(a.id || '') && /[\\/]WindowsApps[\\/]/i.test(a.path || '');   // a Store app opens by app ID
            settings.tbPins = [...tbPins(), store ? { aumid: a.id, id: a.id, name: a.name, path: '' } : { path: a.path, name: a.name, id: a.id || '' }];
            saveSettings(); dockPush();
          } },
        ...(a.windows.length ? [{ label: a.windows.length > 1 ? 'Close all windows' : 'Close window', click: () => a.windows.forEach(w => bridgeCmd(`win close ${w.hwnd}`)) }] : []),
      ];
      if (rec) Menu.buildFromTemplate(tmpl).popup({ window: rec.win });
      break;
    }
    case 'win': if (/^\d+$/.test(String(c.hwnd)) && ['activate', 'close', 'min'].includes(c.act)) bridgeCmd(`win ${c.act} ${c.hwnd}`); break;
    case 'key': if (['start', 'search', 'taskview', 'quick', 'notif'].includes(c.what)) bridgeCmd(`tb key ${c.what}`); break;
    case 'tray': bridgeCmd('tb peek'); break;
    case 'media': if (['toggle', 'next', 'prev'].includes(c.what)) bridgeCmd(`media ${c.what}`); break;
  }
});
function startParty() {
  if (partyWins.length) return;
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const notchD = targetDisplay();
  const mode = settings.partyScreens || 'all';
  const list = mode === 'all' ? all : mode === 'main' ? [primary] : [notchD];
  const centre = mode === 'main' ? primary : notchD;           // the big orb goes where the notch lives
  list.sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);   // left → right: the orbs' carousel order
  startOrbPlan(list.map(d => ({ ...d.bounds, w: d.bounds.width, h: d.bounds.height, main: d.id === centre.id || list.length === 1 })));
  for (const d of list) {
    const role = d.id === centre.id || list.length === 1 ? 'main' : 'side';
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false, backgroundColor: '#000000', skipTaskbar: true, alwaysOnTop: true,
      fullscreenable: true, title: 'NotchMine Party',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'renderer', 'party.html'), { query: { role } });
    w.once('ready-to-show', () => {
      w.setBounds(d.bounds);
      w.show();
      w.setFullScreen(true);
      if (role === 'main') w.focus();
    });
    w.on('closed', () => {
      partyWins = partyWins.filter(x => x !== w);
      if (!partyWins.length) endParty();
      else stopParty();                                       // closing one screen ends the party everywhere
    });
    partyWins.push(w);
  }
  if (settings.partyAwake) partyBlocker = powerSaveBlocker.start('prevent-display-sleep');
  refreshVisibility();
  if (tray) tray.setContextMenu(buildTrayMenu());
}
function stopParty() {
  for (const w of partyWins.slice()) if (!w.isDestroyed()) w.close();
}
// ---- the travelling orbs. One orb per party screen. Each drifts a little around its home spot every 5–10 s,
// and every 15–25 s they all move one screen over together (the end one goes back the long way, straight across
// the real desk layout, so an orb always leaves through the edge facing its next screen). Main is the director: it sends the plan (screen layout, which screen each orb is on, drift moves,
// travels) with absolute times, and every screen draws whatever part of any orb falls on it, so an orb
// crossing from one screen to the next is drawn half on each.
let orbPlan = null, orbTimers = [];
const orbEase = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function orbDriftAt(o, now) {
  const e = orbEase(Math.max(0, Math.min(1, (now - o.t0) / o.dur)));
  return [o.from[0] + (o.to[0] - o.from[0]) * e, o.from[1] + (o.to[1] - o.from[1]) * e];
}
function orbPick(cur, main) {                 // a new spot (fractions of the screen) a little off home, or home again
  if (Math.random() < 0.25 && (cur[0] || cur[1])) return [0, 0];
  let x, y;
  do {
    x = (Math.random() * 2 - 1) * 0.13;
    y = main ? -0.09 + Math.random() * 0.12 : (Math.random() * 2 - 1) * 0.09;   // main: clear of the now-playing text
  } while (Math.hypot(x - cur[0], y - cur[1]) < 0.05);
  return [x, y];
}
function sendOrbPlan() { for (const w of partyWins) if (!w.isDestroyed()) w.webContents.send('party-plan', orbPlan); }
function orbLater(fn, ms) { const id = setTimeout(() => { orbTimers = orbTimers.filter(x => x !== id); if (orbPlan) fn(); }, ms); orbTimers.push(id); }
function startOrbPlan(screens) {
  stopOrbPlan();
  orbPlan = { screens, orbs: screens.map((_, j) => ({ slot: j, from: [0, 0], to: [0, 0], t0: 0, dur: 1 })), travel: null };
  const drift = j => orbLater(() => {
    if (!orbPlan.travel) {                                    // no small moves while the orbs are changing screens
      const o = orbPlan.orbs[j], now = Date.now() + 60, cur = orbDriftAt(o, now);
      Object.assign(o, { from: cur, to: orbPick(cur, screens[o.slot].main), t0: now, dur: 1500 + Math.random() * 900 });
      sendOrbPlan();
    }
    drift(j);
  }, 5000 + Math.random() * 5000);
  screens.forEach((_, j) => drift(j));
  const n = screens.length;
  const travel = () => orbLater(() => {
    const now = Date.now() + 80, dur = 2800, dir = Math.random() < 0.5 ? 1 : -1;
    orbPlan.travel = { t0: now, dur, dir };
    for (const o of orbPlan.orbs) {                           // each lands on a fresh spot of its new screen
      const cur = orbDriftAt(o, now), dest = (o.slot + dir + n) % n;
      Object.assign(o, { from: cur, to: orbPick(cur, screens[dest].main), t0: now, dur });
    }
    sendOrbPlan();
    orbLater(() => {
      for (const o of orbPlan.orbs) o.slot = (o.slot + dir + n) % n;
      orbPlan.travel = null;
      sendOrbPlan();
      travel();
    }, now - Date.now() + dur + 50);
  }, 15000 + Math.random() * 10000);
  if (n > 1) travel();
}
function stopOrbPlan() { for (const id of orbTimers) clearTimeout(id); orbTimers = []; orbPlan = null; }
function endParty() {
  stopOrbPlan();
  if (partyBlocker !== null) { try { powerSaveBlocker.stop(partyBlocker); } catch { /* ignore */ } partyBlocker = null; }
  refreshVisibility();
  send('party', false);
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// Cursor polling drives hover + click-through. Polling (rather than relying on
// forwarded mouse events) also works while the user drags a file from Explorer.
function startCursorWatch() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // hit rect is in CSS px; window coordinates are DIP = CSS px × zoom
    const x = (p.x - b.x) / zoom();
    const y = (p.y - b.y) / zoom();
    const r = hitRect;
    const inside = x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    if (inside !== hovering) {
      hovering = inside;
      win.setIgnoreMouseEvents(!inside, { forward: true });
      send('hover', inside);
    }
  }, 40);
  // Windows occasionally drops topmost status (e.g. after Start menu / UAC)
  setInterval(() => { if (win && win.isVisible()) win.setAlwaysOnTop(true, 'screen-saver'); }, 4000);
}

// ------------------------------------------------------------------ native bridge (PowerShell)
let bridge = null;
let bridgeBuf = '';
let bridgeRestarts = 0;
const lastState = {};   // cache of latest media/volume/brightness for late renderer loads

function bridgePath() {
  return path.join(__dirname, '..', 'bridge', 'bridge.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

function startBridge() {
  bridge = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgePath(),
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NOTCHMINE_PID: String(process.pid) } });

  bridge.stdout.setEncoding('utf8');
  bridge.stdout.on('data', chunk => {
    bridgeBuf += chunk;
    let i;
    while ((i = bridgeBuf.indexOf('\n')) >= 0) {
      const line = bridgeBuf.slice(0, i).trim();
      bridgeBuf = bridgeBuf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handleBridge(msg);
    }
  });
  bridge.stderr.on('data', d => console.error('[bridge]', String(d).trim()));
  bridge.on('exit', code => {
    bridge = null;
    if (app.isQuitting) return;
    const delay = Math.min(30000, 1000 * 2 ** bridgeRestarts++);
    console.error(`[bridge] exited (${code}), restarting in ${delay}ms`);
    setTimeout(startBridge, delay);
  });
}

const notifLog = [];   // recent notifications, newest first (kept for renderer reloads)
function handleBridge(msg) {
  if (msg.type === 'media' || msg.type === 'volume' || msg.type === 'conn') setTimeout(dockPush, 0);   // after lastState is updated
  switch (msg.type) {
    case 'tasks':
      tasks = Array.isArray(msg.list) ? msg.list : [];
      dockPush();
      break;
    case 'icon':
      onIcon(msg);
      break;
    case 'aumid':
      onAumid(msg);
      break;
    case 'tb-hidden':
      if (settings.tbOrig == null && Number.isInteger(msg.orig) && msg.orig >= 0) { settings.tbOrig = msg.orig; saveSettings(); }
      break;
    case 'tb-layout':
      if (settings.tbOrigLayout == null && tbLayoutSent && Number.isInteger(msg.al) && Number.isInteger(msg.mode) && msg.al >= -1 && msg.mode >= -1) {
        settings.tbOrigLayout = { al: msg.al, mode: msg.mode }; saveSettings();
      }
      break;
    case 'ready':
      bridgeRestarts = 0;
      tbLayoutSent = '';
      if (tbApplied) { bridgeCmd(`tb hide ${settings.tbOrig != null ? settings.tbOrig : -1}`); tbLayout(); bridgeCmd('tb tasks on'); }   // a restarted bridge
      bridgeCmd('games');
      bridgeCmd(`notif ${settings.notifications ? 'on' : 'off'}`);
      break;
    case 'net':
      send('net', msg);
      break;
    case 'gpu':
      if (Number.isFinite(msg.util)) lastGpu = { util: Math.max(0, Math.min(100, msg.util)), vram: +msg.vram || 0, vramTotal: +msg.vramTotal || 0, name: String(msg.name || ''), at: Date.now() };
      onGameGpu(lastGpu, +msg.fgUtil || 0);
      break;
    case 'games':
      windowsGames = new Set([].concat(msg.paths || []).map(p => String(p).toLowerCase()));
      windowsGameExes = new Set([...windowsGames].map(p => path.basename(p)));
      if (!app.isPackaged) console.log('[game] Windows knows', windowsGames.size, 'games');
      evaluateGame();
      break;
    case 'conn':
      lastState.conn = msg;
      send('conn', msg);
      break;
    case 'notif-status':
      lastState.notifStatus = msg.status;
      send('notif-status', msg.status);
      break;
    case 'mixer':
      Promise.all((msg.apps || [])
        .filter(a => !a.path || path.dirname(a.path).toLowerCase() !== path.dirname(process.execPath).toLowerCase())   // hide NotchMine itself
        .map(async a => ({ ...a, icon: await exeIcon(a.path) }))).then(apps => send('mixer', apps));
      break;
    case 'privacy':
      lastState.privacy = msg;
      send('privacy', msg);
      break;
    case 'mic':
      lastState.mic = msg;
      send('mic', msg);
      if (tray) tray.setContextMenu(buildTrayMenu());
      break;
    case 'wp-attached':
      onWpAttached(msg);
      break;
    case 'foreground':
      wpForeground(msg);
      if (msg.hwnd != null) { fgHwnd = String(msg.hwnd); dockPush(); }
      if (eqWins.length && settings.deskEqPos === 'bottom') raiseDeskEq();   // e.g. the taskbar was just clicked
      if (!snapFgLock) onForeground(msg);           // self-test: ignore the real desktop while it fakes a game
      break;
    case 'tracked':
      onTracked(msg);
      break;
    case 'audio-device':
    case 'lockkey':
    case 'drive':
      send(msg.type, msg);
      break;
    case 'clipseq':
      onClipboardChanged();
      break;
    case 'ocr': {
      const p = ocrWaiters.get(msg.id);
      if (p) { ocrWaiters.delete(msg.id); p(msg.text || ''); }
      break;
    }
    case 'notif':
      if (!settings.notifications) break;
      notifLog.unshift(msg);
      notifLog.sort((a, b) => b.time - a.time);
      if (notifLog.length > 60) notifLog.length = 60;
      send('notif', msg);
      break;
    case 'log': console.log('[bridge]', msg.message); break;
    case 'wp-hang': onWpHang(msg); break;
    case 'fullscreen':
      onFullscreen(msg);
      break;
    case 'media': {
      if (msg.active) { const label = webAppName(msg.app); if (label) msg.appLabel = label; }
      // keep the artwork in the cache even when the bridge omits it
      const prev = lastState.media;
      const cached = { ...msg };
      if (msg.active && msg.thumb === undefined && prev && prev.thumbId === msg.thumbId) cached.thumb = prev.thumb;
      lastState.media = cached;
      send('media', msg);
      sendParty('media', msg);
      break;
    }
    case 'volume':
    case 'brightness':
      lastState[msg.type] = msg;
      send(msg.type, msg);
      break;
  }
}

// Installed web apps (YouTube Music, YouTube … installed from Chrome / Edge) all report the browser's
// id plus "_crx_<app id>". Windows' Start menu knows their real names, so ask it once and remember.
const webApps = new Map();       // AppUserModelID -> "YouTube Music"
let webAppsAt = 0;
function refreshWebApps() {
  if (Date.now() - webAppsAt < 60000) return;      // at most once a minute (new app installed, …)
  webAppsAt = Date.now();
  exec('powershell.exe -NoProfile -NonInteractive -Command "Get-StartApps | Where-Object { $_.AppID -match \'_crx_\' } | ConvertTo-Json -Compress"',
    { windowsHide: true, timeout: 20000 }, (err, out) => {
      if (err) return;
      let list = [];
      try { list = JSON.parse(out || '[]'); } catch { return; }
      for (const a of [].concat(list)) {
        // "YouTube Music (1)": Windows numbers duplicates (several browser profiles)
        if (a && a.AppID && a.Name) webApps.set(a.AppID.toLowerCase(), String(a.Name).replace(/\s*\(\d+\)$/, ''));
      }
      // the song may be paused (no more updates coming): re-send it with its proper name
      const m = lastState.media;
      if (m && m.active && !m.appLabel) { const label = webAppName(m.app); if (label) { m.appLabel = label; send('media', m); } }
    });
}
function webAppName(id) {
  if (!id || !/_crx_/i.test(id)) return null;
  const key = id.toLowerCase();
  if (webApps.has(key)) return webApps.get(key);
  for (const [k, v] of webApps) if (key.startsWith(k) || k.startsWith(key)) return v;
  refreshWebApps();
  return null;
}

function bridgeCmd(cmd) {
  if (!app.isPackaged && /^(win|tb key|tb peek)/.test(cmd)) console.log('[DIAG bridge<-]', cmd, 'writable=', !!(bridge && bridge.stdin.writable));   // TEMP DIAG
  if (bridge && bridge.stdin.writable) bridge.stdin.write(cmd + '\n');
}

// ------------------------------------------------------------------ system stats
let prevCpu = null;
const cpuHistory = [];
const ramHistory = [];
const gpuHistory = [];
const vramHistory = [];
let lastGpu = null;             // latest GPU reading from the bridge (null: no GPU counters on this PC)
function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
function sampleSystem() {
  const now = cpuSnapshot();
  let cpu = 0;
  if (prevCpu) {
    const dt = now.total - prevCpu.total;
    cpu = dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - (now.idle - prevCpu.idle) / dt))) : 0;
  }
  prevCpu = now;
  const total = os.totalmem();
  const used = total - os.freemem();
  const ram = (used / total) * 100;
  cpuHistory.push(Math.round(cpu)); if (cpuHistory.length > 40) cpuHistory.shift();
  ramHistory.push(Math.round(ram)); if (ramHistory.length > 40) ramHistory.shift();
  const gpu = lastGpu && Date.now() - lastGpu.at < 10000 ? lastGpu : null;   // stale reading: hide it
  if (gpu) { gpuHistory.push(gpu.util); if (gpuHistory.length > 40) gpuHistory.shift(); }
  if (gpu && gpu.vramTotal > 0) { vramHistory.push(Math.round(gpu.vram / gpu.vramTotal * 100)); if (vramHistory.length > 40) vramHistory.shift(); }
  send('sys', {
    cpu: Math.round(cpu),
    ram: Math.round(ram),
    ramUsed: used,
    ramTotal: total,
    uptime: os.uptime(),
    cpuName: (os.cpus()[0] || {}).model || '',
    cores: os.cpus().length,
    cpuHistory: [...cpuHistory],
    ramHistory: [...ramHistory],
    gpu: gpu ? gpu.util : null,
    gpuName: gpu ? gpu.name : '',
    vramUsed: gpu ? gpu.vram : 0,
    vramTotal: gpu ? gpu.vramTotal : 0,
    gpuHistory: [...gpuHistory],
    vramHistory: [...vramHistory],
  });
}

// ------------------------------------------------------------------ clipboard history
let clipHistory = [];
let lastClip = '';
function pollClipboard() {
  if (!settings.clipboardHistory) return;
  let text = '';
  try { text = clipboard.readText(); } catch { return; }
  if (!text || text === lastClip) return;
  lastClip = text;
  if (text.length > 5000) text = text.slice(0, 5000);
  clipHistory = [text, ...clipHistory.filter(t => t !== text)].slice(0, 20);
  send('clipboard', clipHistory);
}

// ------------------------------------------------------------------ icons for exe paths (mixer)
const exeIconCache = new Map();
async function exeIcon(p) {
  if (!p) return null;
  if (!exeIconCache.has(p)) {
    exeIconCache.set(p, app.getFileIcon(p, { size: 'normal' }).then(i => i.toDataURL()).catch(() => null));
  }
  return exeIconCache.get(p);
}

// ------------------------------------------------------------------ recent items: screenshots + downloads
const CAPTURE_DIR = path.join(app.getPath('userData'), 'captures');
const recent = [];            // newest first: { kind: 'capture'|'download', path, name, time, size, thumb? }
function pushRecent(item) {
  const i = recent.findIndex(r => r.path === item.path);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(item);
  if (recent.length > 16) recent.length = 16;
}
function loadRecentCaptures() {
  try {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const files = fs.readdirSync(CAPTURE_DIR).filter(f => /\.png$/i.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(CAPTURE_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.slice(30).forEach(x => fs.rm(path.join(CAPTURE_DIR, x.f), () => {}));   // keep the newest 30
    for (const x of files.slice(0, 8).reverse()) {
      const p = path.join(CAPTURE_DIR, x.f);
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      const { width, height } = img.getSize();
      pushRecent({ kind: 'capture', path: p, name: x.f, time: x.t, w: width, h: height, thumb: img.resize({ width: 240 }).toDataURL() });
    }
  } catch { /* ignore */ }
}

// Screenshots: Win+Shift+S, PrtScn and copied images all land on the clipboard.
let lastImageSig = '';
function imageSig(img) {
  const { width, height } = img.getSize();
  return `${width}x${height}:${img.resize({ width: 16, height: 16 }).toBitmap().toString('base64')}`;
}
// Whatever image is already on the clipboard when we start was handled by an earlier run: don't
// turn it into a "new" screenshot again (that brought back items the user had removed).
function seedImageSig() {
  try { const img = clipboard.readImage(); if (!img.isEmpty()) lastImageSig = imageSig(img); } catch { /* ignore */ }
}
function onClipboardChanged() {
  if (!settings.catchScreenshots) return;
  setTimeout(() => {
    let formats = [];
    try { formats = clipboard.availableFormats(); } catch { return; }
    if (!formats.some(f => f.startsWith('image/'))) return;
    if (formats.includes('text/plain') || formats.includes('text/html')) return;   // copied from a document, not a screenshot
    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const { width, height } = img.getSize();
    if (width < 24 || height < 24) return;
    const sig = imageSig(img);
    if (sig === lastImageSig) return;
    lastImageSig = sig;
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}.${String(d.getSeconds()).padStart(2, '0')}`;
    const file = path.join(CAPTURE_DIR, `Screenshot ${stamp}.png`);
    fs.writeFile(file, img.toPNG(), err => {
      if (err) return;
      const item = { kind: 'capture', path: file, name: path.basename(file), time: Date.now(), w: width, h: height, thumb: img.resize({ width: 240 }).toDataURL() };
      pushRecent(item);
      send('capture', item);
    });
  }, 150);
}

// Downloads: watch the Downloads folder for files that finish appearing.
const seenDownloads = new Set();
function watchDownloads() {
  const dir = app.getPath('downloads');
  const timers = new Map();
  const TEMP = /\.(crdownload|part|partial|tmp|download|opdownload|!ut|aria2)$/i;
  const check = async full => {
    timers.delete(full);
    if (!settings.trackDownloads || seenDownloads.has(full)) return;
    try {
      const a = await fs.promises.stat(full);
      if (!a.isFile() || a.size === 0) return;
      if (Date.now() - Math.max(a.birthtimeMs, a.mtimeMs) > 120000) return;   // moved/copied old file, not a download
      await new Promise(r => setTimeout(r, 1200));
      const b = await fs.promises.stat(full);
      if (b.size !== a.size) { timers.set(full, setTimeout(() => check(full), 1500)); return; }
      seenDownloads.add(full);
      const item = { kind: 'download', path: full, name: path.basename(full), time: Date.now(), size: b.size };
      item.icon = await app.getFileIcon(full, { size: 'normal' }).then(i => i.toDataURL()).catch(() => null);
      pushRecent(item);
      send('download', item);
    } catch { /* gone (temp file) */ }
  };
  try {
    fs.watch(dir, (_ev, name) => {
      if (!name || TEMP.test(name) || name.startsWith('~$') || name.startsWith('.')) return;
      const full = path.join(dir, name);
      clearTimeout(timers.get(full));
      timers.set(full, setTimeout(() => check(full), 1200));
    });
  } catch (e) { console.error('downloads watcher', e.message); }
}

// OCR through the bridge (Windows.Media.Ocr: offline)
const ocrWaiters = new Map();
function ocr(file) {
  return new Promise(resolve => {
    const id = Math.random().toString(36).slice(2, 10);
    ocrWaiters.set(id, resolve);
    bridgeCmd(`ocr ${id} ${file}`);
    setTimeout(() => { if (ocrWaiters.has(id)) { ocrWaiters.delete(id); resolve(''); } }, 20000);
  });
}

// ------------------------------------------------------------------ tray
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTrayMenu() {
  const displays = screen.getAllDisplays();
  return Menu.buildFromTemplate([
    { label: 'NotchMine', enabled: false },
    { type: 'separator' },
    {
      label: 'Search…',
      accelerator: search.hotkeyLabel() || undefined,
      enabled: settings.searchOn !== false,
      click: () => search.show(),
    },
    {
      label: userHidden ? 'Show notch' : 'Hide notch',
      accelerator: 'Ctrl+Alt+N',
      click: () => { userHidden = !userHidden; refreshVisibility(); tray.setContextMenu(buildTrayMenu()); },
    },
    {
      label: 'Desktop equalizer',
      type: 'checkbox',
      checked: !!settings.deskEq,
      click: m => { settings.deskEq = m.checked; saveSettings(); syncDeskEq(); send('settings', settings); },
    },
    {
      label: tbCustom() ? 'Back to the Windows taskbar' : 'Use the NotchMine taskbar',
      accelerator: 'Ctrl+Alt+T',
      click: () => toggleTaskbar(),
    },
    {
      label: partyWins.length ? 'Stop party mode' : 'Party mode',
      accelerator: 'Ctrl+Alt+P',
      click: () => (partyWins.length ? stopParty() : startParty()),
    },
    {
      label: lastState.mic && lastState.mic.muted ? 'Unmute microphone' : 'Mute microphone',
      accelerator: 'Ctrl+Alt+M',
      enabled: !!(lastState.mic && lastState.mic.present),
      click: () => bridgeCmd('mic toggle'),
    },
    {
      label: 'Display',
      submenu: displays.map((d, i) => ({
        label: `Display ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' · primary' : ''}`,
        type: 'radio',
        checked: (settings.displayId ?? screen.getPrimaryDisplay().id) === d.id,
        click: () => { settings.displayId = d.id; saveSettings(); placeWindow(); refreshVisibility(); },
      })),
    },
    {
      label: 'In full-screen apps',
      submenu: [['show', 'Show normally'], ['dim', 'Fade to a thin line'], ['hide', 'Hide']].map(([v, label]) => ({
        label, type: 'radio', checked: settings.fullscreenMode === v,
        click: () => { settings.fullscreenMode = v; saveSettings(); refreshVisibility(); send('settings', settings); },
      })),
    },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: m => { applyLoginItem(m.checked); send('settings', settings); },
    },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Reload', click: () => win && win.reload() },
    { type: 'separator' },
    { label: 'Quit NotchMine', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function applyLoginItem(on) {
  settings.launchAtLogin = !!on;
  saveSettings();
  const opts = { openAtLogin: !!on, name: 'NotchMine' };
  if (!app.isPackaged) { opts.path = process.execPath; opts.args = [path.resolve(__dirname, '..')]; }
  // the portable build runs from a temp folder; register the real .exe instead
  else if (process.env.PORTABLE_EXECUTABLE_FILE) opts.path = process.env.PORTABLE_EXECUTABLE_FILE;
  app.setLoginItemSettings(opts);
}

// ------------------------------------------------------------------ IPC
ipcMain.on('hit-rect', (_e, r) => { hitRect = r; });
ipcMain.on('drag-start', () => dragStart());
ipcMain.on('drag-end', () => dragEnd());
ipcMain.handle('displays', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays()
    .sort((a, b) => a.bounds.x - b.bounds.x)
    .map((d, i) => ({ id: d.id, index: i + 1, primary: d.id === primary, w: d.size.width, h: d.size.height }));
});
ipcMain.on('media', (_e, cmd, arg) => {
  if (!['toggle', 'play', 'pause', 'next', 'prev', 'seek'].includes(cmd)) return;
  bridgeCmd(cmd === 'seek' ? `media seek ${Number(arg) || 0}` : `media ${cmd}`);
});
ipcMain.on('volume', (_e, v) => bridgeCmd(`vol set ${Math.max(0, Math.min(1, Number(v) || 0)).toFixed(2)}`));
ipcMain.on('mute', () => bridgeCmd('vol mute'));
ipcMain.on('brightness', (_e, v) => bridgeCmd(`bright set ${Math.round(Math.max(0, Math.min(100, Number(v) || 0)))}`));
ipcMain.on('brightness-refresh', () => bridgeCmd('bright get'));

ipcMain.handle('side-apps', async () => Promise.all(recentApps.map(async a => ({ ...a, icon: await exeIcon(a.path) }))));
ipcMain.handle('app-icon', (_e, p) => exeIcon(p));
// ---- the app's one system-audio capture is the notch's: its levels go on to every other window that moves to music.
// (Each window capturing on its own made an external monitor drop out on some laptops, again and again.)
let audioWant = false, audioFrameSeen = false;
function audioWantNow() {
  return (dockWins.length > 0 && dockEqOn()) || eqWins.length > 0 || partyWins.length > 0 || ambWins.length > 0 ||
    (!!wpHost && (settings.wpBeat !== false || (settings.wpMode === 'manual' && settings.wpStyle === 'music')));
}
setInterval(() => { const w = audioWantNow(); if (w !== audioWant) { audioWant = w; send('audio-want', w); } }, 1000);
ipcMain.on('audio-frame', (e, f) => {
  if (!win || e.sender !== win.webContents || !f || !f.freq) return;
  if (!app.isPackaged && !audioFrameSeen) { audioFrameSeen = true; console.log(`[audio] sharing the notch's sound: ${dockWins.length} dock, ${eqWins.length} desktop eq, ${partyWins.length} party, wallpaper ${wpHost ? 'on' : 'off'}`); }
  for (const d of dockWins) if (!d.win.isDestroyed()) d.win.webContents.send('audio', f);
  for (const q of eqWins) if (!q.win.isDestroyed()) q.win.webContents.send('audio', f);
  for (const q of ambWins) if (!q.win.isDestroyed()) q.win.webContents.send('audio', f);
  for (const p of partyWins) if (!p.isDestroyed()) p.webContents.send('audio', f);
  if (wpHost) wpHostSend({ type: 'audio', rate: f.rate, size: f.size, freq: Array.from(f.freq), td: f.td ? Array.from(f.td) : null });
});
ipcMain.handle('init', () => ({ audioWant: (audioWant = audioWantNow()), game: gamePayload(), side: sideActive, fullscreenDim: fullscreenOn && settings.fullscreenMode === 'dim', anchor: anchorCss, settings, state: lastState, clipboard: clipHistory, notifs: notifLog, recent, phone: phone.status() }));

// v3: mixer, mic, lyrics, captures, phone drop
ipcMain.on('mixer-get', () => bridgeCmd('mixer get'));
ipcMain.on('mixer-set', (_e, pid, v) => bridgeCmd(`mixer set ${Number(pid) >>> 0} ${Math.max(0, Math.min(1, Number(v) || 0)).toFixed(2)}`));
ipcMain.on('mixer-mute', (_e, pid) => bridgeCmd(`mixer mute ${Number(pid) >>> 0}`));
ipcMain.on('mic-toggle', () => bridgeCmd('mic toggle'));
ipcMain.handle('lyrics', async (_e, q) => {
  if (!settings.lyrics || !q || !q.title) return null;
  try { return await lyrics.find(q); } catch { return null; }
});
ipcMain.handle('artwork', async (_e, q) => {
  if (!settings.onlineArtwork || !q || typeof q.title !== 'string') return null;
  try { return await artwork.find({ title: q.title, artist: String(q.artist || '') }); } catch { return null; }
});
ipcMain.handle('ocr', async (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return '';
  const text = await ocr(p);
  if (text) { lastClip = text; clipboard.writeText(text); clipHistory = [text, ...clipHistory.filter(x => x !== text)].slice(0, 20); send('clipboard', clipHistory); }
  return text;
});
ipcMain.handle('capture-save', async (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return null;
  const dir = path.join(app.getPath('pictures'), 'Screenshots');
  fs.mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, path.basename(p)), i = 1;
  while (fs.existsSync(dest)) dest = path.join(dir, path.basename(p, '.png') + ` (${i++}).png`);
  await fs.promises.copyFile(p, dest);
  shell.showItemInFolder(dest);
  return dest;
});
ipcMain.on('capture-copy', (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return;
  const img = nativeImage.createFromPath(p);
  if (!img.isEmpty()) clipboard.writeImage(img);
});
ipcMain.on('recent-remove', (_e, p) => {
  const i = recent.findIndex(r => r.path === p);
  if (i < 0) return;
  const [item] = recent.splice(i, 1);
  // Screenshots live in our own captures folder and the list is rebuilt from it on every start,
  // so removing one has to delete its file or it comes back. (Downloads are the user's files: never touched.)
  if (item.kind === 'capture' && path.dirname(path.resolve(item.path)).toLowerCase() === path.resolve(CAPTURE_DIR).toLowerCase()) {
    fs.rm(item.path, { force: true }, () => {});
  }
});
let phoneBlocker = null;            // keep the PC awake (and on Wi-Fi) while phone drop is on
function phoneAwake(on) {
  if (on && phoneBlocker === null) phoneBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && phoneBlocker !== null) { try { powerSaveBlocker.stop(phoneBlocker); } catch { /* ignore */ } phoneBlocker = null; }
}
ipcMain.handle('phone-start', async () => {
  pickerOpen = true;
  const st = await phone.start({
    destDir: path.join(app.getPath('downloads'), 'NotchMine Phone Drop'),
    log: path.join(app.getPath('userData'), 'phone-drop.log'),
    onFile: p => send('phone-file', p),
    onStatus: s => { if (!s.running) phoneAwake(false); send('phone-status', s); },
  });
  pickerOpen = false;
  phoneAwake(!!st.running);
  return st;
});
ipcMain.handle('phone-stop', () => phone.stop('closed'));

// party mode
ipcMain.on('party-start', () => startParty());
ipcMain.on('party-stop', () => stopParty());
ipcMain.handle('party-init', e => ({
  settings, media: lastState.media || null, accent: lastAccent, volume: lastState.volume || null,
  orbPlan, orbIndex: Math.max(0, partyWins.findIndex(w => !w.isDestroyed() && w.webContents === e.sender)),
}));
ipcMain.on('party-sync', (e, s) => {                 // the main screen's orb spin → the other screens
  for (const w of partyWins) if (!w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('party-sync', s);
});
ipcMain.on('accent-changed', (_e, rgb) => {
  if (typeof rgb !== 'string' || !/^\d{1,3}, ?\d{1,3}, ?\d{1,3}$/.test(rgb)) return;
  lastAccent = rgb;
  sendParty('accent', rgb);
  search.onSettings({ accent: rgb });
  sendSettingsWin('accent', rgb);
  dockPush();
});
ipcMain.handle('settings-set', (_e, patch) => {
  const before = { ...settings };
  Object.assign(settings, patch);
  if ('scale' in patch) applyScale();
  if ('posX' in patch || 'posY' in patch || 'displayId' in patch || 'shape' in patch || 'layout' in patch) placeWindow();
  if (['deskEq', 'deskEqPos', 'deskEqScreens', 'displayId', 'fullscreenMode'].some(k => k in patch)) syncDeskEq();
  if (['ambient', 'ambTrigger', 'ambGames'].some(k => k in patch)) syncAmbient();
  if (['wpOn', 'wpScreens', 'displayId'].some(k => k in patch)) syncWallpaper();
  if ('tbStyle' in patch && TB_CUSTOM.includes(patch.tbStyle)) settings.tbLast = patch.tbStyle;
  if (Object.keys(patch).some(k => k.startsWith('tb'))) setTimeout(() => syncDock(), 0);
  if ('wpPauseFs' in patch) wpPauseSync();
  if ('wpBack' in patch) syncMyWallpaper(true);
  if (patch.tbPinsReset) { delete settings.tbPinsReset; settings.tbPinsV = 0; importWindowsPins(); }   // Copy from Windows taskbar
  if (['gameMode', 'gameAuto', 'gameApps', 'notGames'].some(k => k in patch)) evaluateGame();
  if ('sideMode' in patch || 'sideApps' in patch || 'displayId' in patch) evaluateSide();
  if ('notifications' in patch) {
    bridgeCmd(`notif ${settings.notifications ? 'on' : 'off'}`);
    if (!settings.notifications) notifLog.length = 0;
  }
  if ('launchAtLogin' in patch && patch.launchAtLogin !== before.launchAtLogin) applyLoginItem(patch.launchAtLogin);
  if ('fullscreenMode' in patch || 'displayId' in patch) refreshVisibility();
  if ('clipboardHistory' in patch && !patch.clipboardHistory) { clipHistory = []; send('clipboard', clipHistory); }
  search.onSettings(patch);
  saveSettings();
  if (tray) tray.setContextMenu(buildTrayMenu());
  sendParty('settings', settings);
  // a change made elsewhere (settings window, party mode) reaches the notch, and the settings window hears about
  // changes made elsewhere; the window that made the change gets the result as its reply instead
  if (_e.sender !== win?.webContents && win && !win.isDestroyed()) win.webContents.send('settings', settings);
  if (setWin && !setWin.isDestroyed() && _e.sender !== setWin.webContents) setWin.webContents.send('settings', settings);
  return settings;
});

ipcMain.handle('file-icon', async (_e, p) => {
  try { return (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch { return null; }
});
ipcMain.handle('file-exists', (_e, p) => { try { return fs.existsSync(p); } catch { return false; } });
ipcMain.on('open-path', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.openPath(p); });
ipcMain.on('show-in-folder', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.on('start-drag', async (e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return;
  let icon;
  try { icon = await app.getFileIcon(p, { size: 'normal' }); } catch { icon = trayIcon(); }
  e.sender.startDrag({ file: p, icon });
});
function copyText(t) {
  if (typeof t !== 'string') return;
  lastClip = t; // don't re-add as "new"
  clipboard.writeText(t);
  clipHistory = [t, ...clipHistory.filter(x => x !== t)].slice(0, 20);
  send('clipboard', clipHistory);
}
ipcMain.on('copy-text', (_e, t) => copyText(t));
ipcMain.on('clear-clipboard-history', () => { clipHistory = []; send('clipboard', clipHistory); });

const ACTIONS = {
  screenshot: () => shell.openExternal('ms-screenclip:'),
  lock: () => exec('rundll32.exe user32.dll,LockWorkStation'),
  calculator: () => exec('start "" calc.exe', { shell: 'cmd.exe' }),
  explorer: () => exec('explorer.exe'),
  settings: () => shell.openExternal('ms-settings:'),
  taskmgr: () => exec('start "" taskmgr.exe', { shell: 'cmd.exe' }),
  bluetooth: () => shell.openExternal('ms-settings:bluetooth'),
  wifi: () => shell.openExternal('ms-availablenetworks:'),
  sound: () => shell.openExternal('ms-settings:sound'),
  terminal: () => exec('start "" wt.exe || start "" cmd.exe', { shell: 'cmd.exe' }),
  notifications: () => shell.openExternal('ms-actioncenter:'),
  notifPrivacy: () => shell.openExternal('ms-settings:privacy-notifications'),
};
ipcMain.on('action', (_e, name) => {
  if (!app.isPackaged) console.log('[action]', name);
  const fn = ACTIONS[name]; if (fn) fn();
});
ipcMain.on('clear-notifs', () => { notifLog.length = 0; });

// ------------------------------------------------------------------ search box (search.js)
// commands it can run: NotchMine's own, plus Windows pages and tools (ACTIONS)
const SEARCH_COMMANDS = {
  party: () => (partyWins.length ? stopParty() : startParty()),
  deskeq: () => { settings.deskEq = !settings.deskEq; saveSettings(); syncDeskEq(); send('settings', settings); if (tray) tray.setContextMenu(buildTrayMenu()); },
  taskbar: () => toggleTaskbar(),
  hide: () => { userHidden = !userHidden; refreshVisibility(); if (tray) tray.setContextMenu(buildTrayMenu()); },
  nmsettings: () => openSettings(),
  mic: () => bridgeCmd('mic toggle'),
  mute: () => bridgeCmd('vol mute'),
  playpause: () => bridgeCmd('media toggle'),
  next: () => bridgeCmd('media next'),
  prev: () => bridgeCmd('media prev'),
  display: () => shell.openExternal('ms-settings:display'),
  updates: () => shell.openExternal('ms-settings:windowsupdate'),
  installed: () => shell.openExternal('ms-settings:appsfeatures'),
  personalize: () => shell.openExternal('ms-settings:personalization-background'),
  recycle: () => spawn('explorer.exe', ['shell:RecycleBinFolder'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(),
  downloads: () => shell.openPath(app.getPath('downloads')),
};
function searchCommand(name) {
  const fn = SEARCH_COMMANDS[name] || ACTIONS[name];
  if (fn) fn();
}
// where the box opens: a little below the pill, centred under it (side and game mode, or the notch hidden:
// near the top of the screen, in the middle)
const SEARCH_GAP = 10;                                   // css px between the pill and the box
function searchSpot() {
  const d = targetDisplay(), z = zoom();
  if (!win || win.isDestroyed() || sideActive || gameOn() || !win.isVisible()) {
    return { display: d, cx: d.bounds.x + d.bounds.width / 2, y: d.bounds.y + Math.round(14 * z), island: true };
  }
  // the pill's bottom edge (the hit rect is the pill plus a small margin, in css px inside the window)
  let bottom = hitRect.y + hitRect.height;
  if (!(bottom > 0) || bottom > 100) bottom = (isIsland() ? 8 : 0) + 44;   // the panel is open: use the pill's usual size
  return { display: d, cx: pillCenterX(), y: win.getBounds().y + Math.round((bottom + SEARCH_GAP) * z), island: true };
}

// ------------------------------------------------------------------ custom shortcuts (Apps tab)
const isUrl = t => /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(ms-[a-z-]+|mailto|steam|spotify|discord):/i.test(t);

async function shortcutIcon(target) {
  if (isUrl(target)) {
    if (!/^https?:/i.test(target)) return null;
    // the site's own favicon (we only contact the site the user is adding)
    try {
      const u = new URL(target);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${u.protocol}//${u.host}/favicon.ico`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || 'image/x-icon';
      if (!/image/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 200000) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch { return null; }
  }
  try {
    let p = target;
    if (/\.lnk$/i.test(p)) { try { const l = shell.readShortcutLink(p); if (l.target && fs.existsSync(l.target)) p = l.target; } catch { /* keep .lnk */ } }
    return (await app.getFileIcon(p, { size: 'large' })).toDataURL();
  } catch { return null; }
}

ipcMain.handle('pick-file', async () => {
  pickerOpen = true;
  try {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose an app or file',
      properties: ['openFile'],
      filters: [{ name: 'Apps & shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  } finally { pickerOpen = false; }
});

ipcMain.handle('add-shortcut', async (_e, { name, target }) => {
  target = String(target || '').trim();
  if (!target) return settings;
  if (!isUrl(target) && !fs.existsSync(target)) {
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(target)) target = 'https://' + target; // "github.com" → URL
    else return settings;
  }
  if (!name) {
    if (isUrl(target)) { try { name = new URL(target).hostname.replace(/^www\./, ''); } catch { name = target; } }
    else name = path.basename(target).replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
  }
  const icon = await shortcutIcon(target);
  const list = Array.isArray(settings.shortcuts) ? settings.shortcuts : [];
  if (!list.some(s => s.target === target)) {
    list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name).slice(0, 40), target, icon });
  }
  settings.shortcuts = list;
  saveSettings();
  return settings;
});

ipcMain.handle('remove-shortcut', (_e, id) => {
  settings.shortcuts = (settings.shortcuts || []).filter(s => s.id !== id);
  saveSettings();
  return settings;
});

function launchShortcut(id) {
  const s = (settings.shortcuts || []).find(x => x.id === id);
  if (!s) return;
  if (isUrl(s.target)) shell.openExternal(s.target);
  else shell.openPath(s.target);
}
ipcMain.on('launch', (_e, id) => launchShortcut(id));
ipcMain.handle('picker-open', () => pickerOpen);
ipcMain.on('focus-window', () => { if (win) win.focus(); });
ipcMain.on('quit', () => { app.isQuitting = true; app.quit(); });

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(() => {
  createWindow();
  startCursorWatch();
  startBridge();

  tray = new Tray(trayIcon());
  tray.setToolTip('NotchMine');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => { userHidden = !userHidden; refreshVisibility(); tray.setContextMenu(buildTrayMenu()); });

  globalShortcut.register('CommandOrControl+Alt+N', () => {
    userHidden = !userHidden; refreshVisibility(); tray.setContextMenu(buildTrayMenu());
  });
  // meeting mode: mute / unmute the microphone from anywhere
  globalShortcut.register('CommandOrControl+Alt+M', () => bridgeCmd('mic toggle'));
  // party mode on / off
  globalShortcut.register('CommandOrControl+Alt+P', () => (partyWins.length ? stopParty() : startParty()));
  // open / close the panel without touching the mouse (made for game mode, works any time)
  globalShortcut.register('CommandOrControl+Alt+G', () => send('panel-toggle'));
  // back to the Windows taskbar (or to the NotchMine one again) from anywhere
  globalShortcut.register('CommandOrControl+Alt+T', () => toggleTaskbar());
  // the search box (its hotkey can be changed in Settings → Search)
  search.init({
    settings: () => settings,
    set: patch => { Object.assign(settings, patch); saveSettings(); send('settings', settings); if (tray) tray.setContextMenu(buildTrayMenu()); },
    spot: searchSpot,
    zoom,
    accent: () => lastAccent,
    clipboard: () => (settings.clipboardHistory ? clipHistory : []),
    copyText,
    launchShortcut,
    command: searchCommand,
    searching: on => send('search-state', on),
  });
  tray.setContextMenu(buildTrayMenu());               // now with the search hotkey
  setInterval(() => bridgeCmd('games'), 10 * 60 * 1000);   // pick up games Windows learned about meanwhile

  lyrics.init(path.join(app.getPath('userData'), 'lyrics-cache.json'));
  gameart.init(path.join(app.getPath('userData'), 'game-art'));
  loadRecentCaptures();
  seedImageSig();
  watchDownloads();

  screen.on('display-metrics-changed', (_e, _d, changed) => {                 // also: taskbar moved / resized
    placeWindow(); syncDeskEq();
    if ((changed || []).some(c => c !== 'workArea')) { syncWallpaper(true); syncDock(true); }   // size / scale, not just the work area
  });
  screen.on('display-added', () => { placeWindow(); syncDeskEq(); syncAmbient(); syncWallpaper(true); syncDock(true); tray.setContextMenu(buildTrayMenu()); });
  screen.on('display-removed', () => { placeWindow(); syncDeskEq(); syncAmbient(); syncWallpaper(true); syncDock(true); tray.setContextMenu(buildTrayMenu()); });
  syncDeskEq();
  setTimeout(() => syncWallpaper(), 1500);              // after the bridge is up (it places the wallpaper)
  setTimeout(() => syncDock(), 1500);                   // the NotchMine taskbar (or puts the Windows one back after a crash)

  sampleSystem();
  setInterval(sampleSystem, 1500);
  try { lastClip = clipboard.readText(); } catch { /* ignore */ }
  setInterval(pollClipboard, 1000);

  // Start with Windows: on by default for the real app (first run only, so a user who
  // switches it off stays off). Re-registering on every start keeps the path current
  // if the portable .exe was moved. Self-test runs never touch the login item.
  if (!process.env.NOTCH_SNAP) {
    if (app.isPackaged && !settings.loginInit) {
      // the installer's "Start NotchMine when Windows starts" box (no file = portable build: on)
      let pick = true;
      try { pick = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'setup.json'), 'utf8')).launchAtLogin !== false; } catch { /* no choice made */ }
      settings.loginInit = true; settings.launchAtLogin = pick; saveSettings();
    }
    if (settings.launchAtLogin) applyLoginItem(true);
  }
  if (process.env.NOTCH_SNAP) runSnapshots(process.env.NOTCH_SNAP);
});

// Self-test: renders each state and saves PNGs to the given folder, then quits.
async function runSnapshots(dir) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  fs.mkdirSync(dir, { recursive: true });
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(3500);
  let snapWin = null;              // a step can aim the next snapshot at another window (the settings window)
  const snap = async name => {
    const w = snapWin && !snapWin.isDestroyed() ? snapWin : win;
    snapWin = null;
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  };
  // open the settings window on a section (after optional notch / settings-window code) and snap that window
  const settingsShot = (sec, notchCode = '', winCode = '') => async () => {
    if (notchCode) await js(notchCode);
    const w = openSettings(sec);
    if (w.webContents.isLoading()) await new Promise(r => w.webContents.once('did-finish-load', r));
    await wait(500);
    await w.webContents.executeJavaScript(`showSec(${JSON.stringify(sec)}); ${winCode}`);
    snapWin = w;
  };
  const steps = (process.env.NOTCH_SNAP_STEPS || '').split(',').filter(Boolean);
  const fakeNotifs = `[
      {id:9001,app:'WhatsApp',title:'Riya',body:'Are we still on for dinner tonight? 🍕',time:Date.now()-120000,icon:null},
      {id:9002,app:'Discord',title:'#general · Arjun',body:'pushed the new build, can someone test it on Windows 11?',time:Date.now()-60000,icon:null},
      {id:9003,app:'Outlook',title:'Weekly sync moved to 4 PM',body:'Room 3B · Teams link inside',time:Date.now()-30000,icon:null}]`;
  const plan = [
    ['collapsed', ''],
    ['home', `__notchDebug.expand('home')`],
    ['tools', `__notchDebug.setTab('tools')`],
    ['system', `__notchDebug.setTab('system')`],
    ['apps', `__notchDebug.setTab('apps')`],
    ['apps-form', `document.getElementById('appAddBtn').click()`],
    ['shelf', `document.getElementById('appCancel').click(); __notchDebug.setTab('shelf')`],
    ['alerts-empty', `__notchDebug.setTab('alerts')`],
    ['alerts', `${fakeNotifs}.forEach(n => __notchDebug.addNotif(n, true)); __notchDebug.setTab('home'); __notchDebug.setTab('alerts')`],
    ['settings', settingsShot('general')],
    ['settings-look', settingsShot('look')],
    ['settings-widgets', settingsShot('widgets')],
    ['settings-search-box', settingsShot('search')],
    ['settings-search', settingsShot('general', '', `const q = document.getElementById('search'); q.value = 'screen'; runSearch(q.value)`)],
    ['peek-notif', `__notchDebug.collapse(); setTimeout(() => __notchDebug.peekNotif(${fakeNotifs}[0]), 50)`],
    ['theme-aurora', `__notchDebug.patchSettings({theme:'aurora'}); __notchDebug.expand('home')`],
    ['theme-graphite', `__notchDebug.patchSettings({theme:'graphite', accentMode:'teal'})`],
    ['scale-xl', `__notchDebug.patchSettings({theme:'midnight', accentMode:'auto', scale:1.3}); __notchDebug.expand('system')`],
    ['scale-reset', `__notchDebug.patchSettings({scale:1}); __notchDebug.collapse()`],
    // ---- v3 live activities (events are simulated; nothing touches the real clipboard/network)
    ['lyrics-card', `__notchDebug.setTab('home'); __notchDebug.onMedia({type:'media',active:true,app:'Spotify.exe',title:'Neon Skyline',artist:'Demo Artist',album:'Demo',status:'Playing',position:62,duration:244,updatedAt:Date.now(),canPrev:true,canNext:true,canSeek:true,thumbId:77,thumb:null}); __notchDebug.expand('home'); setTimeout(() => document.getElementById('mcLyrBtn').click(), 2500)`],
    ['lyrics-card-2', `new Promise(r => setTimeout(r, 2500))`],
    ['lyrics-pill', `__notchDebug.collapse()`],
    ['fx-sun', `__notchDebug.patchSettings({ artFx: 'sun', vizPalette: 'rainbow' })`],
    ['idle-stats', `__notchDebug.onMedia({ type: 'media', active: false }); __notchDebug.S.pinned = false; __notchDebug.collapse()`],
    ['idle-stats-2', `new Promise(r => setTimeout(r, 1500))`],
    // ---- clean, neutral screenshots for the README (demo song, demo city, no personal data)
    ['readme-home', `__notchDebug.patchSettings({ artFx: 'orb', vizPalette: 'accent', accentMode: 'purple', theme: 'midnight' });
      __notchDebug.onMedia({ type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', album: 'Demo', status: 'Playing', position: 73, duration: 243, updatedAt: Date.now(), canPrev: true, canNext: true, canSeek: true, thumbId: 4242, thumb: null });
      document.getElementById('wxCity').textContent = 'Lisbon';
      __notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['readme-system', `__notchDebug.setTab('system')`],
    ['readme-pill', `__notchDebug.S.pinned = false; __notchDebug.collapse()`],
    ['readme-party', async () => {
      const demo = { type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', status: 'Playing', position: 80, duration: 243, updatedAt: Date.now(), canPrev: true, canNext: true, canSeek: true, thumbId: 4242, thumb: null };
      for (const theme of ['club', 'synthwave', 'warp']) {
        await js(`__notchDebug.patchSettings({ partyTheme: '${theme}', partyScreens: 'notch' }); notch.partyStart()`);
        await wait(1500);
        sendParty('media', { ...demo, updatedAt: Date.now() });
        await wait(3500);
        for (const w of partyWins) {
          const img = await w.webContents.capturePage();
          fs.writeFileSync(path.join(dir, `readme-party-${theme}.png`), img.resize({ width: 1280 }).toPNG());
        }
        stopParty();
        await wait(1500);
      }
    }],
    ['idle2-full', `__notchDebug.onMedia({ type: 'media', active: false }); __notchDebug.S.pinned = false; __notchDebug.collapse(); renderCompact()`],
    ['idle2-alerts', `__notchDebug.ALERTS.unread = 3; renderAlertBadge()`],
    ['idle2-battery-low', `__notchDebug.S.batt = { level: 0.17, charging: false, chargingTime: Infinity, dischargingTime: 2700 }; renderCompact()`],
    ['idle2-charging', `__notchDebug.S.batt = { level: 0.64, charging: true, chargingTime: 1800, dischargingTime: Infinity }; renderCompact()`],
    ['idle2-downloading', `__notchDebug.S.netBusyUntil = Date.now() + 60000; renderCompact()`],
    ['idle2-minimal', `__notchDebug.S.netBusyUntil = 0; __notchDebug.ALERTS.unread = 0; renderAlertBadge(); __notchDebug.patchSettings({ idleMinimal: true })`],
    ['idle2-settings', settingsShot('widgets', `__notchDebug.patchSettings({ idleMinimal: false })`)],
    ['idle-day', `__notchDebug.S.weather = { temp: 31, code: 2, isDay: true }; renderCompact()`],
    ['idle-rain-hot', `__notchDebug.S.weather = { temp: 26, code: 63, isDay: true }; __notchDebug.S.sys = { ...__notchDebug.S.sys, cpu: 93 }; renderCompact()`],
    // weather looks (Weather theme): pill + the Home card for each kind of sky
    ...[['sunny', 0, 1], ['partly', 2, 1], ['cloudy', 3, 1], ['night', 0, 0], ['fog', 45, 1], ['drizzle', 51, 1], ['rain', 63, 1], ['heavy', 65, 1], ['storm', 95, 1], ['snow', 73, 1]].flatMap(([n, code, day]) => [
      [`wx-${n}-pill`, `__notchDebug.onMedia({ type: 'media', active: false }); __notchDebug.patchSettings({ theme: 'weather', idleMinimal: false }); __notchDebug.S.pinned = false; __notchDebug.collapse(); __notchDebug.previewWeather(${code}, ${!!day}); new Promise(r => setTimeout(r, ${n === 'storm' ? 1800 : 1200}))`],
      ...(n === 'rain' ? [['wx-rain-music', `__notchDebug.onMedia({ type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', status: 'Playing', position: 62, duration: 244, updatedAt: Date.now(), canPrev: true, canNext: true, canSeek: true, thumbId: 6, thumb: null }); new Promise(r => setTimeout(r, 1200))`], ['wx-rain-music2', `new Promise(r => setTimeout(r, 4500))`]] : []),
      [`wx-${n}-card`, `__notchDebug.S.pinned = true; __notchDebug.expand('home'); new Promise(r => setTimeout(r, 1400))`],
      ...(n === 'rain' ? [['wx-rain-panel', `__notchDebug.setTab('system'); new Promise(r => setTimeout(r, 900))`]] : []),
    ]),
    ['home-volume', `__notchDebug.patchSettings({ theme: 'midnight' }); __notchDebug.S.volume = { level: 0.42, muted: false }; renderVolume(); __notchDebug.S.pinned = true; __notchDebug.expand('home'); __notchDebug.onMedia({ type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', status: 'Playing', position: 62, duration: 244, updatedAt: Date.now(), canPrev: true, canNext: true, canSeek: true, thumbId: 7, thumb: null }); new Promise(r => setTimeout(r, 1200))`],
    // ---- live wallpaper: turn it on, check every screen got one behind the icons and that it animates
    ['wallpaper-on', async () => {
      await js(`__notchDebug.patchSettings({ wpOn: true, wpMode: 'auto' }); __notchDebug.previewWeather(63, true)`);
      await wait(6000);
      for (const [id, r] of wpRecs) console.log(`[wallpaper-test] display ${id} attached=${r.attached} hwnd=${r.hwnd}`);
    }],
    // ---- NotchMine taskbar: switch to each style, look at the dock, then put the Windows taskbar back
    ['taskbar-test', async () => {
      const wa0 = screen.getPrimaryDisplay().workArea;
      console.log('[taskbar-test] before: work area', JSON.stringify(wa0));
      for (const style of ['dockeq', 'dock', 'bar']) {
        await js(`__notchDebug.patchSettings({ tbStyle: '${style}' })`);
        await wait(3500);
        const wa = screen.getPrimaryDisplay().workArea;
        const d = dockWins.find(e => e.displayId === screen.getPrimaryDisplay().id);
        if (!d) { console.log('[taskbar-test]', style, 'NO DOCK WINDOW'); continue; }
        const info = await d.win.webContents.executeJavaScript(`JSON.stringify({ apps: window.__dock.state().apps.map(a => a.name + (a.windows.length ? '*' + a.windows.length : '') + (a.icon ? '' : '(no icon)')), media: !!window.__dock.state().media })`);
        console.log('[taskbar-test]', style, 'dock windows:', dockWins.length, '| work area', JSON.stringify(wa), '| visible', d.win.isVisible(), '|', info);
        const sb = screen.getPrimaryDisplay().bounds, wb = d.win.getBounds();
        const inner = await d.win.webContents.executeJavaScript(`JSON.stringify({ ih: innerHeight, bar: (() => { const r = document.getElementById(document.getElementById('bar').hidden ? 'dock' : 'bar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })() })`);
        console.log('[taskbar-test]', style, 'screen bottom', sb.y + sb.height, '| window', JSON.stringify(wb), 'ends at', wb.y + wb.height, '|', inner);
        if (style === 'dockeq') {                                   // hover: the dock opens up
          await d.win.webContents.executeJavaScript(`document.getElementById('dock').dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))`);
          await wait(900);
          await d.win.webContents.executeJavaScript(`(() => { const ic = [...document.querySelectorAll('#dock .ico[data-key]')].find(x => x.querySelector('.dots')); if (ic) ic.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); })()`);
          await wait(500);
        }
        const img = await d.win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `taskbar-${style}.png`), img.toPNG());
      }
      await js(`__notchDebug.patchSettings({ tbStyle: 'windows' })`);
      await wait(2500);
      console.log('[taskbar-test] back to Windows: dock windows', dockWins.length, '| work area', JSON.stringify(screen.getPrimaryDisplay().workArea), '| orig remembered', settings.tbOrig);
    }],
    ['taskbar-settings', settingsShot('taskbar')],
    ['wallpaper-settings', settingsShot('wallpaper')],
    ['wallpaper-manual', `__notchDebug.patchSettings({ wpMode: 'manual', wpStyle: 'aurora' }); new Promise(r => setTimeout(r, 1500))`],
    ['wallpaper-off', async () => {
      await js(`__notchDebug.patchSettings({ wpOn: false, wpMode: 'auto' })`);
      await wait(1500);
      console.log('[wallpaper-test] after off: host running =', !!wpHost);
    }],
    ['wx-settings', settingsShot('look')],
    ['wx-reset', `__notchDebug.patchSettings({ theme: 'midnight' }); __notchDebug.S.pinned = false; __notchDebug.collapse()`],
    ['header-stats', `__notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['settings-widgets2', settingsShot('widgets')],
    ['settings-side', settingsShot('side')],
    ['side-pill', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      // pretend Chrome just came to the front on the notch's screen
      sideTestNoWatch = true;
      const b = targetDisplay().bounds;
      handleBridge({ type: 'foreground', hwnd: 1, max: true, exe: 'chrome.exe', name: 'Google Chrome', path: '', cls: 'Chrome_WidgetWin_1', l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height });
      await wait(400);
      console.log('[side] active:', sideActive, 'window:', JSON.stringify(win.getBounds()));
    }],
    ['side-idle', `new Promise(r => setTimeout(r, 900))`],    // see-through while the mouse is away
    ['side-hover', async () => {                               // mouse on it: back to normal (open on click only, so it stays a pill)
      const delay = await js(`__notchDebug.S.settings.openDelay ?? 140`);
      await js(`__notchDebug.S.settings.openDelay = -1`);
      send('hover', true);
      await wait(700);
      await snap('side-hover-on');
      send('hover', false);                                    // …and see-through again once it leaves (the step's own shot)
      await js(`__notchDebug.S.settings.openDelay = ${JSON.stringify(delay)}`);
    }],
    ['side-timer', `__notchDebug.tmSet('focus'); __notchDebug.tmStart()`],
    ['side-peek', `__notchDebug.peekVolume()`],
    ['side-music-wait', `__notchDebug.T.running = false; __notchDebug.tmSet('focus'); __notchDebug.onMedia({type:'media',active:true,app:'Spotify.exe',title:'Neon Skyline',artist:'Demo Artist',status:'Playing',position:62,duration:244,updatedAt:Date.now(),canPrev:true,canNext:true,canSeek:true,thumbId:5,thumb:null}); new Promise(r => setTimeout(r, 4200))`],
    ['side-music', `__notchDebug.onMedia({type:'media',active:true,app:'Spotify.exe',title:'Neon Skyline',artist:'Demo Artist',status:'Playing',position:62,duration:244,updatedAt:Date.now(),canPrev:true,canNext:true,canSeek:true,thumbId:5,thumb:null})`],
    ['side-open', `__notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['side-off', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      handleBridge({ type: 'foreground', exe: 'code.exe', name: 'Visual Studio Code', path: '', cls: 'Chrome_WidgetWin_1', l: 0, t: 0, r: 100, b: 100 });
      await wait(400);
      console.log('[side] after switching app, active:', sideActive);
    }],
    // ---- game mode: a game (found by its library folder) comes to the front for a few seconds
    ['game-pill', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      const b = targetDisplay().bounds;
      snapFgLock = true;
      onForeground({ type: 'foreground', hwnd: 7, pid: 3999999, exe: 'forzahorizon5.exe', name: 'Forza Horizon 5', path: 'E:\\steam\\steamapps\\common\\ForzaHorizon5\\ForzaHorizon5.exe', cls: 'ForzaHorizon5', l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height, max: true });
      await wait(3600);
      console.log('[game] on:', gameOn(), 'window:', JSON.stringify(win.getBounds()));
      await js(`__notchDebug.addNotif({ id: 9100, app: 'Discord', title: 'Arjun', body: 'gg', time: Date.now(), icon: null })`);   // held, not shown
    }],
    ['game-open', `__notchDebug.S.pinned = true; __notchDebug.expand()`],
    ['game-settings', settingsShot('game')],
    ['game-ask', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      send('game-ask', { exe: 'mystery.exe', name: 'Mystery Racer', path: '', icon: null });
    }],
    ['game-summary', async () => {
      await js(`__notchDebug.setMode('collapsed')`);
      onForeground({ type: 'foreground', exe: 'code.exe', name: 'Visual Studio Code', path: '', cls: 'Chrome_WidgetWin_1', l: 0, t: 0, r: 100, b: 100 });
      await wait(5600);                                      // leaves game mode; the (fake) game isn't running → summary
      console.log('[game] after switching app, on:', gameOn());
      snapFgLock = false;
    }],
    ['phone-warn', `__notchDebug.S.pinned = true; __notchDebug.patchSettings({ phoneWarned: false }); __notchDebug.expand('shelf'); document.getElementById('phoneBtn').click()`],
    ['phone-recv', async () => {
      const qr = await require('qrcode').toDataURL('http://192.168.1.42:52814/3f9c1a7be2d04c51a8e6f0b2d9c47e15', { margin: 1, width: 360 });
      return js(`showPhonePanel(true); applyPhone(${JSON.stringify({ running: true, qr, url: 'http://192.168.1.42:52814/…', network: 'Wi-Fi', pc: require('os').hostname(), received: 2, receiving: { name: 'IMG_20261113_204512.jpg', bytes: 3.4e6, total: 5.1e6, speed: 2.6e6 } })})`);
    }],
    ['phone-page', async () => {
      const pw = new BrowserWindow({ width: 400, height: 860, show: false, webPreferences: { offscreen: false } });
      const html = require('./phone').__page('demo', { pc: require('os').hostname(), network: 'Wi-Fi' });
      await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await pw.webContents.executeJavaScript(`(() => { ping = () => {}; log = () => {}; prep(true); prepAt = Date.now() - 14000; const mk = (n, s, t) => new File([new Uint8Array(s)], n, { type: t });
        [mk('IMG_2041.jpg', 4200000, 'image/jpeg'), mk('Trip video.mp4', 18500000, 'video/mp4'), mk('Notes.pdf', 380000, 'application/pdf')].forEach(add);
        sentBytes = 9800000; busy = true; speed = 2600000; overall();
        const lis = document.querySelectorAll('li'); lis[0].classList.add('ok'); lis[0].querySelector('.fb i').style.width = '100%'; lis[0].querySelector('.st').textContent = '✓'; lis[0].querySelector('.p').textContent = 'Sent';
        lis[1].querySelector('.fb i').style.width = '30%'; lis[1].querySelector('.p').textContent = '30%'; lis[1].querySelector('.st').textContent = '⬆'; })()`);
      await wait(600);
      const img = await pw.webContents.capturePage();
      fs.writeFileSync(path.join(dir, 'phone-site.png'), img.toPNG());
      pw.destroy();
    }],
    ['settings-deskeq', settingsShot('deskeq', `__notchDebug.patchSettings({ deskEq: true, deskEqIntensity: 70, deskEqHeight: 45 })`)],
    ['settings-deskeq-style', settingsShot('deskeq', '', `setTimeout(() => document.querySelector('.dd[data-dd=deskEqStyle] .dd-btn').click(), 300)`)],
    ['deskeq-live', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      await wait(3500);
      let i = 0;
      for (const e of eqWins) {
        const b = e.win.getBounds();
        const img = await e.win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `deskeq-${++i}.png`), img.resize({ width: Math.round(img.getSize().width / 2) }).toPNG());
        console.log('[deskeq] window', i, JSON.stringify(b), 'audio:', await e.win.webContents.executeJavaScript('!!window.__eq.AU.an'), 'vis:', await e.win.webContents.executeJavaScript('window.__eq.vis().toFixed(2)'));
      }
      console.log('[deskeq] click-through: ignore=', eqWins.every(e => !e.win.isFocusable()));
    }],
    ['deskeq-styles', async () => {                 // every style, on the synthetic beat (no real audio needed)
      const prevStyle = settings.deskEqStyle || 'bars';
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse(); __notchDebug.patchSettings({ deskEq: true })`);
      await wait(2500);
      const demo = { type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', status: 'Playing', position: 80, duration: 243, canPrev: true, canNext: true, canSeek: true };
      const e = eqWins[0];
      if (!e) { console.log('[deskeq-styles] no eq window'); return; }
      await e.win.webContents.executeJavaScript('window.__eq.AU.an = null; document.documentElement.style.background = "#0b0b10"');   // dark backdrop for the shots
      for (const style of ['bars', 'line', 'wave', 'dots', 'hills', 'reflect', 'blocks', 'neon', 'ridges', 'fountain', 'bubbles', 'city', 'aurora', 'heartbeat', 'lasers']) {
        await js(`__notchDebug.patchSettings({ deskEqStyle: '${style}' })`);
        for (let k = 0; k < 8; k++) { sendParty('media', { ...demo, updatedAt: Date.now() }); await wait(250); }
        const img = await e.win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `deskeq-style-${style}.png`), img.resize({ width: Math.round(img.getSize().width / 2) }).toPNG());
      }
      await js(`__notchDebug.patchSettings({ deskEqStyle: '${prevStyle}' })`);
    }],
    ['theme-synthwave', `__notchDebug.patchSettings({ partyTheme: 'synthwave', vizPalette: 'accent' })`],
    ['theme-synthwave-sunset', `__notchDebug.patchSettings({ partyTheme: 'synthwave', vizPalette: 'sunset' })`],
    ['theme-warp', `__notchDebug.patchSettings({ partyTheme: 'warp', vizPalette: 'accent' })`],
    ['home-party-btn', `__notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['settings-party', settingsShot('party')],
    ['party-eq-styles', async () => {               // party mode's bottom equalizer follows the desktop eq's Style
      const prevStyle = settings.deskEqStyle || 'bars';
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse(); notch.partyStart()`);
      await wait(3000);
      const demo = { type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', status: 'Playing', position: 80, duration: 243, canPrev: true, canNext: true, canSeek: true };
      const m = partyWins.find(w => w.webContents.getURL().includes('role=main')) || partyWins[0];
      if (m) {
        await m.webContents.executeJavaScript('window.__party.AU.an = null');
        for (const style of ['bars', 'ridges', 'city', 'wave', 'blocks']) {
          await js(`__notchDebug.patchSettings({ deskEqStyle: '${style}' })`);
          for (let k = 0; k < 8; k++) { sendParty('media', { ...demo, updatedAt: Date.now() }); await wait(250); }
          const img = await m.webContents.capturePage();
          fs.writeFileSync(path.join(dir, `party-eq-${style}.png`), img.resize({ width: Math.round(img.getSize().width / 2) }).toPNG());
        }
      }
      await js(`__notchDebug.patchSettings({ deskEqStyle: '${prevStyle}' })`);
      stopParty();
      await wait(1200);
    }],
    ['party', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse(); notch.partyStart()`);
      await wait(5000);
      let i = 0;
      for (const w of partyWins) {
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `party-screen${++i}.png`), img.resize({ width: Math.round(img.getSize().width / 2) }).toPNG());
      }
      const m = partyWins.find(w => w.webContents.getURL().includes('role=main')) || partyWins[0];
      if (m) {
        m.webContents.sendInputEvent({ type: 'mouseMove', x: 400, y: 300 });
        await wait(900);
        const img = await m.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'party-controls.png'), img.resize({ width: Math.round(img.getSize().width / 2) }).toPNG());
        console.log('[party] windows:', partyWins.length, 'audio:', await m.webContents.executeJavaScript('!!window.__party.AU.an'), 'bass:', await m.webContents.executeJavaScript('window.__party.AU.bass.toFixed(2)'));
      }
      stopParty();
      await wait(1200);
      console.log('[party] after stop windows:', partyWins.length, 'notch visible:', win.isVisible());
    }],
    ['island-collapsed', `__notchDebug.patchSettings({ shape: 'island' }); __notchDebug.collapse()`],
    ['island-expanded', `__notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['island-settings', settingsShot('general')],
    ['notch-back', `__notchDebug.S.pinned = false; __notchDebug.patchSettings({ shape: 'notch' }); __notchDebug.collapse()`],
    ['orb-accent', `__notchDebug.patchSettings({ artFx: 'orb', vizPalette: 'accent', accentMode: 'purple' }); __notchDebug.collapse()`],
    ['orb-rainbow', `__notchDebug.patchSettings({ vizPalette: 'rainbow' })`],
    ['sun-rainbow', `__notchDebug.patchSettings({ artFx: 'sun' })`],
    ['home-rainbow', `__notchDebug.S.pinned = true; __notchDebug.expand('home')`],
    ['settings-custom', settingsShot('look', `__notchDebug.patchSettings({ vizPalette: 'custom', vizCustom: ['#ff3787', '#ffd60a', '#40c8e0'], vizCustomCount: 3 })`)],
    ['home-custom', `__notchDebug.setTab('home')`],
    ['orb-1', `__notchDebug.patchSettings({ artFx: 'orb' }); __notchDebug.collapse()`],
    ['orb-2', `new Promise(r => setTimeout(r, 170))`],
    ['orb-3', `new Promise(r => setTimeout(r, 330))`],
    ['orb-4', `new Promise(r => setTimeout(r, 90))`],
    ['settings-fx', settingsShot('look')],
    ['spark-1', `__notchDebug.collapse()`],
    ['spark-2', `new Promise(r => setTimeout(r, 170))`],
    ['spark-3', `new Promise(r => setTimeout(r, 330))`],
    ['spark-4', `new Promise(r => setTimeout(r, 90))`],
    ['lyrics-long', `LIVE.lyrics = { synced: [{ t: 0, text: 'And I keep on waiting for the city lights to call my name tonight' }] }; LIVE.lyricIdx = -1; __notchDebug.collapse()`],
    ['lyrics-xlong', `LIVE.lyrics = { synced: [{ t: 0, text: 'This one is a really really long lyric line that keeps going and going far past what any reasonable notch could ever possibly show at once' }] }; LIVE.lyricIdx = -1`],
    ['lyrics-xlong-scrolled', `new Promise(r => setTimeout(r, 2600))`],
    ['home-spectrum', `__notchDebug.expand('home'); if (LIVE.showLyrics) document.getElementById('mcLyrBtn').click()`],
    ['privacy-peek', () => send('privacy', { cam: ['Microsoft Teams'], mic: ['Discord'] })],
    ['privacy-pill', `__notchDebug.collapse()`],
    ['privacy-header', `__notchDebug.expand('home')`],
    ['mic-muted', () => { send('mic', { muted: true, present: true }); return js(`__notchDebug.collapse()`); }],
    ['mic-pill', `new Promise(r => setTimeout(r, 1500))`],
    ['system-mixer', () => { send('mic', { muted: false, present: true }); return js(`__notchDebug.expand('system'); setTimeout(() => document.getElementById('mixerBtn').click(), 300)`); }],
    ['peek-capture', () => {
      js(`document.getElementById('mixerClose').click(); __notchDebug.collapse()`);
      const p = process.env.NOTCH_SNAP_IMG;
      const img = nativeImage.createFromPath(p);
      setTimeout(() => send('capture', { kind: 'capture', path: p, name: 'Screenshot 2026-11-13 16.20.11.png', time: Date.now(), w: img.getSize().width, h: img.getSize().height, thumb: img.resize({ width: 240 }).toDataURL() }), 600);
    }],
    ['peek-download', () => send('download', { kind: 'download', path: process.env.NOTCH_SNAP_IMG, name: 'Quarterly report final.pdf', size: 2483000, time: Date.now(), icon: null })],
    ['peek-usb', () => send('drive', { added: true, letter: 'E:', label: 'SANDISK', size: 32e9, free: 28.4e9 })],
    ['peek-headphones', () => send('audio-device', { name: 'Headphones (WH-1000XM5)', initial: false })],
    ['peek-caps', () => send('lockkey', { key: 'Caps Lock', on: true })],
    ['shelf-recent', `__notchDebug.expand('shelf')`],
    ['shelf-phone', async () => {
      const qr = await require('qrcode').toDataURL('http://192.168.1.42:52814/3f9c1a7be2d04c51a8e6f0b2d9c47e15', { margin: 1, width: 360 });
      return js(`applyPhone(${JSON.stringify({ running: true, qr, url: 'http://192.168.1.42:52814/…', network: 'Wi-Fi', received: 0 })}); showPhonePanel(true)`);
    }],
    ['settings-live', settingsShot('live', `applyPhone({running:false})`)],
    ['tools-quiet', `__notchDebug.setTab('tools')`],
    ['apps-added', `(async () => { let s = await notch.addShortcut({ target: 'C:\\\\Windows\\\\System32\\\\notepad.exe' }); s = await notch.addShortcut({ target: 'github.com' }); s = await notch.addShortcut({ name: 'Calendar', target: 'https://calendar.google.com' }); __notchDebug.S.settings = s; renderApps(); __notchDebug.expand('apps'); })()`],
    ['apps-hold', `(() => { ['pointerdown','mousedown','mouseup','click','dblclick'].forEach(t => document.addEventListener(t, e => console.warn('EV ' + t + ' ' + e.button + ' ' + (e.target.className || e.target.tagName) + ' @' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true)); __notchDebug.expand('apps'); __notchDebug.S.pinned = true; setTimeout(() => { const r = document.querySelector('.app-tile[data-action=calculator]').getBoundingClientRect(); console.warn('TILE ' + JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, zoom: window.devicePixelRatio })); }, 600); })()`],
    ['apps-hold-wait', `new Promise(r => setTimeout(r, 14000))`],
    ['viz-check', `(() => { const v = __notchDebug.VIZ; let n = 0; const t = setInterval(() => { console.warn('VIZCHECK ' + JSON.stringify({ playing: __notchDebug.S.media.status, live: document.body.classList.contains('viz-live'), failed: v.failed, bars: [...document.querySelectorAll('#mcEq i')].map(i => i.style.height).join(' ') })); if (++n >= 6) clearInterval(t); }, 150); })()`],
    ['fake-media-home', `__notchDebug.setTab('home'); __notchDebug.onMedia({type:'media',active:true,app:'Spotify.exe',title:'Neon Skyline (Extended Mix)',artist:'Demo Artist',album:'Demo',status:'Playing',position:73,duration:243,updatedAt:Date.now(),canPrev:true,canNext:true,canSeek:true,thumbId:99,thumb:(()=>{const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,96,96);g.addColorStop(0,'#ff5f6d');g.addColorStop(1,'#ffc371');x.fillStyle=g;x.fillRect(0,0,96,96);x.fillStyle='#2b1055';x.beginPath();x.arc(48,48,26,0,7);x.fill();return c.toDataURL();})()})`],
    ['fake-media-collapsed', `__notchDebug.collapse()`],
    ['peek-track', `__notchDebug.peekTrack()`],
    ['peek-volume', `__notchDebug.collapse(); setTimeout(()=>__notchDebug.peekVolume(), 50)`],
    ['timer-collapsed', `__notchDebug.collapse(); __notchDebug.tmSet('focus'); __notchDebug.tmStart()`],
    // ---- Stacked layout: every section in a tall column; a section's title opens its full page
    ['stacked-idle', `__notchDebug.T.running = false; __notchDebug.tmSet('focus'); __notchDebug.onMedia({ type: 'media', active: false });
      __notchDebug.S.pinned = false; __notchDebug.collapse(); __notchDebug.patchSettings({ layout: 'stacked' });
      setTimeout(() => { __notchDebug.S.pinned = true; __notchDebug.expand(); }, 300)`],
    ['stacked-music', `__notchDebug.onMedia({ type: 'media', active: true, app: 'Spotify.exe', title: 'Neon Skyline', artist: 'Demo Artist', album: 'Demo', status: 'Playing', position: 73, duration: 243, updatedAt: Date.now(), canPrev: true, canNext: true, canSeek: true, thumbId: 4242, thumb: null });
      ${fakeNotifs}.forEach(n => __notchDebug.addNotif(n, true)); __notchDebug.tmStart();
      __notchDebug.S.clipboard = ['Meeting moved to 4 PM, room 3B', 'https://github.com/example/project/pull/42', 'npm run dist']; renderClipboard();
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 160, 90); g.addColorStop(0, '#0a84ff'); g.addColorStop(1, '#bf5af2'); x.fillStyle = g; x.fillRect(0, 0, 160, 90);
      addRecent({ kind: 'download', path: 'C:/demo/report.pdf', name: 'Quarterly report.pdf', size: 2483000, time: Date.now() - 60000, icon: null });
      addRecent({ kind: 'capture', path: 'C:/demo/shot.png', name: 'Screenshot 16.20.png', time: Date.now(), w: 1920, h: 1080, thumb: c.toDataURL() })`],
    ['stacked-detail', `__notchDebug.setTab('apps')`],
    ['stacked-back', `document.getElementById('stackBack').click()`],
    ['stacked-home', `__notchDebug.setTab('home')`],
    ['stacked-tools', `__notchDebug.setTab('tools')`],
    ['stacked-system', `__notchDebug.setTab('system')`],
    ['stacked-shelf', `__notchDebug.setTab('shelf')`],
    ['stacked-alerts', `__notchDebug.setTab('alerts')`],
    // a page's content is equally wide with or without a scrollbar (else the panel can resize-loop)
    ['stacked-width-check', `(() => { const p = document.querySelector('.page.active'); const w = () => p.clientWidth - parseFloat(getComputedStyle(p).paddingRight);
      const a = w(); p.style.bottom = '60%'; const b = w(), scrolls = p.scrollHeight > p.clientHeight; p.style.bottom = '';
      console.warn('WIDTH ' + JSON.stringify({ normal: a, withScrollbar: b, scrolls, overview: document.getElementById('ov').offsetWidth })); })()`],
    ['stacked-side', async () => {
      await js(`__notchDebug.S.pinned = false; __notchDebug.collapse()`);
      sideTestNoWatch = true;
      const b = targetDisplay().bounds;
      handleBridge({ type: 'foreground', hwnd: 1, max: true, exe: 'chrome.exe', name: 'Google Chrome', path: '', cls: 'Chrome_WidgetWin_1', l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height });
      await wait(600);
      await js(`__notchDebug.S.pinned = true; __notchDebug.expand()`);
    }],
    ['stacked-tabs-again', `__notchDebug.S.pinned = false; __notchDebug.collapse(); __notchDebug.patchSettings({ layout: 'tabs' }); setTimeout(() => { __notchDebug.S.pinned = true; __notchDebug.expand('home'); }, 300)`],
  ];
  for (const [name, code] of plan) {
    if (steps.length && !steps.includes(name)) continue;
    if (typeof code === 'function') await code();
    else if (code) await js(code);
    await wait(1100);
    await snap(name);
  }
  app.isQuitting = true;
  app.quit();
}

app.on('second-instance', () => { userHidden = false; refreshVisibility(); send('pulse'); });
app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (wpHost) { const h = wpHost; stopWpHost(); try { h.kill(); } catch { /* gone */ } bridgeCmd('wp refresh'); }   // the normal wallpaper comes back
  for (const e of dockWins) dockClose(e);                // the Windows taskbar comes back (the bridge also does it on exit)
  if (tbApplied) bridgeCmd(settings.tbOrig != null ? `tb restore ${settings.tbOrig}` : 'tb show');
  // Start / search layout back to the user's own (tbOrigLayout is kept: if the bridge dies before doing it, the next start does)
  if (tbLayoutSent) bridgeCmd(settings.tbOrigLayout ? `tb layout-restore ${settings.tbOrigLayout.al} ${settings.tbOrigLayout.mode}` : 'tb layout-back');
  if (bridge) { try { bridge.stdin.end(); bridge.kill(); } catch { /* ignore */ } }
  phone.stop('quit');
  search.quit();
});
app.on('window-all-closed', () => app.quit());
