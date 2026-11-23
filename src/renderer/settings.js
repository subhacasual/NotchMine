'use strict';
/* NotchMine settings window. Every option lives here, in its own window, instead of inside the notch.
   A change goes to main.js ('settings-set'), which saves it and passes it on to the notch, the dock,
   the wallpaper and the other windows. Changes made elsewhere (dragging the notch, the tray menu…)
   come back through 'settings'. Shares clamp, esc, ACCENTS, VIZ_PRESETS, … with the notch (common.js). */

const api = window.notch;
const $ = id => document.getElementById(id);
const S = { settings: {}, weather: null, accent: DEFAULT_ACCENT, sec: 'general' };
const SECTIONS = [...document.querySelectorAll('.set-sec')].map(s => s.dataset.sec);

// ================================================================== saving
async function patchSettings(patch) {
  S.settings = await api.setSettings(patch);
  render();
  return S.settings;
}
// sliders and colour pickers: the notch follows while you drag (at most every 50 ms), no full re-render here
let soonPatch = {}, soonT = 0;
function patchSoon(patch) {
  Object.assign(S.settings, patch);
  Object.assign(soonPatch, patch);
  if (!soonT) soonT = setTimeout(flushSoon, 50);
}
function flushSoon() {
  clearTimeout(soonT); soonT = 0;
  const p = soonPatch; soonPatch = {};
  if (Object.keys(p).length) api.setSettings(p);
}

// ================================================================== sections + search
function showSec(sec, { keepSearch = false } = {}) {
  if (!SECTIONS.includes(sec)) sec = 'general';
  if (!keepSearch && $('search').value) { $('search').value = ''; runSearch(''); }
  S.sec = sec;
  document.querySelectorAll('#setNav button[data-sec]').forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
  document.querySelectorAll('.set-sec').forEach(s => s.classList.toggle('active', s.dataset.sec === sec));
  $('scroll').scrollTop = 0;
  try { localStorage.setItem('nm-settings-sec', sec); } catch { /* private storage */ }
  onSecShown(sec);
}
function onSecShown(sec) {
  if (sec === 'general') renderScreens();
  if (sec === 'side') renderSideApps();
  if (sec === 'game') renderGameApps();
  if (sec === 'search') renderEverything();
  if (sec === 'ambient') renderAmbient();
}
document.querySelectorAll('#setNav button[data-sec]').forEach(b => b.addEventListener('click', () => showSec(b.dataset.sec)));
api.on('settings-goto', sec => showSec(sec));

// a row's tooltip becomes a visible description under its name (there's room for it here)
function addDescriptions() {
  document.querySelectorAll('.set-row[title], .slider-set[title]').forEach(row => {
    const t = row.getAttribute('title');
    row.removeAttribute('title');
    if (row.classList.contains('slider-set')) { row.insertAdjacentHTML('beforeend', `<small>${esc(t)}</small>`); return; }
    const lab = row.firstElementChild;
    lab.classList.add('row-txt');
    lab.innerHTML = `<span>${lab.innerHTML}</span><small>${esc(t)}</small>`;
  });
}
// a group's rows, with a label kept together with the picker(s) right under it
function clusters(group) {
  const out = [];
  let cur = null;
  for (const el of group.children) {
    if (el.tagName === 'H2') continue;
    if (el.classList.contains('set-label')) { cur = [el]; out.push(cur); continue; }
    if (cur && !el.matches('.set-row, .slider-set')) { cur.push(el); continue; }
    cur = null;
    out.push([el]);
  }
  return out;
}
const searchText = el => `${el.textContent} ${[el, ...el.querySelectorAll('[title]')].map(x => x.title || '').join(' ')}`.toLowerCase();
// searching shows every section at once, with only the rows (or whole groups / sections) whose words match
function runSearch(raw) {
  const q = raw.trim().toLowerCase();
  document.querySelectorAll('.s-hide').forEach(el => el.classList.remove('s-hide'));
  document.body.classList.toggle('searching', !!q);
  $('noResults').hidden = true;
  if (!q) { showSec(S.sec, { keepSearch: true }); return; }
  const words = q.split(/\s+/);
  const hit = el => { const t = searchText(el); return words.every(w => t.includes(w)); };
  let any = false;
  for (const sec of document.querySelectorAll('.set-sec')) {
    const secHit = hit(sec.querySelector('.sec-head h1'));
    let secAny = false;
    for (const g of sec.querySelectorAll('.group')) {
      const h = g.querySelector(':scope > h2');
      if (secHit || (h && hit(h))) { secAny = true; continue; }
      let gAny = false;
      for (const c of clusters(g)) {
        if (c.some(hit)) gAny = true;
        else c.forEach(el => el.classList.add('s-hide'));
      }
      if (gAny) secAny = true; else g.classList.add('s-hide');
    }
    if (secAny) { any = true; onSecShown(sec.dataset.sec); } else sec.classList.add('s-hide');
  }
  $('noResults').hidden = any;
  $('noResultsQ').textContent = raw.trim();
  $('scroll').scrollTop = 0;
}
$('search').addEventListener('input', e => runSearch(e.target.value));
$('search').addEventListener('keydown', e => {
  if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; runSearch(''); }
  if (e.key === 'Enter') {                       // jump to the first section that matches
    const first = document.querySelector('.set-sec:not(.s-hide)');
    if (first && e.target.value.trim()) showSec(first.dataset.sec);
  }
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) { e.preventDefault(); $('search').focus(); $('search').select(); }
});

