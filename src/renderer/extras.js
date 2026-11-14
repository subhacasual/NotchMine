'use strict';
/* NotchMine v2 widgets: themes & settings, Launchpad, notifications, network, audio visualizer.
   Shares globals (S, api, $, peek, icon, esc, clamp, …) with app.js. */

// ================================================================== settings: sections, segments, themes, accents
document.querySelectorAll('#setNav button[data-sec]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#setNav button[data-sec]').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.set-sec').forEach(s => s.classList.toggle('active', s.dataset.sec === b.dataset.sec));
}));

async function patchSettings(patch) {
  S.settings = await api.setSettings(patch);
  applySettingsUI();
}
document.querySelectorAll('.seg[data-seg]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  const patch = { [seg.dataset.seg]: seg.dataset.type === 'str' ? b.dataset.v : Number(b.dataset.v) };
  if (seg.dataset.seg === 'posX') patch.posY = 0;            // Left / Center / Right = along the top
  patchSettings(patch);
}));

// screens to choose from (rebuilt whenever settings are shown, so plugging in a monitor shows up)
async function renderScreens() {
  const list = await api.displays();
  $('screenRow').style.display = list.length > 1 ? '' : 'none';
  const cur = S.settings.displayId ?? (list.find(d => d.primary) || {}).id;
  $('screenSeg').innerHTML = list.map(d =>
    `<button data-v="${d.id}" class="${d.id === cur ? 'active' : ''}" title="${d.w}×${d.h}${d.primary ? ' · main screen' : ''}">${d.index}${d.primary ? ' ★' : ''}</button>`).join('');
}
$('themePick').addEventListener('click', e => {
  const b = e.target.closest('button[data-theme]');
  if (b) patchSettings({ theme: b.dataset.theme });
});
// ================================================================== visualizer colours (palette engine)
const VIZ_PRESETS = {
  rainbow: ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#bf5af2'],
  sunset: ['#ff5f6d', '#ff9966', '#ffc371'],
  ocean: ['#00c6ff', '#0072ff', '#7b5cff'],
  neon: ['#ff00cc', '#7a5cff', '#00f0ff'],
  fire: ['#ff2a00', '#ff7b00', '#ffd000'],
  aurora: ['#30d0c0', '#7b5cff', '#ff3787'],
};
let vizStopsCache = [[167, 139, 250]];
const parseRgb = s => String(s).split(',').map(v => Number(v.trim()) || 0);
function vizStops() {
  const mode = S.settings.vizPalette || 'accent';
  if (mode === 'custom') {
    const n = clamp(S.settings.vizCustomCount || 3, 1, 3);
    const arr = (S.settings.vizCustom || []).slice(0, n).map(hexToRgbStr).filter(Boolean).map(parseRgb);
    if (arr.length) return arr;
  }
  if (VIZ_PRESETS[mode]) return VIZ_PRESETS[mode].map(h => parseRgb(hexToRgbStr(h)));
  return [parseRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || DEFAULT_ACCENT)];
}
// colour at position t (0..1) along the palette, as [r, g, b]
function vizAt(t) {
  const s = vizStopsCache;
  if (s.length === 1) return s[0];
  const x = clamp(t, 0, 1) * (s.length - 1), i = Math.min(s.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map(k => Math.round(s[i][k] + (s[i + 1][k] - s[i][k]) * f));
}
const vizStr = t => vizAt(t).join(', ');
const vizHot = (t, w = 0.6) => vizAt(t).map(v => Math.round(v + (255 - v) * w)).join(', ');   // towards white
function applyVizColors() {
  vizStopsCache = vizStops();
  for (let i = 0; i < 5; i++) document.documentElement.style.setProperty(`--viz-c${i + 1}`, vizStr(i / 4));
  const cb = document.querySelector('#vizPick .viz-custom-btn');
  if (cb) {
    const n = clamp(S.settings.vizCustomCount || 3, 1, 3), cols = (S.settings.vizCustom || []).slice(0, n);
    cb.style.background = cols.length > 1 ? `linear-gradient(135deg, ${cols.join(', ')})` : (cols[0] || '#a78bfa');
  }
  const ab = document.querySelector('#vizPick [data-viz="accent"]');
  if (ab) ab.style.background = 'rgb(var(--accent))';
}
document.querySelectorAll('#vizPick [data-viz]').forEach(b => {
  const p = VIZ_PRESETS[b.dataset.viz];
  if (p) b.style.background = `linear-gradient(135deg, ${p.join(', ')})`;
});
$('vizPick').addEventListener('click', e => {
  const b = e.target.closest('[data-viz]');
  if (b) patchSettings({ vizPalette: b.dataset.viz });
});
// the colour mixer: up to three colours of your own
document.querySelectorAll('.vz-col').forEach(inp => {
  inp.addEventListener('click', () => { S.modal = true; });           // the Windows colour dialog takes focus
  inp.addEventListener('input', () => {                               // live preview while picking
    const list = (S.settings.vizCustom || ['#a78bfa', '#ff3787', '#40c8e0']).slice();
    list[+inp.dataset.i] = inp.value;
    S.settings.vizCustom = list;
    S.settings.vizPalette = 'custom';
    applyVizColors();
  });
  inp.addEventListener('change', () => {
    S.modal = false;
    const list = (S.settings.vizCustom || []).slice();
    list[+inp.dataset.i] = inp.value;
    patchSettings({ vizCustom: list, vizPalette: 'custom' });
  });
  inp.addEventListener('blur', () => { S.modal = false; });
});
$('vizCount').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (b) patchSettings({ vizCustomCount: +b.dataset.n, vizPalette: 'custom' });
});
// a custom accent colour
$('accentCustom').addEventListener('click', () => { S.modal = true; });
$('accentCustom').addEventListener('input', e => setAccent(hexToRgbStr(e.target.value)));
$('accentCustom').addEventListener('change', e => { S.modal = false; patchSettings({ accentMode: 'custom', accentCustom: e.target.value }); });
$('accentCustom').addEventListener('blur', () => { S.modal = false; });

// ---- side mode: the apps that send the notch to the right edge
const sideIcons = new Map();
async function sideIcon(a) {
  if (!a.path) return null;
  if (!sideIcons.has(a.path)) sideIcons.set(a.path, api.appIcon(a.path));
  return sideIcons.get(a.path);
}
function sideChip(a, removable) {
  const letter = esc((a.name || a.exe).charAt(0).toUpperCase());
  return `<button class="side-chip" data-exe="${esc(a.exe)}" title="${esc(a.exe)}">
    <span class="sc-ic" data-path="${esc(a.path || '')}"><span class="app-letter" style="background:${avatarColor(a.name || a.exe)}">${letter}</span></span>
    <span class="sc-name">${esc(a.name || a.exe)}</span>${removable ? `<span class="sc-x">${icon('x')}</span>` : `<span class="sc-x add">${icon('plus')}</span>`}</button>`;
}
async function renderSideApps() {
  const list = S.settings.sideApps || [];
  $('sideList').innerHTML = list.length ? list.map(a => sideChip(a, true)).join('') : '<span class="muted small">No apps yet</span>';
  const recentAll = await api.sideApps();
  const recent = recentAll.filter(r => !list.some(a => a.exe === r.exe));
  $('sideRecent').innerHTML = recent.length ? recent.slice(0, 8).map(a => sideChip(a, false)).join('') : '<span class="muted small">Switch to an app, then come back here</span>';
  // fill in real app icons (listed apps borrow the path/icon from the recent list when they lack one)
  const all = [...list.map(a => { const r = recentAll.find(x => x.exe === a.exe) || {}; return { ...a, path: a.path || r.path, icon: r.icon }; }), ...recent];
  document.querySelectorAll('#sideList .side-chip, #sideRecent .side-chip').forEach(async el => {
    const a = all.find(x => x.exe === el.dataset.exe);
    const src = a && (a.icon || await sideIcon(a));
    if (src) el.querySelector('.sc-ic').innerHTML = `<img src="${esc(src)}" alt="">`;
  });
  LIVE_RECENT_APPS = recent;
}
let LIVE_RECENT_APPS = [];
$('sideList').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  if (b) patchSettings({ sideApps: (S.settings.sideApps || []).filter(a => a.exe !== b.dataset.exe) }).then(renderSideApps);
});
$('sideRecent').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  const a = b && LIVE_RECENT_APPS.find(x => x.exe === b.dataset.exe);
  if (a) patchSettings({ sideApps: [...(S.settings.sideApps || []), { exe: a.exe, name: a.name, path: a.path }] }).then(renderSideApps);
});
document.querySelector('#setNav [data-sec="side"]').addEventListener('click', renderSideApps);

