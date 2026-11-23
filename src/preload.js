'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = [
  'hover', 'blur', 'media', 'volume', 'brightness', 'sys', 'clipboard', 'settings',
  'open-tab', 'pulse', 'net', 'notif', 'notif-status',
  'mixer', 'privacy', 'mic', 'audio-device', 'lockkey', 'drive', 'capture', 'download', 'phone-file', 'phone-status',
  'party', 'party-plan', 'party-sync', 'accent', 'anchor', 'drag-state', 'side', 'conn', 'fullscreen',
  'game', 'game-ask', 'game-summary', 'panel-toggle', 'wp-weather', 'wp-paused', 'dock-state', 'dock-over', 'settings-goto', 'wp-bg', 'my-wallpaper',
  'audio', 'audio-want', 'amb-src', 'amb-peek',
  'search-open', 'search-close', 'search-status', 'search-apps', 'search-accent', 'search-state', 'search-preview-state',
];

contextBridge.exposeInMainWorld('notch', {
  on(channel, cb) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  init: () => ipcRenderer.invoke('init'),
  setSettings: patch => ipcRenderer.invoke('settings-set', patch),
  openSettings: sec => ipcRenderer.send('open-settings', sec || ''),
  settingsInit: () => ipcRenderer.invoke('settings-init'),
  setHitRect: r => ipcRenderer.send('hit-rect', r),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  displays: () => ipcRenderer.invoke('displays'),
  sideApps: () => ipcRenderer.invoke('side-apps'),
  appIcon: p => ipcRenderer.invoke('app-icon', p),
  gameAnswer: a => ipcRenderer.send('game-answer', a),

  media: (cmd, arg) => ipcRenderer.send('media', cmd, arg),
  setVolume: v => ipcRenderer.send('volume', v),
  toggleMute: () => ipcRenderer.send('mute'),
  setBrightness: v => ipcRenderer.send('brightness', v),
  refreshBrightness: () => ipcRenderer.send('brightness-refresh'),

  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  fileIcon: p => ipcRenderer.invoke('file-icon', p),
  fileExists: p => ipcRenderer.invoke('file-exists', p),
  openPath: p => ipcRenderer.send('open-path', p),
  showInFolder: p => ipcRenderer.send('show-in-folder', p),
  startDrag: p => ipcRenderer.send('start-drag', p),

  pickFile: () => ipcRenderer.invoke('pick-file'),
  addShortcut: s => ipcRenderer.invoke('add-shortcut', s),
  removeShortcut: id => ipcRenderer.invoke('remove-shortcut', id),
  launch: id => ipcRenderer.send('launch', id),

  clearNotifs: () => ipcRenderer.send('clear-notifs'),

  mixerGet: () => ipcRenderer.send('mixer-get'),
  mixerSet: (pid, v) => ipcRenderer.send('mixer-set', pid, v),
  mixerMute: pid => ipcRenderer.send('mixer-mute', pid),
  micToggle: () => ipcRenderer.send('mic-toggle'),
  lyrics: q => ipcRenderer.invoke('lyrics', q),
  artwork: q => ipcRenderer.invoke('artwork', q),
  ocr: p => ipcRenderer.invoke('ocr', p),
  captureSave: p => ipcRenderer.invoke('capture-save', p),
  captureCopy: p => ipcRenderer.send('capture-copy', p),
  recentRemove: p => ipcRenderer.send('recent-remove', p),
  partyStart: () => ipcRenderer.send('party-start'),
  partyStop: () => ipcRenderer.send('party-stop'),
  partyInit: () => ipcRenderer.invoke('party-init'),
  wpInit: () => ipcRenderer.invoke('wp-init'),
  ambInit: () => ipcRenderer.invoke('amb-init'),
  ambPreview: () => ipcRenderer.send('amb-preview'),
  myWallpaper: () => ipcRenderer.invoke('my-wallpaper'),
  reportWeather: w => ipcRenderer.send('weather-report', w),
  dockInit: () => ipcRenderer.invoke('dock-init'),
  dockRects: r => ipcRenderer.send('dock-rects', r),
  dockCmd: c => ipcRenderer.send('dock-cmd', c),
  partySync: s => ipcRenderer.send('party-sync', s),
  reportAccent: rgb => ipcRenderer.send('accent-changed', rgb),
  audioFrame: f => ipcRenderer.send('audio-frame', f),
  phoneStart: () => ipcRenderer.invoke('phone-start'),
  phoneStop: () => ipcRenderer.invoke('phone-stop'),

  copyText: t => ipcRenderer.send('copy-text', t),
  clearClipboard: () => ipcRenderer.send('clear-clipboard-history'),
  action: name => ipcRenderer.send('action', name),
  focus: () => ipcRenderer.send('focus-window'),
  quit: () => ipcRenderer.send('quit'),

  // search box (search.html) + Settings → Search
  searchFiles: q => ipcRenderer.invoke('search-files', q),
  searchIcon: key => ipcRenderer.invoke('search-icon', key),
  searchRun: (item, q, alt) => ipcRenderer.send('search-run', item, q, alt || ''),
  searchHide: () => ipcRenderer.send('search-hide'),
  searchDrag: p => ipcRenderer.send('search-drag', p),
  searchForget: key => ipcRenderer.send('search-forget', key),
  searchStatus: () => ipcRenderer.invoke('search-status'),
  searchSetHotkey: accel => ipcRenderer.invoke('search-hotkey', accel),
  searchPauseHotkey: on => ipcRenderer.send('search-hotkey-pause', !!on),
  searchEverything: what => ipcRenderer.send('search-everything', what),
  searchOpen: () => ipcRenderer.send('search-open'),
  searchPreview: req => ipcRenderer.send('search-preview', req || null),
  searchPreviewOpen: q => ipcRenderer.send('search-preview-open', q),
});