// ================================================================== generic controls
// switches
document.querySelectorAll('[data-setting]').forEach(el => {
  el.addEventListener('change', () => patchSettings({ [el.dataset.setting]: el.checked }));
});
// segmented buttons (.seg[data-seg]); numbers unless data-type="str"
document.querySelectorAll('.seg[data-seg]').forEach(seg => seg.addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  const patch = { [seg.dataset.seg]: seg.dataset.type === 'str' ? b.dataset.v : Number(b.dataset.v) };
  if (seg.dataset.seg === 'posX') patch.posY = 0;            // Left / Center / Right = along the top
  patchSettings(patch);
}));
// dropdowns (.dd[data-dd]): the button opens the list (upwards when there's no room below), a pick saves it
function closeDropdowns(except) { document.querySelectorAll('.dd.open').forEach(d => { if (d !== except) d.classList.remove('open'); }); }
document.querySelectorAll('.dd[data-dd]').forEach(dd => {
  const list = dd.querySelector('.dd-list');
  dd.querySelector('.dd-btn').addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    closeDropdowns(dd);
    if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
    const box = $('scroll').getBoundingClientRect(), r = dd.getBoundingClientRect();
    const below = box.bottom - r.bottom - 8, above = r.top - box.top - 8;
    dd.classList.toggle('up', below < 180 && above > below);
    list.style.maxHeight = `${Math.max(110, Math.min(280, dd.classList.contains('up') ? above : below))}px`;
    dd.classList.add('open');
    list.querySelector('button.active')?.scrollIntoView({ block: 'nearest' });
  });
  list.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    e.stopPropagation();
    e.preventDefault();
    dd.classList.remove('open');
    patchSettings({ [dd.dataset.dd]: b.dataset.v });
  });
});
document.addEventListener('click', () => closeDropdowns());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdowns(); });
$('scroll').addEventListener('scroll', () => closeDropdowns());

// sliders (input[data-range]): value shown in the element named by data-out
const RANGE_DEFAULTS = { fxSensitivity: 50, deskEqIntensity: 60, deskEqHeight: 45, sideFadeBg: 95, sideFadeFg: 85, wpAmount: 60, wpDim: 15, ambBright: 70, ambSat: 40, ambSpeed: 50, ambEqHeight: 40 };
function paintRange(el, v) {
  el.style.setProperty('--p', v + '%');
  $(el.dataset.out).textContent = v + '%';
}
document.querySelectorAll('[data-range]').forEach(el => {
  el.addEventListener('input', () => { paintRange(el, +el.value); patchSoon({ [el.dataset.range]: +el.value }); });
  el.addEventListener('change', flushSoon);
});

// ================================================================== General: screens
async function renderScreens() {
  const list = await api.displays();
  $('screenRow').style.display = list.length > 1 ? '' : 'none';
  const cur = S.settings.displayId ?? (list.find(d => d.primary) || {}).id;
  $('screenSeg').innerHTML = list.map(d =>
    `<button data-v="${d.id}" class="${d.id === cur ? 'active' : ''}" title="${d.w}×${d.h}${d.primary ? ' · main screen' : ''}">${d.index}${d.primary ? ' ★' : ''}</button>`).join('');
}
$('quitBtn').addEventListener('click', () => api.quit());