// ---- idle pill stats + header status strip
function idleStatsCfg() { return idleCfg(); }
$('idlePick').addEventListener('click', e => {
  const b = e.target.closest('[data-stat]');
  if (b) patchSettings({ idleStats: { ...idleStatsCfg(), [b.dataset.stat]: !idleStatsCfg()[b.dataset.stat] } });
});
let hdrStatsAt = 0;
function renderHeaderStats() {
  if (S.mode !== 'expanded' || performance.now() - hdrStatsAt < 400) return;
  hdrStatsAt = performance.now();
  const parts = [];
  if (NET.cur) parts.push(`<span class="hs"><i>↓</i>${shortRate(NET.cur.rx)}</span><span class="hs"><i>↑</i>${shortRate(NET.cur.tx)}</span>`);
  if (S.sys) parts.push(`<span class="hs"><i>CPU</i>${S.sys.cpu}%</span><span class="hs"><i>RAM</i>${S.sys.ram}%</span>`);
  if (S.batt && hasBattery()) parts.push(`<span class="hs${S.batt.charging ? ' chg' : ''}"><i>${S.batt.charging ? '⚡' : '🔋'}</i>${Math.round(S.batt.level * 100)}%</span>`);
  $('hdrStats').innerHTML = parts.join('<span class="hs-dot">·</span>');
}

// ---- party mode
function partyLights() { return { beams: true, glow: true, particles: true, albumArt: true, ...(S.settings.partyLights || {}) }; }
document.querySelectorAll('[data-light]').forEach(el => el.addEventListener('change', () => {
  patchSettings({ partyLights: { ...partyLights(), [el.dataset.light]: el.checked } });
}));
$('partyGo').addEventListener('click', () => { collapse(); api.partyStart(); });
// ---- desktop equalizer
$('mcDeskEq').addEventListener('click', () => patchSettings({ deskEq: !S.settings.deskEq }));
let rangeSaveT = 0;
document.querySelectorAll('[data-range]').forEach(el => {
  el.addEventListener('input', () => {
    el.style.setProperty('--p', el.value + '%');
    $(el.dataset.out).textContent = el.value + '%';
    S.settings[el.dataset.range] = +el.value;
    clearTimeout(rangeSaveT);                                   // live while dragging, saved shortly after
    rangeSaveT = setTimeout(() => api.setSettings({ [el.dataset.range]: +el.value }), 60);
  });
});
$('mcParty').addEventListener('click', () => { collapse(); api.partyStart(); });

$('fxPick').addEventListener('click', e => {
  const b = e.target.closest('button[data-fx]');
  if (b) patchSettings({ artFx: b.dataset.fx });
});
$('accentPick').addEventListener('click', e => {
  const b = e.target.closest('button[data-accent]');
  if (b) patchSettings({ accentMode: b.dataset.accent });
});
document.querySelectorAll('#accentPick button[data-accent]').forEach(b => {
  if (ACCENTS[b.dataset.accent]) b.style.background = `rgb(${ACCENTS[b.dataset.accent]})`;
});

function applyExtrasUI() {
  const s = S.settings;
  document.documentElement.dataset.theme = s.theme || 'midnight';
  document.documentElement.dataset.shape = s.shape || 'notch';
  document.querySelectorAll('.seg[data-seg]').forEach(seg => {
    if (seg.id === 'screenSeg') return;
    const str = seg.dataset.type === 'str';
    const v = str ? String(s[seg.dataset.seg]) : Number(s[seg.dataset.seg]);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', (str ? b.dataset.v : Number(b.dataset.v)) === v));
  });
  renderScreens();
  $('mcDeskEq').classList.toggle('on', !!s.deskEq);
  const ic = idleStatsCfg();
  document.querySelectorAll('#idlePick [data-stat]').forEach(b => b.classList.toggle('on', !!ic[b.dataset.stat]));
  document.querySelectorAll('[data-range]').forEach(el => {
    const v = s[el.dataset.range] ?? ({ deskEqIntensity: 60, fxSensitivity: 50 })[el.dataset.range] ?? 45;
    if (document.activeElement !== el) { el.value = v; el.style.setProperty('--p', v + '%'); $(el.dataset.out).textContent = v + '%'; }
  });
  const pl = partyLights();
  document.querySelectorAll('[data-light]').forEach(el => { el.checked = !!pl[el.dataset.light]; });
  document.querySelectorAll('#themePick button').forEach(b => b.classList.toggle('active', b.dataset.theme === (s.theme || 'midnight')));
  document.querySelectorAll('#accentPick button').forEach(b => b.classList.toggle('active', b.dataset.accent === (s.accentMode || 'auto')));
  document.querySelectorAll('#fxPick button').forEach(b => b.classList.toggle('active', b.dataset.fx === (s.artFx || 'sun')));
  const pal = s.vizPalette || 'accent';
  document.querySelectorAll('#vizPick [data-viz]').forEach(b => b.classList.toggle('active', b.dataset.viz === pal));
  $('vizMixer').classList.toggle('open', pal === 'custom');
  const cols = s.vizCustom || ['#a78bfa', '#ff3787', '#40c8e0'];
  const cnt = clamp(s.vizCustomCount || 3, 1, 3);
  document.querySelectorAll('.vz-col').forEach(inp => {
    inp.value = cols[+inp.dataset.i] || '#a78bfa';
    inp.style.display = +inp.dataset.i < cnt ? '' : 'none';
  });
  document.querySelectorAll('#vizCount button').forEach(b => b.classList.toggle('active', +b.dataset.n === cnt));
  $('accentCustom').value = s.accentCustom || '#a78bfa';
  $('accentCustom').parentElement.classList.toggle('active', s.accentMode === 'custom');
  if (s.accentMode === 'custom') $('accentCustom').parentElement.style.background = s.accentCustom;
  applyVizColors();
  if (SUN.raf) sunStop();          // restart the icon effect in its new style
  sparkEnsure();
  renderApps();
  renderAlerts();
  vizCheck();
  if (typeof applyLiveUI === 'function') applyLiveUI();
}

function onTabShown(tab) {
  if (tab === 'settings') renderScreens();
  if (tab === 'system') renderNet();
  if (tab === 'home') specEnsure();
  if (tab === 'alerts') { ALERTS.unread = 0; renderAlertBadge(); renderAlerts(); }
  if (tab !== 'apps') closeAppForm();
}

