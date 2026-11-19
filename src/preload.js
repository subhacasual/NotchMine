'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CHANNELS = [
  'hover', 'blur', 'media', 'volume', 'brightness', 'sys', 'clipboard', 'settings',
  'open-tab', 'pulse', 'net', 'notif', 'notif-status',
  'mixer', 'privacy', 'mic', 'audio-device', 'lockkey', 'drive', 'capture', 'download', 'phone-file', 'phone-status',
  'party', 'party-plan', 'party-sync', 'accent', 'anchor', 'drag-state', 'side', 'conn', 'fullscreen',
  'game', 'game-ask', 'game-summary', 'panel-toggle',
];

contextBridge.exposeInMainWorld('notch', {
  on(channel, cb) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  init: () => ipcRenderer.invoke('init'),
  setSettings: patch => ipcRenderer.invoke('settings-set', patch),
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
  partySync: s => ipcRenderer.send('party-sync', s),
  reportAccent: rgb => ipcRenderer.send('accent-changed', rgb),
  phoneStart: () => ipcRenderer.invoke('phone-start'),
  phoneStop: () => ipcRenderer.invoke('phone-stop'),

  copyText: t => ipcRenderer.send('copy-text', t),
  clearClipboard: () => ipcRenderer.send('clear-clipboard-history'),
  action: name => ipcRenderer.send('action', name),
  focus: () => ipcRenderer.send('focus-window'),
  quit: () => ipcRenderer.send('quit'),
});