// ================================================================== Appearance
$('themePick').addEventListener('click', e => {
  const b = e.target.closest('button[data-theme]');
  if (b) patchSettings({ theme: b.dataset.theme });
});
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
// a custom accent colour: the notch follows while picking, saved when the picker closes
$('accentCustom').addEventListener('input', e => patchSoon({ accentMode: 'custom', accentCustom: e.target.value }));
$('accentCustom').addEventListener('change', e => { flushSoon(); patchSettings({ accentMode: 'custom', accentCustom: e.target.value }); });

// visualizer colours: presets, or a mix of up to three colours of your own
document.querySelectorAll('#vizPick [data-viz]').forEach(b => {
  const p = VIZ_PRESETS[b.dataset.viz];
  if (p) b.style.background = `linear-gradient(135deg, ${p.join(', ')})`;
});
$('vizPick').addEventListener('click', e => {
  const b = e.target.closest('[data-viz]');
  if (b) patchSettings({ vizPalette: b.dataset.viz });
});
const vizCustomList = () => (S.settings.vizCustom || ['#a78bfa', '#ff3787', '#40c8e0']).slice();
document.querySelectorAll('.vz-col').forEach(inp => {
  inp.addEventListener('input', () => {
    const list = vizCustomList();
    list[+inp.dataset.i] = inp.value;
    patchSoon({ vizCustom: list, vizPalette: 'custom' });
    renderVizButtons();
  });
  inp.addEventListener('change', () => {
    const list = vizCustomList();
    list[+inp.dataset.i] = inp.value;
    flushSoon();
    patchSettings({ vizCustom: list, vizPalette: 'custom' });
  });
});
$('vizCount').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (b) patchSettings({ vizCustomCount: +b.dataset.n, vizPalette: 'custom' });
});
function renderVizButtons() {
  const s = S.settings;
  const n = clamp(s.vizCustomCount || 3, 1, 3), cols = vizCustomList().slice(0, n);
  $('vizPick').querySelector('.viz-custom-btn').style.background = cols.length > 1 ? `linear-gradient(135deg, ${cols.join(', ')})` : (cols[0] || '#a78bfa');
  $('vizPick').querySelector('[data-viz="accent"]').style.background = 'rgb(var(--accent))';
}

// ================================================================== Widgets
const idleCfg = () => ({ date: true, weather: true, cpu: true, ram: true, gpu: true, net: true, battery: true, alerts: true, ...(S.settings.idleStats || {}) });
$('idlePick').addEventListener('click', e => {
  const b = e.target.closest('[data-stat]');
  if (b) patchSettings({ idleStats: { ...idleCfg(), [b.dataset.stat]: !idleCfg()[b.dataset.stat] } });
});
async function saveCity() {
  const q = $('setCity').value.trim();
  if (!q) return;
  $('cityHint').textContent = 'Searching…';
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
    const j = await r.json();
    const g = j.results && j.results[0];
    if (!g) { $('cityHint').textContent = `Couldn't find "${q}"`; return; }
    await patchSettings({ city: g.name, lat: g.latitude, lon: g.longitude });   // the notch fetches the new weather
    $('setCity').value = g.name;
    $('cityHint').textContent = `✓ ${[g.name, g.admin1, g.country].filter(Boolean).join(', ')}`;
  } catch {
    $('cityHint').textContent = 'Network error, try again';
  }
}
$('setCitySave').addEventListener('click', saveCity);
$('setCity').addEventListener('keydown', e => { if (e.key === 'Enter') saveCity(); });
function savePomodoro() {
  const work = clamp(parseInt($('setWork').value, 10) || 25, 1, 180);
  const brk = clamp(parseInt($('setBreak').value, 10) || 5, 1, 60);
  patchSettings({ pomodoroWork: work, pomodoroBreak: brk });
}
$('setWork').addEventListener('change', savePomodoro);
$('setBreak').addEventListener('change', savePomodoro);