// ================================================================== Launchpad (custom shortcuts + system actions)
const BUILTINS = [
  ['screenshot', 'screenshot', 'Snip'], ['lock', 'lock', 'Lock'], ['calculator', 'calc', 'Calculator'],
  ['explorer', 'folder', 'Files'], ['terminal', 'terminal', 'Terminal'], ['taskmgr', 'activity', 'Task Mgr'],
  ['wifi', 'wifi', 'Wi-Fi'], ['bluetooth', 'bluetooth', 'Bluetooth'], ['sound', 'volume', 'Sound'], ['settings', 'gear', 'Settings'],
];
let lastRemoved = null;

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 55%, 42%)`;
}

function renderApps() {
  const grid = $('appsGrid');
  if (!grid) return;
  const list = Array.isArray(S.settings.shortcuts) ? S.settings.shortcuts : [];
  let html = '';
  for (const sc of list) {
    const letter = esc((sc.name || '?').trim().charAt(0).toUpperCase());
    const ico = sc.icon
      ? `<img src="${esc(sc.icon)}" alt="">`
      : `<span class="app-letter" style="background:${avatarColor(sc.name || '?')}">${letter}</span>`;
    html += `<button class="app-tile custom" data-id="${esc(sc.id)}" title="${esc(sc.name)}\n${esc(sc.target)}\nRight-click to remove">${ico}<span>${esc(sc.name)}</span></button>`;
  }
  html += `<button class="app-tile add" id="appAddTile" title="Add a shortcut"><span class="app-plus">${icon('plus')}</span><span>Add</span></button>`;
  if (list.length) html += '<div class="apps-sep"></div>';
  for (const [action, ic, label] of BUILTINS) {
    html += `<button class="app-tile sys" data-action="${action}">${`<span class="app-sys">${icon(ic)}</span>`}<span>${label}</span></button>`;
  }
  grid.innerHTML = html;
}

$('appsGrid').addEventListener('click', e => {
  const t = e.target.closest('.app-tile');
  if (!t) return;
  if (t.id === 'appAddTile') { openAppForm(); return; }
  if (t.dataset.id) api.launch(t.dataset.id);
  else if (t.dataset.action) api.action(t.dataset.action);
  t.classList.add('launched');
  setTimeout(() => { if (!S.pinned) collapse(); }, 250);
});
$('appsGrid').addEventListener('contextmenu', async e => {
  const t = e.target.closest('.app-tile.custom');
  if (!t) return;
  e.preventDefault();
  lastRemoved = (S.settings.shortcuts || []).find(s => s.id === t.dataset.id) || null;
  S.settings = await api.removeShortcut(t.dataset.id);
  renderApps();
  if (lastRemoved) showAppNotice(`Removed “${lastRemoved.name}”`, 'Undo', async () => {
    const r = lastRemoved; lastRemoved = null;
    if (r) { S.settings = await api.addShortcut({ name: r.name, target: r.target }); renderApps(); }
  });
});

function showAppNotice(text, actionLabel, action) {
  const sub = document.querySelector('.apps-card .card-title .muted');
  sub.innerHTML = `${esc(text)}${actionLabel ? ` · <a href="#" class="undo">${esc(actionLabel)}</a>` : ''}`;
  const a = sub.querySelector('.undo');
  if (a) a.addEventListener('click', ev => { ev.preventDefault(); action(); resetAppNotice(); });
  clearTimeout(showAppNotice.t);
  showAppNotice.t = setTimeout(resetAppNotice, 6000);
}
function resetAppNotice() {
  document.querySelector('.apps-card .card-title .muted').textContent = 'drop apps, files or links here · right-click to remove';
}

function openAppForm() {
  $('appForm').classList.add('open');
  $('appHint').textContent = '';
  $('appTarget').value = '';
  $('appName').value = '';
  api.focus();
  setTimeout(() => $('appTarget').focus(), 60);
}
function closeAppForm() { $('appForm').classList.remove('open'); }
$('appAddBtn').addEventListener('click', () => ($('appForm').classList.contains('open') ? closeAppForm() : openAppForm()));
$('appCancel').addEventListener('click', closeAppForm);
$('appBrowse').addEventListener('click', async () => {
  S.modal = true;
  try {
    const p = await api.pickFile();
    if (p) {
      $('appTarget').value = p;
      if (!$('appName').value) $('appName').value = baseName(p).replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
    }
  } finally {
    S.modal = false;
    api.focus();
  }
});
$('appForm').addEventListener('submit', async e => {
  e.preventDefault();
  const target = $('appTarget').value.trim();
  if (!target) { $('appHint').textContent = 'Paste a link or choose an app'; return; }
  const before = (S.settings.shortcuts || []).length;
  $('appHint').textContent = 'Adding…';
  S.settings = await api.addShortcut({ name: $('appName').value.trim(), target });
  if ((S.settings.shortcuts || []).length === before) {
    $('appHint').textContent = "That doesn't look like a link or an existing file";
    return;
  }
  closeAppForm();
  renderApps();
});

async function addShortcutsFromDrop(items) {
  let added = 0;
  for (const target of items.slice(0, 12)) {
    const before = (S.settings.shortcuts || []).length;
    S.settings = await api.addShortcut({ target });
    if ((S.settings.shortcuts || []).length > before) added++;
  }
  renderApps();
  if (added) showAppNotice(`Added ${added} shortcut${added > 1 ? 's' : ''}`);
}

// ================================================================== notifications
const ALERTS = { list: [], unread: 0, status: 'Allowed' };

function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function addNotif(n, silent) {
  if (ALERTS.list.some(x => x.id === n.id)) return;
  ALERTS.list.unshift(n);
  ALERTS.list.sort((a, b) => b.time - a.time);
  if (ALERTS.list.length > 60) ALERTS.list.length = 60;
  if (!silent && !n.initial) {
    if (!(S.mode === 'expanded' && S.tab === 'alerts')) ALERTS.unread++;
    if (typeof focusQuiet === 'function' && focusQuiet()) LIVE.held++;   // quiet while focusing
    else peekNotif(n);
  }
  renderAlertBadge();
  if (S.tab === 'alerts') renderAlerts();
}

function peekNotif(n) {
  const hide = !!S.settings.notifHideText;
  const title = hide ? n.app : (n.title || n.app);
  const sub = hide ? 'New notification' : (n.body || n.app);
  const ico = n.icon ? `<img src="${esc(n.icon)}" alt="">` : icon('bell');
  peek('notif', `
    <div class="pk-app">${ico}</div>
    <div class="pk-text">
      <div class="pk-title">${esc(title)}</div>
      <div class="pk-sub">${esc(sub.split('\n')[0])}</div>
    </div>
    <span class="pk-tag">${esc(n.app)}</span>`, { width: 440, duration: 4500 });
}

function renderAlertBadge() {
  $('alertBadge').textContent = ALERTS.unread ? (ALERTS.unread > 9 ? '9+' : ALERTS.unread) : '';
  renderCompact();                                   // the bell in the idle pill
}

function renderAlerts() {
  const box = $('alertsList');
  if (!box) return;
  const sub = $('alertsSub');
  if (!S.settings.notifications) {
    sub.textContent = '';
    box.innerHTML = `<div class="alerts-empty">${icon('bell')}<b>Notifications are off</b><span>Turn on “Show Windows notifications” in Settings → Widgets.</span></div>`;
    return;
  }
  if (ALERTS.status && ALERTS.status !== 'Allowed') {
    sub.textContent = '';
    box.innerHTML = `<div class="alerts-empty">${icon('lock')}<b>Windows is blocking notification access</b>
      <span>Open Settings → Privacy &amp; security → Notifications and allow apps to access your notifications.</span>
      <button class="pill-btn small" id="openNotifPrivacy">Open settings</button></div>`;
    $('openNotifPrivacy').addEventListener('click', () => api.action('notifPrivacy'));
    return;
  }
  sub.textContent = ALERTS.list.length ? `${ALERTS.list.length} recent` : '';
  if (!ALERTS.list.length) {
    box.innerHTML = `<div class="alerts-empty">${icon('bell')}<b>You're all caught up</b><span>Messages from WhatsApp, Discord, Teams, Mail… will appear here.</span></div>`;
    return;
  }
  const hide = !!S.settings.notifHideText;
  box.innerHTML = ALERTS.list.map(n => `
    <div class="alert" data-id="${n.id}">
      <div class="al-icon">${n.icon ? `<img src="${esc(n.icon)}" alt="">` : icon('bell')}</div>
      <div class="al-body">
        <div class="al-head"><span>${esc(n.app)}</span><time>${timeAgo(n.time)}</time></div>
        <div class="al-title">${esc(hide ? 'New notification' : (n.title || n.app))}</div>
        ${!hide && n.body ? `<div class="al-text">${esc(n.body)}</div>` : ''}
      </div>
      <button class="al-x" title="Dismiss">${icon('x')}</button>
    </div>`).join('');
}

$('alertsList').addEventListener('click', e => {
  const x = e.target.closest('.al-x');
  if (!x) return;
  const id = Number(x.closest('.alert').dataset.id);
  ALERTS.list = ALERTS.list.filter(n => n.id !== id);
  renderAlerts();
});
$('alertsClear').addEventListener('click', () => { ALERTS.list = []; ALERTS.unread = 0; api.clearNotifs(); renderAlerts(); renderAlertBadge(); });
$('alertsCenter').addEventListener('click', () => { api.action('notifications'); collapse(); });
api.on('notif', n => addNotif(n, false));
api.on('notif-status', st => { ALERTS.status = st; renderAlerts(); });
setInterval(() => { if (S.mode === 'expanded' && S.tab === 'alerts') renderAlerts(); }, 30000);

// ================================================================== network
const NET = { rx: [], tx: [], rxTotal: 0, txTotal: 0, last: 0, cur: null };
function fmtRate(b) {
  if (b < 1024) return `${Math.round(b)} B/s`;
  if (b < 1048576) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
}
function fmtBytes(b) {
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
api.on('net', n => {
  const now = Date.now();
  const dt = NET.last ? Math.min(5, (now - NET.last) / 1000) : 1;
  NET.last = now;
  NET.rxTotal += n.rx * dt;
  NET.txTotal += n.tx * dt;
  NET.rx.push(n.rx); NET.tx.push(n.tx);
  if (NET.rx.length > 40) { NET.rx.shift(); NET.tx.shift(); }
  NET.cur = n;
  if (S.mode === 'expanded' && S.tab === 'system') renderNet();
});
function renderNet() {
  const n = NET.cur;
  if (!n) return;
  $('netRx').textContent = fmtRate(n.rx);
  $('netTx').textContent = fmtRate(n.tx);
  $('netName').textContent = n.name || '';
  $('netTotal').textContent = `This session  ↓ ${fmtBytes(NET.rxTotal)}  ↑ ${fmtBytes(NET.txTotal)}`;
  if (NET.rx.length < 2) return;
  const max = Math.max(51200, ...NET.rx, ...NET.tx) * 1.1;
  const line = arr => arr.map((v, i) => `${(i / (arr.length - 1) * 100).toFixed(1)},${(29 - (v / max) * 27).toFixed(1)}`).join(' ');
  const rx = line(NET.rx);
  $('netSpark').innerHTML =
    `<polygon class="area" points="0,30 ${rx} 100,30"/><polyline class="rx" points="${rx}"/><polyline class="tx" points="${line(NET.tx)}"/>`;
}

// ================================================================== real audio visualizer (system loopback)
const VIZ = { stream: null, ctx: null, analyser: null, data: null, raf: 0, last: 0, failed: false, starting: false, stopTimer: 0 };
const BANDS = [[30, 120], [120, 350], [350, 900], [900, 2200], [2200, 5500], [5500, 14000]];

function vizCheck() {
  const want = !!S.settings.visualizer && isPlaying() && !VIZ.failed;
  if (want) {
    clearTimeout(VIZ.stopTimer); VIZ.stopTimer = 0;
    if (!VIZ.stream && !VIZ.starting) vizStart();
  } else if (VIZ.stream && !VIZ.stopTimer) {
    // keep the capture alive briefly so pause → play doesn't restart it
    VIZ.stopTimer = setTimeout(vizStop, S.settings.visualizer ? 15000 : 0);
  }
  specEnsure();
  const note = $('vizNote');
  if (note) note.textContent = VIZ.failed
    ? 'Couldn’t capture system audio here, so the bars use an animation instead.'
    : 'Bars react to what your PC is actually playing.';
}

async function vizStart() {
  VIZ.starting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 64, maxHeight: 64, maxFrameRate: 1 } },
    });
    stream.getVideoTracks().forEach(t => t.stop());     // we only need the sound
    if (!stream.getAudioTracks().length) throw new Error('no loopback audio track');
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.6;
    an.minDecibels = -95;
    an.maxDecibels = -12;
    src.connect(an);                                     // analyse only: never routed to the speakers
    Object.assign(VIZ, {
      stream, ctx, analyser: an, data: new Uint8Array(an.frequencyBinCount),
      peak: BANDS.map(() => 0.3), floor: BANDS.map(() => 0.2),
    });
    document.body.classList.add('viz-live');
    VIZ.raf = requestAnimationFrame(vizFrame);
  } catch (e) {
    VIZ.failed = true;
    console.warn('Visualizer unavailable:', e && e.message);
  }
  VIZ.starting = false;
  vizCheck();
}

function vizStop() {
  VIZ.stopTimer = 0;
  cancelAnimationFrame(VIZ.raf);
  if (VIZ.stream) VIZ.stream.getTracks().forEach(t => t.stop());
  if (VIZ.ctx) VIZ.ctx.close().catch(() => {});
  Object.assign(VIZ, { stream: null, ctx: null, analyser: null, data: null });
  document.body.classList.remove('viz-live');
  document.querySelectorAll('.eq.live i').forEach(i => { i.style.height = ''; });
}

// ================================================================== spectrum under the progress bar (Home → media card)
const SPEC_N = 44;
const SPEC = { raf: 0, last: 0, vals: new Float32Array(SPEC_N), peak: 0.55, color: '', colorAt: 0 };