// ================================================================== app chips (Side mode + Game mode lists)
const appIcons = new Map();
function appIcon(a) {
  if (!a.path) return null;
  if (!appIcons.has(a.path)) appIcons.set(a.path, api.appIcon(a.path));
  return appIcons.get(a.path);
}
function appChip(a, removable) {
  const letter = esc((a.name || a.exe).charAt(0).toUpperCase());
  return `<button class="side-chip" data-exe="${esc(a.exe)}" title="${esc(a.exe)}">
    <span class="sc-ic"><span class="app-letter" style="background:${avatarColor(a.name || a.exe)}">${letter}</span></span>
    <span class="sc-name">${esc(a.name || a.exe)}</span>${removable ? `<span class="sc-x">${icon('x')}</span>` : `<span class="sc-x add">${icon('plus')}</span>`}</button>`;
}
// swap the letter tiles for the apps' real icons (a listed app borrows path/icon from the recent list)
function fillChipIcons(boxes, listed, recentAll, recent) {
  const all = listed.map(a => { const r = recentAll.find(x => x.exe === a.exe) || {}; return { ...a, path: a.path || r.path, icon: r.icon }; }).concat(recent);
  boxes.forEach(box => box.querySelectorAll('.side-chip').forEach(async el => {
    const a = all.find(x => x.exe === el.dataset.exe);
    const src = a && (a.icon || await appIcon(a));
    if (src) el.querySelector('.sc-ic').innerHTML = `<img src="${esc(src)}" alt="">`;
  }));
}
const chipList = (list, removable, empty) => list.length ? list.map(a => appChip(a, removable)).join('') : `<span class="muted small">${empty}</span>`;

// ---- Side mode: the apps that send the notch to the right edge
let sideRecent = [];
async function renderSideApps() {
  const list = S.settings.sideApps || [];
  $('sideList').innerHTML = chipList(list, true, 'No apps yet');
  const recentAll = await api.sideApps();
  sideRecent = recentAll.filter(r => !list.some(a => a.exe === r.exe)).slice(0, 10);
  $('sideRecent').innerHTML = chipList(sideRecent, false, 'Switch to an app, then come back here');
  fillChipIcons([$('sideList'), $('sideRecent')], list, recentAll, sideRecent);
}
$('sideList').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  if (b) patchSettings({ sideApps: (S.settings.sideApps || []).filter(a => a.exe !== b.dataset.exe) }).then(renderSideApps);
});
$('sideRecent').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  const a = b && sideRecent.find(x => x.exe === b.dataset.exe);
  if (a) patchSettings({ sideApps: [...(S.settings.sideApps || []), { exe: a.exe, name: a.name, path: a.path }] }).then(renderSideApps);
});

// ---- Game mode: always / never a game
let gameRecent = [];
async function renderGameApps() {
  const mine = S.settings.gameApps || [], never = S.settings.notGames || [];
  $('gameList').innerHTML = chipList(mine, true, 'None yet: most games are found by themselves');
  $('notGameList').innerHTML = chipList(never, true, 'Nothing');
  const recentAll = await api.sideApps();
  gameRecent = recentAll.filter(r => !mine.some(a => a.exe === r.exe) && !never.some(a => a.exe === r.exe)).slice(0, 10);
  $('gameRecent').innerHTML = chipList(gameRecent, false, 'Start a game, then come back here');
  fillChipIcons([$('gameList'), $('notGameList'), $('gameRecent')], [...mine, ...never], recentAll, gameRecent);
}
$('gameList').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  if (b) patchSettings({ gameApps: (S.settings.gameApps || []).filter(a => a.exe !== b.dataset.exe) }).then(renderGameApps);
});
$('notGameList').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  if (b) patchSettings({ notGames: (S.settings.notGames || []).filter(a => a.exe !== b.dataset.exe) }).then(renderGameApps);
});
$('gameRecent').addEventListener('click', e => {
  const b = e.target.closest('.side-chip');
  const a = b && gameRecent.find(x => x.exe === b.dataset.exe);
  if (a) patchSettings({ gameApps: [...(S.settings.gameApps || []), { exe: a.exe, name: a.name, path: a.path }] }).then(renderGameApps);
});

// ================================================================== Taskbar
// main.js does the work (syncDock) whenever tbStyle changes
const TB_STYLES = ['dockeq', 'dock', 'bar'];
function renderTaskbarUI() {
  const s = S.settings;
  const cur = s.tbStyle || 'windows', custom = TB_STYLES.includes(cur);
  document.querySelectorAll('#tbStyles [data-tb]').forEach(b => b.classList.toggle('active', b.dataset.tb === cur));
  $('tbBack').classList.toggle('to-nm', !custom);
  $('tbBackTxt').textContent = custom ? 'Back to the Windows taskbar' : 'Use the NotchMine taskbar';
  $('tbOpts').classList.toggle('off', !custom);
  // the floating dock has its own equalizer switch
  $('tbEqRow').hidden = cur === 'dock';
  $('tbFloatEqRow').hidden = cur !== 'dock';
}
$('tbStyles').addEventListener('click', e => {
  const b = e.target.closest('[data-tb]');
  if (b) patchSettings({ tbStyle: b.dataset.tb });
});
$('tbPinsReset').addEventListener('click', async () => {
  const b = $('tbPinsReset'), label = b.querySelector('span');
  await patchSettings({ tbPinsReset: true });
  label.textContent = 'Copied ✓';
  setTimeout(() => { label.textContent = 'Copy from Windows taskbar'; }, 2500);
});
$('tbBack').addEventListener('click', () => {
  const s = S.settings;
  patchSettings({ tbStyle: TB_STYLES.includes(s.tbStyle) ? 'windows' : (s.tbLast || 'dockeq') });
});

// ================================================================== Wallpaper
const WP_NAMES = { rain: 'Rain', storm: 'Storm', snow: 'Snow', sunny: 'Sunny', cloudy: 'Cloudy', night: 'Starry night', aurora: 'Aurora', music: 'Music' };
// same mapping as renderer/wallpaper.js: WMO weather code → wallpaper style
function wpStyleFor(w) {
  if (!w) return null;
  const c = w.code, day = w.isDay !== false;
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c <= 2) return day ? 'sunny' : (S.settings.wpNight === 'aurora' ? 'aurora' : 'night');
  return 'cloudy';
}
function renderWpNow() {
  const s = S.settings;
  const manual = s.wpMode === 'manual';
  $('wpAutoBox').hidden = manual;
  $('wpStyles').hidden = !manual;
  document.querySelectorAll('#wpStyles [data-wps]').forEach(b => b.classList.toggle('active', b.dataset.wps === (s.wpStyle || 'rain')));
  const w = S.weather, st = wpStyleFor(w);
  $('wpNowIc').innerHTML = w ? icon(wxIcon(w.code, w.isDay !== false)) : '';
  $('wpNowTxt').innerHTML = w && st
    ? `Now in ${esc(s.city || 'your city')}: ${w.text ? `<b>${esc(w.text)}</b> → ` : ''}<b>${WP_NAMES[st]}</b>${s.wpOn ? '' : ' (turn Live wallpaper on to see it)'}`
    : 'Set your city in Widgets so it can follow the weather. Until then: sunny by day, stars at night.';
}
// Background → My wallpaper: a preview of the Windows wallpaper it uses
let myWp = null, myWpAsked = false;
function renderMyWp() {
  const mine = S.settings.wpBack === 'mine';
  $('wpMine').hidden = !mine;
  if (!mine) return;
  if (!myWp && !myWpAsked) { myWpAsked = true; api.myWallpaper().then(w => { myWp = w; renderMyWp(); }); return; }
  if (!myWp) return;
  const file = myWp.path ? myWp.path.split(/[\\/]/).pop() : '';
  $('wpMineName').textContent = !myWp.path ? 'No Windows wallpaper found' : /^TranscodedWallpaper$/i.test(file) ? 'Your Windows wallpaper' : file;
  $('wpMineImg').style.backgroundImage = myWp.thumb ? `url("${myWp.thumb}")` : '';
}
api.on('my-wallpaper', w => { myWp = w; renderMyWp(); });
$('wpStyles').addEventListener('click', e => {
  const b = e.target.closest('[data-wps]');
  if (b) patchSettings({ wpStyle: b.dataset.wps });
});
api.on('wp-weather', w => { S.weather = w; renderWpNow(); });