function specVisible() {
  return S.mode === 'expanded' && S.tab === 'home' && S.media.active;
}
function specEnsure() {
  if (!SPEC.raf && specVisible()) SPEC.raf = requestAnimationFrame(specFrame);
}
function specFrame(t) {
  if (!specVisible()) {                       // stop when nobody can see it
    SPEC.raf = 0;
    SPEC.vals.fill(0);
    return;
  }
  SPEC.raf = requestAnimationFrame(specFrame);
  if (t - SPEC.last < 30) return;
  SPEC.last = t;

  const playing = isPlaying();
  const target = new Float32Array(SPEC_N);
  if (playing && VIZ.analyser) {
    // real spectrum: log-spaced bands from 40 Hz to 16 kHz
    const an = VIZ.analyser;
    const data = VIZ.data;
    an.getByteFrequencyData(data);
    const hz = VIZ.ctx.sampleRate / an.fftSize;
    let frameMax = 0;
    for (let i = 0; i < SPEC_N; i++) {
      const f0 = 40 * Math.pow(400, i / SPEC_N), f1 = 40 * Math.pow(400, (i + 1) / SPEC_N);
      const b0 = Math.max(1, Math.floor(f0 / hz)), b1 = Math.max(b0, Math.min(data.length - 1, Math.ceil(f1 / hz)));
      let m = 0;
      for (let b = b0; b <= b1; b++) m = Math.max(m, data[b]);
      const v = m / 255 + (i / SPEC_N) * 0.14;          // lift highs a little (they're quieter)
      target[i] = v;
      frameMax = Math.max(frameMax, v);
    }
    SPEC.peak = Math.max(frameMax, Math.max(0.5, SPEC.peak * 0.995));
    const floor = 0.32;
    for (let i = 0; i < SPEC_N; i++) target[i] = clamp((target[i] - floor) / (SPEC.peak - floor), 0, 1);
  } else if (playing) {
    // no system audio available: a gentle synthetic wave
    for (let i = 0; i < SPEC_N; i++) {
      const w = Math.sin(t / 260 + i * 0.55) * 0.5 + Math.sin(t / 410 - i * 0.31) * 0.35;
      target[i] = clamp(0.35 + w * 0.3 + Math.random() * 0.12, 0.05, 1);
    }
  }
  for (let i = 0; i < SPEC_N; i++) {
    const cur = SPEC.vals[i];
    SPEC.vals[i] = cur + (target[i] - cur) * (target[i] > cur ? 0.55 : 0.18);
  }
  drawSpectrum();
}

function drawSpectrum() {
  const c = $('mcSpec');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
  if (!W || !H) return;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const gap = 2.5 * dpr;
  const bw = (W - gap * (SPEC_N - 1)) / SPEC_N;
  const r = Math.min(bw / 2, 2.5 * dpr);
  for (let i = 0; i < SPEC_N; i++) {
    const h = Math.max(3 * dpr, SPEC.vals[i] * H * 0.92);
    const x = i * (bw + gap);
    // each bar takes its colour from the palette (left → right); strongest at the base, fading upward
    const col = vizStr(i / (SPEC_N - 1));
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(${col}, 0.04)`);
    grad.addColorStop(0.55, `rgba(${col}, 0.34)`);
    grad.addColorStop(1, `rgba(${col}, 0.8)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, H - h, bw, h + r, [r, r, 0, 0]);   // rounded tops, flat at the bottom edge
    ctx.fill();
  }
}

// ================================================================== "sun": the album art glows and emits light with the beat
// Drawn on a page-level canvas (#sparkLayer) centred on the art, so the light spills past the notch.
const SUN_SIZE = 220;                      // css px
const SUN_RAYS = 40;
const SUN = {
  raf: 0, last: 0, bass: 0, prevBass: 0, energy: 0, peak: 0.5, lastBeat: 0,
  len: new Float32Array(SUN_RAYS),                 // current ray length 0..1
  jit: Float32Array.from({ length: SUN_RAYS }, () => 0.55 + Math.random() * 0.6),   // per-ray character
  jitT: Float32Array.from({ length: SUN_RAYS }, () => 0.55 + Math.random() * 0.6),
  ang: Float32Array.from({ length: SUN_RAYS }, (_, i) => (i / SUN_RAYS) * Math.PI * 2 + (Math.random() - 0.5) * 0.12),
  beams: [], rings: [], color: '', colorAt: 0,
};

function sunVisible() { return S.mode === 'collapsed' && isPlaying() && !!$('cArt') && (S.settings.artFx || 'sun') !== 'none'; }
function sparkEnsure() {
  if (!SUN.raf && sunVisible()) { SUN.last = 0; SUN.raf = requestAnimationFrame(sunFrame); }
}
function sunStop() {
  SUN.raf = 0;
  const c = $('sparkLayer');
  c.classList.remove('on');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
  SUN.beams.length = 0; SUN.rings.length = 0;
  $('island').classList.remove('fx-orb');
  const a = $('cArt');
  if (a) { a.style.transform = ''; a.style.boxShadow = ''; a.style.filter = ''; }
}