// ================================================================== Search
const HK_DEFAULT = 'Ctrl+Alt+Space';
let hkRec = false;
const hkLabel = a => (a || HK_DEFAULT).replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl').replace(/\bSuper\b/g, 'Win');
function hkNote(text, bad) { $('hkNote').textContent = text || ''; $('hkNote').classList.toggle('bad', !!bad); }
function renderSearch() {
  $('hkBtn').textContent = hkRec ? 'Press the keys…' : hkLabel(S.settings.searchHotkey);
  $('hkBtn').classList.toggle('rec', hkRec);
  $('hkTxt').textContent = hkLabel(S.settings.searchHotkey);
}
// the key part of a shortcut, as Electron names it (null for a modifier on its own)
function hkKey(e) {
  const c = e.code || '';
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(c)) return null;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return 'num' + c.slice(6);
  if (/^F\d{1,2}$/.test(c)) return c;
  const map = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/',
  };
  return map[c] || null;
}
function hkStop() { hkRec = false; api.searchPauseHotkey(false); renderSearch(); }
$('hkBtn').addEventListener('click', () => {
  if (hkRec) { hkStop(); return; }
  hkRec = true;
  hkNote('');
  api.searchPauseHotkey(true);                    // so pressing the current shortcut doesn't open the box
  renderSearch();
});
$('hkBtn').addEventListener('blur', () => { if (hkRec) hkStop(); });
document.addEventListener('keydown', async e => {
  if (!hkRec) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { hkStop(); return; }
  const key = hkKey(e);
  if (!key) return;                                // just a modifier so far: wait for the key
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const fkey = /^F\d{1,2}$/.test(key);
  if (!fkey && (!mods.length || (mods.length === 1 && mods[0] === 'Shift'))) {
    hkNote('Add Ctrl or Alt, so the shortcut doesn\'t get in the way of typing.', true);
    return;
  }
  const accel = [...mods, key].join('+');
  hkRec = false;
  const r = await api.searchSetHotkey(accel);
  if (r && r.ok) { S.settings.searchHotkey = accel; hkNote(''); }
  else { api.searchPauseHotkey(false); hkNote(`${hkLabel(accel)} is already used by Windows or another app. Try a different one.`, true); }
  renderSearch();
}, true);
$('hkReset').addEventListener('click', async () => {
  const r = await api.searchSetHotkey(HK_DEFAULT);
  if (r && r.ok) { S.settings.searchHotkey = HK_DEFAULT; hkNote(''); }
  else hkNote(`${hkLabel(HK_DEFAULT)} is already used by another app.`, true);
  renderSearch();
});
$('searchGo').addEventListener('click', () => api.searchOpen());
async function renderEverything() {
  const st = await api.searchStatus().catch(() => null);
  const txt = $('evTxt'), btns = $('evBtns');
  txt.classList.toggle('ok', !!(st && st.running));
  if (st && st.running) {
    txt.textContent = `Running${st.version ? ' (version ' + st.version + ')' : ''}. Files are found instantly on every drive.`;
    btns.innerHTML = '';
  } else if (st && st.installed) {
    txt.textContent = 'Installed, but not running. Until it runs, NotchMine uses the slower Windows search index.';
    btns.innerHTML = '<button class="pill-btn primary small" data-ev="start" type="button">Start Everything</button>';
  } else {
    txt.textContent = 'Free file search from voidtools.com that finds any file by name instantly. Without it, NotchMine uses the slower Windows search index.';
    btns.innerHTML = '<button class="pill-btn primary small" data-ev="get" type="button"><i data-icon="external"></i><span>Get Everything</span></button>';
    hydrateIcons(btns);
  }
}
$('evBtns').addEventListener('click', e => {
  const b = e.target.closest('[data-ev]');
  if (!b) return;
  api.searchEverything(b.dataset.ev);
  if (b.dataset.ev === 'start') setTimeout(renderEverything, 3000);
});

// ================================================================== Party
const partyLights = () => ({ beams: true, glow: true, particles: true, albumArt: true, ...(S.settings.partyLights || {}) });
document.querySelectorAll('[data-light]').forEach(el => el.addEventListener('change', () => {
  patchSettings({ partyLights: { ...partyLights(), [el.dataset.light]: el.checked } });
}));
$('partyGo').addEventListener('click', () => api.partyStart());

// ================================================================== Ambient screen (needs two screens)
async function renderAmbient() {
  const one = (await api.displays()).length < 2;
  $('ambNeed').hidden = !one;
  document.querySelector('.set-sec[data-sec=ambient]').classList.toggle('amb-off', one);
}
$('ambPreview').addEventListener('click', () => api.ambPreview());