function sunFrame(t) {
  if (!sunVisible()) { sunStop(); return; }
  SUN.raf = requestAnimationFrame(sunFrame);
  const dt = SUN.last ? Math.min(50, t - SUN.last) : 16;
  if (t - SUN.last < 15) return;
  SUN.last = t;

  // ---- listen: bass + per-ray energy (real loopback audio, or a gentle synthetic beat)
  const N = SUN_RAYS;
  const band = new Float32Array(N);
  let bass;
  if (VIZ.analyser) {
    const an = VIZ.analyser, data = VIZ.data;
    an.getByteFrequencyData(data);
    const hz = VIZ.ctx.sampleRate / an.fftSize;
    let s = 0, n = 0;
    for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(170 / hz); i++) { s += data[i]; n++; }
    const raw = n ? s / n / 255 : 0;
    SUN.peak = Math.max(raw, Math.max(0.45, SUN.peak * 0.996));
    bass = clamp((raw - 0.3) / (SUN.peak - 0.3), 0, 1);
    // overall loudness with a slow memory: quiet passages dim the whole sun, loud ones make it blaze
    let sa = 0, na = 0;
    for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(10000 / hz) && i < data.length; i++) { sa += data[i]; na++; }
    const all = na ? sa / na / 255 : 0;
    SUN.lvlPeak = Math.max(all, Math.max(0.3, (SUN.lvlPeak || 0.4) * 0.9985));
    SUN.lvlTarget = clamp(Math.pow(clamp((all - 0.1) / (SUN.lvlPeak - 0.1), 0, 1), 1.4), 0, 1);
    // vocals: the voice band (300 Hz – 3.4 kHz) against its own slowly fading peak
    let sv = 0, nv = 0;
    for (let i = Math.floor(300 / hz); i <= Math.ceil(3400 / hz) && i < data.length; i++) { sv += data[i]; nv++; }
    const voc = nv ? sv / nv / 255 : 0;
    SUN.vocPeak = Math.max(voc, Math.max(0.25, (SUN.vocPeak || 0.35) * 0.997));
    SUN.vocTarget = clamp((voc - 0.12) / (SUN.vocPeak - 0.12), 0, 1);
    // spread the spectrum around the circle (mirrored left/right so it looks natural, not like a dial)
    for (let i = 0; i < N; i++) {
      const k = i < N / 2 ? i : N - 1 - i;
      const f0 = 60 * Math.pow(160, k / (N / 2)), f1 = 60 * Math.pow(160, (k + 1) / (N / 2));
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < data.length; b++) m = Math.max(m, data[b]);
      band[i] = clamp((m / 255 + (k / (N / 2)) * 0.12 - 0.34) / 0.5, 0, 1);
    }
  } else {
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI / 500)), 8);
    bass = 0.2 + beat * 0.8;
    for (let i = 0; i < N; i++) band[i] = clamp(0.25 + Math.sin(t / 420 + i * 2.3) * 0.15 + beat * 0.5, 0, 1);
    SUN.lvlTarget = 0.75;
    SUN.vocTarget = 0.45;
  }
  // Settings → Music icon effect → Sensitivity: 0 = calm, 50 = default, 100 = reacts to everything
  const sens = clamp((S.settings.fxSensitivity ?? 50) / 100, 0, 1);
  const gain = 0.35 + sens * 1.3;            // 0.35 … 1 (default) … 1.65
  const easy = 1.6 - sens * 1.2;             // beat threshold: 1.6× stricter … 1 … 0.4× (lighter beats count)
  SUN.vocal = (SUN.vocal ?? 0.4) + ((SUN.vocTarget ?? 0.4) - (SUN.vocal ?? 0.4)) * 0.12;
  SUN.bass += (bass - SUN.bass) * (bass > SUN.bass ? 0.55 : 0.1);
  SUN.level = (SUN.level ?? 0.5) + ((SUN.lvlTarget ?? 0.5) - (SUN.level ?? 0.5)) * 0.08;
  const lvl = SUN.level;
  for (let i = 0; i < N; i++) {
    const target = band[i] * 0.75 + SUN.bass * 0.45;
    SUN.len[i] += (target - SUN.len[i]) * (target > SUN.len[i] ? 0.5 : 0.09);
    SUN.jit[i] += (SUN.jitT[i] - SUN.jit[i]) * 0.04;
  }

  // ---- a kick drum "fires" the sun: light streaks fly out, a soft shock-ring expands, ray shapes reshuffle
  const maxBeams = Math.round(60 + 80 * sens);
  const fire = (count, power) => {
    for (let j = 0; j < count && SUN.beams.length < maxBeams; j++) {
      SUN.beams.push({
        a: Math.random() * Math.PI * 2, r: 12,
        v: (0.07 + Math.random() * 0.1) * (0.7 + power * 0.6),
        len: 6 + Math.random() * 12 * (0.6 + power * 0.6),
        w: 0.7 + Math.random() * 1.1, life: 1,
        c: vizHot(Math.random(), 0.25),
      });
    }
  };
  // a beat fires a burst (the sensitivity decides how light a beat may be and how big the burst is)
  const kick = bass - SUN.prevBass > 0.12 * easy && bass > 0.35 * easy && t - SUN.lastBeat > 95;
  SUN.prevBass = bass;
  if (kick) {
    SUN.lastBeat = t;
    SUN.beats = (SUN.beats || []).filter(x => t - x < 4000);
    SUN.beats.push(t);
    fire(Math.round((4 + bass * 8 * (0.4 + lvl)) * gain), bass * (0.6 + 0.4 * gain));
    if (bass > 0.6 * Math.min(1.2, easy) && SUN.rings.length < 3) SUN.rings.push({ r: 13, life: 1 });
    for (let i = 0; i < N; i++) SUN.jitT[i] = 0.5 + Math.random() * 0.7;
    // the orb lurches forward on every beat, so fast dance tracks visibly spin "with" the kicks
    SUN.spinKick = Math.min(4, (SUN.spinKick || 0) + (0.5 + bass) * 1.1 * gain);
  }
  // …and between beats it keeps shedding sparks: more when the music is loud, the bass heavy or a voice is singing
  SUN.emitAcc = (SUN.emitAcc || 0) + dt * (0.004 + 0.03 * lvl * (0.4 + SUN.bass) + 0.012 * lvl * SUN.vocal) * Math.pow(gain, 1.5);
  while (SUN.emitAcc >= 1) { SUN.emitAcc -= 1; fire(1, lvl * 0.7); }

  // ---- how fast the orb turns follows the song's mood: beats per second (tempo), vocals, bass, loudness.
  // A slow, soft song turns it gently; a fast electronic track spins it up and kicks it on every beat.
  const recent = (SUN.beats || []).filter(x => t - x < 4000).length / 4;        // kicks per second, last 4 s
  SUN.tempo = (SUN.tempo || 0) + (recent - (SUN.tempo || 0)) * 0.03;
  const drive = clamp(0.45 * Math.min(1, SUN.tempo / 2.5) + 0.25 * SUN.vocal + 0.3 * SUN.bass, 0, 1) * Math.sqrt(lvl);
  const spinTarget = 0.15 + drive * 1.7 * gain;                                   // radians per second
  SUN.spin = (SUN.spin ?? 0.3) + (spinTarget - (SUN.spin ?? 0.3)) * 0.035;
  SUN.spinKick = (SUN.spinKick || 0) * Math.exp(-dt / 230);
  SUN.spinRate = SUN.spin + SUN.spinKick;

  // ---- place the canvas over the art (window coords)
  const art = $('cArt');
  const ar = art.getBoundingClientRect();
  const cx = ar.left + ar.width / 2, cy = ar.top + ar.height / 2;
  const c = $('sparkLayer');
  c.style.transform = `translate(${(cx - SUN_SIZE / 2).toFixed(1)}px, ${(cy - SUN_SIZE / 2).toFixed(1)}px)`;
  c.classList.add('on');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(SUN_SIZE * dpr);
  if (c.width !== W) { c.width = W; c.height = W; }
  const col = vizStr(0.5), b = SUN.bass, o = SUN_SIZE / 2;     // palette middle for the glow
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SUN_SIZE, SUN_SIZE);
  ctx.globalCompositeOperation = 'lighter';

  const glow = 0.25 + lvl * 0.75;          // everything follows the song's loudness
  const orb = S.settings.artFx === 'orb';
  $('island').classList.toggle('fx-orb', orb);
  if (orb) {
    drawOrb(ctx, o, b, lvl, glow, dt, t);
  } else {
  // 1) wide soft bloom: the "atmosphere" of the sun
  const R = 14 + b * 14 * (0.5 + lvl * 0.5);
  let g = ctx.createRadialGradient(o, o, 4, o, o, R);
  g.addColorStop(0, `rgba(${col}, ${(0.3 + b * 0.3) * glow})`);
  g.addColorStop(0.45, `rgba(${col}, ${(0.1 + b * 0.14) * glow})`);
  g.addColorStop(1, `rgba(${col}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o, o, R, 0, Math.PI * 2); ctx.fill();

  // 2) corona: soft tapered light rays of uneven length, pointing straight out (no spinning)
  for (let i = 0; i < N; i++) {
    const a = SUN.ang[i];
    const L = (3 + SUN.len[i] * 22 * (0.45 + lvl * 0.55)) * SUN.jit[i];
    const r0 = 12, r1 = r0 + L;
    const half = (0.022 + SUN.len[i] * 0.018) * (i % 3 === 0 ? 1.4 : 1);   // angular half-width of the wedge
    const alpha = (0.08 + SUN.len[i] * 0.34) * glow;
    const rc = vizStr(i < N / 2 ? i / (N / 2) : (N - i) / (N / 2));   // palette runs round the sun, mirrored
    const rg = ctx.createRadialGradient(o, o, r0, o, o, r1);
    rg.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.55})`);
    rg.addColorStop(0.2, `rgba(${rc}, ${alpha})`);
    rg.addColorStop(1, `rgba(${rc}, 0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(o + Math.cos(a - half) * r0, o + Math.sin(a - half) * r0);
    ctx.lineTo(o + Math.cos(a) * r1, o + Math.sin(a) * r1);
    ctx.lineTo(o + Math.cos(a + half) * r0, o + Math.sin(a + half) * r0);
    ctx.closePath();
    ctx.fill();
  }

  // 3) shock-rings travelling outward on each kick
  for (let j = SUN.rings.length - 1; j >= 0; j--) {
    const rg = SUN.rings[j];
    rg.r += dt * 0.085; rg.life -= dt / 650;
    if (rg.life <= 0) { SUN.rings.splice(j, 1); continue; }
    ctx.strokeStyle = `rgba(${col}, ${rg.life * 0.22 * glow})`;
    ctx.lineWidth = 0.8 + rg.life * 1.2;
    ctx.beginPath(); ctx.arc(o, o, rg.r, 0, Math.PI * 2); ctx.stroke();
  }
  }   // end sun-only layers

  // 4) emitted light streaks: little beams fired outward that fade as they travel (both styles)
  ctx.lineCap = 'round';
  for (let j = SUN.beams.length - 1; j >= 0; j--) {
    const p = SUN.beams[j];
    p.r += p.v * dt * 0.8; p.life -= dt / 800;
    if (p.life <= 0 || p.r > o) { SUN.beams.splice(j, 1); continue; }
    const r0 = orb ? 13 : 12;
    const x0 = o + Math.cos(p.a) * p.r, y0 = o + Math.sin(p.a) * p.r;
    const x1 = o + Math.cos(p.a) * Math.max(r0, p.r - p.len), y1 = o + Math.sin(p.a) * Math.max(r0, p.r - p.len);
    const lg = ctx.createLinearGradient(x0, y0, x1, y1);
    const pa = p.life * (0.45 + glow * 0.55);
    lg.addColorStop(0, `rgba(255, 255, 255, ${pa * 0.95})`);
    const sc = p.c || col;                               // each spark keeps the palette colour it was born with
    lg.addColorStop(0.3, `rgba(${sc}, ${pa * 0.7})`);
    lg.addColorStop(1, `rgba(${sc}, 0)`);
    ctx.strokeStyle = lg;
    ctx.lineWidth = p.w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  // 5) bright rim hugging the icon (the icon itself is cut out below, so it stays crisp)
  let g;
  if (!orb) {
  g = ctx.createRadialGradient(o, o, 10, o, o, 16 + b * 5);
  g.addColorStop(0, `rgba(255, 255, 255, ${(0.25 + b * 0.35) * glow})`);
  g.addColorStop(0.45, `rgba(${col}, ${(0.22 + b * 0.25) * glow})`);
  g.addColorStop(1, `rgba(${col}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o, o, 16 + b * 5, 0, Math.PI * 2); ctx.fill();
  }

  // ---- keep the pill readable: dim the light that falls on the pill (time / title),
  //      but leave it bright right around the icon and everywhere outside the notch.
  ctx.globalCompositeOperation = 'destination-out';
  const ir = $('island').getBoundingClientRect();
  const ox = cx - o, oy = cy - o;                       // canvas origin in window coords
  const dim = ctx.createRadialGradient(o, o, orb ? 19 : 16, o, o, 46);
  dim.addColorStop(0, 'rgba(0,0,0,0)');
  dim.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = dim;
  ctx.fillRect(ir.left - ox, ir.top - oy, ir.width, ir.height);
  if (!orb) {
    // cut the icon itself out completely
    const ah = ar.width / 2 + 0.5;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.roundRect(o - ah, o - ah, ah * 2, ah * 2, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  if (orb) drawOrbNote(ctx, o, b);

  if (orb) {   // the orb replaces the square art
    art.style.transform = ''; art.style.boxShadow = ''; art.style.filter = '';
    return;
  }
  // the icon itself lights up
  art.style.transform = `scale(${(1 + b * 0.1 * glow).toFixed(3)})`;
  art.style.boxShadow = `0 0 ${(5 + b * 8 * glow).toFixed(1)}px ${(b * 1.5 * glow).toFixed(1)}px rgba(${col}, ${((0.35 + b * 0.45) * glow + 0.15).toFixed(2)})`;
  art.style.filter = `brightness(${(1 + b * 0.3 * glow).toFixed(2)})`;
}

// ================================================================== "orb": a holographic globe (ported from the author's Friday project), shrunk into the pill
// A globe of glowing rings (some dashed, some partial arcs) around a white-hot core, an inner sphere
// turning the other way, a couple of outer orbits and drifting dust. Each piece of line is shaded by
// its depth (far side dim) and everything is added together as light, so piled-up light burns white.
const ORB_R = 12.5;                  // css px radius of the globe

const ORB = (() => {
  let seed = 11;                                           // same seed, same globe every time
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function ring(normal, n, offset = 0, scale = 1) {
    const nn = norm(normal);
    const u = norm(cross(nn, Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const v = cross(nn, u);
    const k = Math.sqrt(1 - offset * offset);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let d = 0; d < 3; d++) pts[i * 3 + d] = (nn[d] * offset + k * (c * u[d] + s * v[d])) * scale;
    }
    return pts;
  }
  const lines = [];                                        // { pts, on: Uint8Array per segment, base, layer }
  const arcMask = (n, spans, minLen, maxLen) => {
    const on = new Uint8Array(n);
    for (let s = 0; s < spans; s++) { const st = Math.floor(rnd() * n), len = minLen + Math.floor(rnd() * (maxLen - minLen)); for (let i = 0; i < len; i++) on[(st + i) % n] = 1; }
    return on;
  };
  for (let k = 0; k < 16; k++) {                           // shell: great circles drawn as partial arcs
    const n = 56;
    const on = arcMask(n, 1 + Math.floor(rnd() * 2), 14, 40);
    const style = rnd();
    if (style < 0.25) for (let i = 0; i < n; i += 2) on[i] = 0;          // dotted
    lines.push({ pts: ring([gauss(), gauss(), gauss()], n, k >= 12 ? 0.35 + rnd() * 0.35 : 0), on, base: 0.45 + rnd() * 0.55, layer: 0 });
  }
  for (const lat of [-50, -25, 0, 25, 50]) {               // latitude bands, each with a gap
    const n = 60, r = Math.cos(lat * Math.PI / 180), y = Math.sin(lat * Math.PI / 180);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.set([r * Math.cos(a), y, r * Math.sin(a)], i * 3); }
    const on = new Uint8Array(n).fill(1);
    const gap = Math.floor(rnd() * n); for (let i = 0; i < 6 + rnd() * 8; i++) on[(gap + i) % n] = 0;
    lines.push({ pts, on, base: lat === 0 ? 0.85 : 0.5, layer: 0 });
  }
  for (let k = 0; k < 5; k++) {                            // inner sphere, turning the other way
    const n = 36;
    lines.push({ pts: ring([gauss(), gauss(), gauss()], n, 0, 0.5), on: arcMask(n, 2, 10, 26), base: 0.45 + rnd() * 0.35, layer: 1 });
  }
  for (const r of [1.2, 1.32]) {                           // outer orbits round the middle
    const tilt = (rnd() - 0.5);
    const n = 80;
    lines.push({ pts: ring([Math.sin(tilt), Math.cos(tilt), (rnd() - 0.5) * 0.6], n, 0, r), on: arcMask(n, 2, 20, 45), base: 0.6, layer: 2 });
  }
  const dust = [];
  for (let i = 0; i < 70; i++) {
    const d = norm([gauss(), gauss(), gauss()]);
    const r = i < 50 ? 1 + gauss() * 0.03 : 1.08 + rnd() * 0.4;
    dust.push([d[0] * r, d[1] * r, d[2] * r, rnd() * Math.PI * 2, 0.6 + rnd() * 2]);
  }
  return { lines, dust, yaw: 0, inner: 0, orbit: 0 };
})();

function drawOrb(ctx, o, b, lvl, glow, dt, t) {
  const ORB_MAIN = vizStr(0.5);          // structure + halo: palette middle (accent purple by default)
  const ORB_HOT = vizHot(0.5, 0.6);      // the burning core: the same colour, heated towards white
  const R = ORB_R * (1 + b * 0.08);
  // spin: set by the song's mood + the sensitivity (see SUN.spinRate in sunFrame)
  const rate = SUN.spinRate ?? (0.35 + b * 1.4);
  ORB.yaw += dt / 1000 * rate;
  ORB.inner -= dt / 1000 * (0.25 + rate * 1.3);
  ORB.orbit += dt / 1000 * (0.1 + rate * 0.6);
  const pitch = 0.38 + Math.sin(t / 2600) * 0.08;
  const mats = [ORB.yaw, ORB.inner, ORB.orbit].map(yaw => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // rotate about y (yaw), then tip about x (pitch)
    return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy];
  });
  const depth = z => 0.1 + 0.9 * Math.pow(Math.max(0, Math.min(1, (z + 1) / 2)), 1.6);

  // halo: light spilling out of the globe (this is what crosses the notch's edge)
  let g = ctx.createRadialGradient(o, o, R * 0.6, o, o, R * (2.4 + b * 0.9));
  g.addColorStop(0, `rgba(${ORB_MAIN}, ${0.3 * glow + 0.1})`);
  g.addColorStop(0.45, `rgba(${ORB_MAIN}, ${0.1 * glow})`);
  g.addColorStop(1, `rgba(${ORB_MAIN}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o, o, R * (2.4 + b * 0.9), 0, Math.PI * 2); ctx.fill();

  // the burning sun inside
  const cr = R * (0.62 + b * 0.32);
  g = ctx.createRadialGradient(o, o, 0, o, o, cr);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.75 + b * 0.25})`);
  g.addColorStop(0.3, `rgba(${ORB_HOT}, ${0.55 + b * 0.35})`);
  g.addColorStop(0.7, `rgba(${ORB_MAIN}, ${0.25 + b * 0.25})`);
  g.addColorStop(1, `rgba(${ORB_MAIN}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(o, o, cr, 0, Math.PI * 2); ctx.fill();
  // flickering flames licking around the core
  for (let k = 0; k < 6; k++) {
    const a = t / (700 + k * 130) + k * 1.9;
    const d = R * (0.18 + 0.12 * Math.sin(t / 310 + k));
    const fx = o + Math.cos(a) * d, fy = o + Math.sin(a) * d;
    const fr = R * (0.28 + 0.12 * Math.sin(t / 190 + k * 2.3) + b * 0.15);
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, `rgba(${ORB_HOT}, ${0.35 * glow + 0.1})`);
    fg.addColorStop(1, `rgba(${ORB_MAIN}, 0)`);
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
  }

  // the wire globe: each piece of line shaded by depth, batched into brightness steps
  const STEPS = 6;
  const paths = Array.from({ length: STEPS }, () => new Path2D());
  const used = new Uint8Array(STEPS);
  for (const ln of ORB.lines) {
    const m = mats[ln.layer], P = ln.pts, n = P.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      sx[i] = o + (m[0] * x + m[1] * y + m[2] * z) * R;
      sy[i] = o + (m[3] * x + m[4] * y + m[5] * z) * R;
      sz[i] = m[6] * x + m[7] * y + m[8] * z;
    }
    for (let i = 0; i < n; i++) {
      if (!ln.on[i]) continue;
      const j = (i + 1) % n;
      const bri = ln.base * depth((sz[i] + sz[j]) / 2) * (0.55 + glow * 0.45 + b * 0.2);
      const k = Math.max(0, Math.min(STEPS - 1, Math.floor(bri * STEPS)));
      paths[k].moveTo(sx[i], sy[i]); paths[k].lineTo(sx[j], sy[j]);
      used[k] = 1;
    }
  }
  ctx.lineCap = 'round';
  for (let k = 0; k < STEPS; k++) {
    if (!used[k]) continue;
    const a = (k + 1) / STEPS;
    const lc = vizStr(k / (STEPS - 1)), lh = vizHot(k / (STEPS - 1), 0.55);   // multi-colour palettes spread across depth
    ctx.strokeStyle = `rgba(${lc}, ${a * 0.22})`; ctx.lineWidth = 2.2; ctx.stroke(paths[k]);   // soft glow
    ctx.strokeStyle = `rgba(${a > 0.7 ? lh : lc}, ${a * 0.9})`; ctx.lineWidth = 0.65; ctx.stroke(paths[k]);   // bright line
  }

  // dust: twinkling motes on and just outside the shell
  const m = mats[0];
  for (const [x, y, z, ph, rate] of ORB.dust) {
    const pz = m[6] * x + m[7] * y + m[8] * z;
    const a = depth(pz) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * rate * 3 + ph))) * (0.5 + glow * 0.5);
    ctx.fillStyle = `rgba(${ORB_HOT}, ${a})`;
    ctx.fillRect(o + (m[0] * x + m[1] * y + m[2] * z) * R - 0.4, o + (m[3] * x + m[4] * y + m[5] * z) * R - 0.4, 0.8, 0.8);
  }
}

// the small music note sitting in the middle of the burning core
function drawOrbNote(ctx, o, b) {
  ctx.save();
  ctx.translate(o, o);
  const s = 0.36 * (1 + b * 0.06);                       // the 24-unit icon scaled to ~8.6px
  ctx.scale(s, s);
  ctx.translate(-12, -12);
  const ink = `rgba(${vizAt(0.5).map(v => Math.round(v * 0.22)).join(', ')}, 0.88)`;   // a dark shade of the orb colour
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D('M9 18V5l12-2v13'));
  ctx.beginPath(); ctx.arc(6, 18, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(18, 16, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function vizFrame(t) {
  VIZ.raf = requestAnimationFrame(vizFrame);
  if (t - VIZ.last < 33) return;                       // ~30 fps is plenty
  VIZ.last = t;
  const an = VIZ.analyser;
  if (!an) return;
  an.getByteFrequencyData(VIZ.data);
  const hz = VIZ.ctx.sampleRate / an.fftSize;
  // Automatic gain per band: track a slowly-decaying peak and a slowly-rising floor,
  // so bars use their full range whether the music is loud or quiet.
  const vals = BANDS.map(([a, b], k) => {
    let s = 0, n = 0;
    for (let i = Math.max(1, Math.floor(a / hz)); i <= Math.ceil(b / hz) && i < VIZ.data.length; i++) { s += VIZ.data[i]; n++; }
    const raw = n ? s / n / 255 : 0;
    VIZ.peak[k] = Math.max(raw, Math.max(0.25, VIZ.peak[k] * 0.994));
    VIZ.floor[k] = Math.min(raw, VIZ.floor[k] + 0.0025);
    if (raw < 0.04) return 0.12;                                   // silence
    const norm = (raw - VIZ.floor[k]) / Math.max(0.08, VIZ.peak[k] - VIZ.floor[k]);
    return clamp(0.14 + Math.pow(clamp(norm, 0, 1), 1.25) * 0.86, 0.12, 1);
  });
  document.querySelectorAll('.eq.live').forEach(eq => {
    const bars = eq.children;
    const on = eq.classList.contains('playing');
    for (let i = 0; i < bars.length; i++) {
      if (!on) { bars[i].style.height = ''; continue; }
      const k = Math.round(i * (vals.length - 1) / Math.max(1, bars.length - 1));
      bars[i].style.height = (vals[k] * 100).toFixed(0) + '%';
    }
  });
}