// ================================================================== show the current settings
function render() {
  const s = S.settings;
  document.querySelectorAll('[data-setting]').forEach(el => { el.checked = !!s[el.dataset.setting]; });
  document.querySelectorAll('.seg[data-seg]').forEach(seg => {
    if (seg.id === 'screenSeg') return;
    const str = seg.dataset.type === 'str';
    const v = str ? String(s[seg.dataset.seg]) : Number(s[seg.dataset.seg]);
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', (str ? b.dataset.v : Number(b.dataset.v)) === v));
  });
  $('screenSeg').querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.v) === s.displayId));
  document.querySelectorAll('.dd[data-dd]').forEach(dd => {
    const items = [...dd.querySelectorAll('.dd-list button[data-v]')];
    const cur = items.find(b => b.dataset.v === String(s[dd.dataset.dd])) || items[0];
    items.forEach(b => b.classList.toggle('active', b === cur));
    dd.querySelector('.dd-val').textContent = cur ? cur.textContent : '';
  });
  document.querySelectorAll('[data-range]').forEach(el => {
    const v = s[el.dataset.range] ?? RANGE_DEFAULTS[el.dataset.range] ?? 50;
    if (document.activeElement !== el) { el.value = v; paintRange(el, v); }
  });
  const ic = idleCfg();
  document.querySelectorAll('#idlePick [data-stat]').forEach(b => b.classList.toggle('on', !!ic[b.dataset.stat]));
  const pl = partyLights();
  document.querySelectorAll('[data-light]').forEach(el => { el.checked = !!pl[el.dataset.light]; });
  document.querySelectorAll('#themePick button').forEach(b => b.classList.toggle('active', b.dataset.theme === (s.theme || 'midnight')));
  document.querySelectorAll('#accentPick button').forEach(b => b.classList.toggle('active', b.dataset.accent === (s.accentMode || 'auto')));
  document.querySelectorAll('#fxPick button').forEach(b => b.classList.toggle('active', b.dataset.fx === (s.artFx || 'sun')));
  const pal = s.vizPalette || 'accent';
  document.querySelectorAll('#vizPick [data-viz]').forEach(b => b.classList.toggle('active', b.dataset.viz === pal));
  $('vizMixer').classList.toggle('open', pal === 'custom');
  const cols = vizCustomList(), cnt = clamp(s.vizCustomCount || 3, 1, 3);
  document.querySelectorAll('.vz-col').forEach(inp => {
    if (document.activeElement !== inp) inp.value = cols[+inp.dataset.i] || '#a78bfa';
    inp.style.display = +inp.dataset.i < cnt ? '' : 'none';
  });
  document.querySelectorAll('#vizCount button').forEach(b => b.classList.toggle('active', +b.dataset.n === cnt));
  renderVizButtons();
  const ac = $('accentCustom');
  if (document.activeElement !== ac) ac.value = s.accentCustom || '#a78bfa';
  ac.parentElement.classList.toggle('active', s.accentMode === 'custom');
  ac.parentElement.style.background = s.accentMode === 'custom' ? s.accentCustom : '';
  if (document.activeElement !== $('setCity')) $('setCity').value = s.city || '';
  if (document.activeElement !== $('setWork')) $('setWork').value = s.pomodoroWork || 25;
  if (document.activeElement !== $('setBreak')) $('setBreak').value = s.pomodoroBreak || 5;
  renderTaskbarUI();
  renderSearch();
  renderWpNow();
  renderMyWp();
}
// the window takes the notch's accent colour (album art, a preset or your own)
function applyAccent(rgb) {
  if (typeof rgb === 'string' && rgb) S.accent = rgb;
  document.documentElement.style.setProperty('--accent', S.accent);
}
api.on('accent', applyAccent);
api.on('settings', s => {
  S.settings = { ...s, ...soonPatch };          // keep a drag that hasn't been sent yet
  render();
  if (S.sec === 'side' && !document.body.classList.contains('searching')) renderSideApps();
  if (S.sec === 'game' && !document.body.classList.contains('searching')) renderGameApps();
});
// coming back to the window: a monitor may have been plugged in, other apps may have been used
window.addEventListener('focus', () => onSecShown(S.sec));

(async function boot() {
  hydrateIcons();
  addDescriptions();
  const init = await api.settingsInit();
  S.settings = init.settings || {};
  S.weather = init.weather || null;
  applyAccent(init.accent);
  if (init.version) $('version').textContent = `NotchMine ${init.version}`;
  render();
  let sec = new URLSearchParams(location.search).get('sec');
  if (!sec) { try { sec = localStorage.getItem('nm-settings-sec'); } catch { /* private storage */ } }
  showSec(sec || 'general');
})();
