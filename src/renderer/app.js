'use strict';
/* NotchMine renderer: state, layout modes and every widget. */

const api = window.notch;
const $ = id => document.getElementById(id);
const island = $('island');
const layers = { collapsed: $('compact'), peek: $('peek'), expanded: $('expanded') };

const EXPANDED = [740, 296];
const STACK_W = 384;          // Stacked layout: width of the tall column
const SIDE_W = 52;            // width of the vertical pill in side mode
const PEEK_H = 62;

const S = {
  mode: 'collapsed',
  tab: 'home',
  pinned: false,
  hover: false,
  dragActive: false,
  settings: {},
  game: null,          // game mode: { exe, name, path, start, icon } while a game is in front
  media: { active: false },
  mediaKey: undefined,
  volume: null,
  brightness: null,
  sys: null,
  batt: null,
  clipboard: [],
  shelf: [],
  peekKey: null,
  peekWidth: 400,
};

let enterTimer = 0, leaveTimer = 0, peekTimer = 0;

// ================================================================== helpers
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
function fmtClock(d, { seconds = false, suffix = false } = {}) {
  const use24 = !!S.settings.use24h;
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const s = seconds ? `:${pad2(d.getSeconds())}` : '';
  if (use24) return `${pad2(h)}:${m}${s}`;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return suffix ? `${h}:${m}${s}<small>${ap}</small>` : `${h}:${m}${s}`;
}
function fmtSpan(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// ================================================================== layout / modes
function isPlaying() { return S.media.active && S.media.status === 'Playing'; }

function compactWidth() {
  const playing = isPlaying();
  const t = timerActive();
  const extra = (typeof indicatorWidth === 'function') ? indicatorWidth() : 0;   // privacy dots / muted mic
  if (playing) {
    const base = (t ? 380 : 350) + extra;
    // a lyric line grows the pill so the whole line fits
    const lyr = (typeof lyricPillWidth === 'function') ? lyricPillWidth() : 0;
    return Math.max(base, lyr);
  }
  return Math.max((t ? 236 : 214) + extra, t ? 0 : (S.idleW || 0));
}
// which live stats the idle pill shows (Settings → Widgets)
const STAT_CHIP = { cpu: ['Processor use', 'chip'], ram: ['Memory use', 'ram'], gpu: ['Graphics card use', 'gpu'], vram: ['Graphics memory in use', 'vram'] };   // tooltip, icon
function idleCfg() { return { date: true, weather: true, cpu: true, ram: true, gpu: true, net: true, battery: true, alerts: true, ...(S.settings.idleStats || {}) }; }
// Hovering only reveals the hidden stats when hover doesn't open the panel (Open = Click).
// Otherwise the panel opens right away and briefly flashing the extra chips just looks glitchy.
function hoverRevealsStats() { return S.settings.idleMinimal && (S.settings.openDelay ?? 140) < 0; }
// what the idle pill shows (right side). Minimal mode keeps it calm: weather + anything urgent,
// and (in click-to-open mode) reveals the rest while the mouse is on the pill.
function idleStatsOn() {
  const o = idleCfg();
  const minimal = S.settings.idleMinimal && !(S.hover && hoverRevealsStats());
  const unread = typeof ALERTS !== 'undefined' ? ALERTS.unread : 0;
  const onBattery = S.batt && hasBattery() && !S.batt.charging;
  const list = [];
  if (o.weather && S.weather) list.push('weather');
  if (!minimal) {
    if (o.cpu) list.push('cpu');
    if (o.ram) list.push('ram');
    if (o.gpu && S.sys && S.sys.gpu != null) list.push('gpu');   // only on PCs that report GPU load
    if (o.net) list.push('net');
  }
  if (o.alerts && unread > 0) list.push('alerts');
  if (o.battery && hasBattery() && (!minimal || onBattery)) list.push('battery');
  return list;
}
// network chip: Wi-Fi bars (or cable) normally; the speed only while something is really downloading
function netMode() {
  const rx = typeof NET !== 'undefined' && NET.cur ? NET.cur.rx : 0;
  const now = Date.now();
  if (rx > 100 * 1024) S.netBusyUntil = now + 4000;            // stays for a few seconds so it doesn't flicker
  if (now < (S.netBusyUntil || 0)) return 'speed';
  const c = S.conn;
  if (!c || c.kind === 'none' || !c.online) return 'off';
  if (c.kind === 'wifi' || c.kind === 'cell') return 'wifi' + Math.max(1, Math.min(4, Math.ceil((c.bars || 0) * 4 / 5)));
  return 'eth';
}
function netChip(mode) {
  if (mode === 'speed') return `<span class="cs net" title="Downloading"><span class="cs-ic">${icon('netDown')}</span><b id="csNet">–</b></span>`;
  if (mode === 'eth') return `<span class="cs net" title="Wired network"><span class="cs-ic">${icon('ethernet')}</span></span>`;
  if (mode === 'off') return `<span class="cs net off" title="No internet"><span class="cs-ic">${icon('wifiOff')}</span></span>`;
  const lv = +mode.slice(4);
  return `<span class="cs net" title="Wi-Fi · ${lv} of 4 bars"><span class="wbars lv${lv}"><i></i><i></i><i></i><i></i></span></span>`;
}
// battery: a bolt when plugged in and full; otherwise the % sits inside the battery shape
function battMode() {
  const b = S.batt;
  if (!b) return '';
  const pct = Math.round(b.level * 100);
  if (b.charging && pct >= 99) return 'full';
  return `${b.charging ? 'chg' : pct <= 20 ? 'low' : 'on'}`;
}
function battChip(mode) {
  if (mode === 'full') return `<span class="cs bfull" title="Plugged in · fully charged"><span class="cs-ic">${icon('bolt')}</span></span>`;
  return `<span class="bat ${mode}${S.game && mode !== 'chg' ? ' gwarn' : ''}" id="cBat" title="${S.game && mode !== 'chg' ? 'On battery: plug in for full gaming performance' : 'Battery'}"><span class="bat-fill" id="cBatFill"></span><b id="cBatPct"></b>${mode === 'chg' ? `<span class="bat-bolt">${icon('bolt')}</span>` : ''}</span>`;
}
// day or night for the sun/moon beside the clock: the weather location knows, else the clock decides
function isNight() {
  if (S.weather && typeof S.weather.isDay === 'boolean') return !S.weather.isDay;
  const h = new Date().getHours();
  return h < 6 || h >= 18;
}
// WMO weather code → icon
function wxIcon(code, day) {
  if (code === 0) return day ? 'wxClear' : 'wxClearN';
  if (code === 1 || code === 2) return day ? 'wxPartly' : 'wxPartlyN';
  if (code === 45 || code === 48) return 'wxFog';
  if (code >= 95) return 'wxStorm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'wxSnow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'wxRain';
  return 'wxCloud';
}
// WMO weather code → the "mood" that colours the Weather theme, the weather card and the pill effects
function weatherMood(w = S.weather) {
  if (!w) return '';
  const c = w.code, day = w.isDay !== false;
  if (c === 0 || c === 1) return day ? 'sunny' : 'night';
  if (c === 2) return day ? 'partly' : 'night-cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 51 && c <= 57) return 'drizzle';
  if (c === 65 || c === 67 || c === 82) return 'heavy';
  if ((c >= 61 && c <= 66) || c === 80 || c === 81) return 'rain';
  return day ? 'cloudy' : 'night-cloudy';
}
// what falls from the sky right now: kind 'rain' | 'snow' | '', amount 0..1, and whether there's lightning
function wxPrecip(w = S.weather) {
  if (!w) return { kind: '', amt: 0, storm: false };
  const c = w.code;
  if (c >= 95) return { kind: 'rain', amt: 1, storm: true };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { kind: 'snow', amt: c === 75 || c === 86 ? 1 : c === 71 || c === 77 ? 0.45 : 0.7, storm: false };
  if (c >= 51 && c <= 57) return { kind: 'rain', amt: c === 51 ? 0.22 : c === 55 || c === 57 ? 0.4 : 0.3, storm: false };
  if (c === 65 || c === 67 || c === 82) return { kind: 'rain', amt: 1, storm: false };
  if (c === 61 || c === 80) return { kind: 'rain', amt: 0.55, storm: false };
  if ((c >= 62 && c <= 66) || c === 81) return { kind: 'rain', amt: 0.75, storm: false };
  return { kind: '', amt: 0, storm: false };
}
// publish the mood on <html> so CSS (Weather theme, card scenes) and the effects engine all agree
function applyWeatherMood() {
  const root = document.documentElement, mood = weatherMood();
  root.dataset.wx = mood;
  root.dataset.wxNight = S.weather && S.weather.isDay === false ? '1' : '';
  if (typeof wxfxEnsure === 'function') wxfxEnsure();
}
function shortRate(b) {
  if (b < 1024) return `${Math.round(b)} B/s`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB/s`;
  return `${(b / 1048576).toFixed(1)} MB/s`;
}

// Stacked layout (Settings → General → Layout): opening shows every section in a tall column
// (the "overview" page). A section's title opens its full page in the same column (‹ goes back);
// every page is laid out top to bottom and the panel is as tall as the page (up to the screen).
function isStacked() { return S.settings.layout === 'stacked'; }
// how tall a page's content is: its cards, or an open overlay (e.g. the phone-drop panel)
function pageContentHeight(page) {
  if (!page) return 0;
  if (page.dataset.page === 'overview') return $('ov').offsetHeight;
  let h = 0;
  for (const el of page.children) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    if (cs.position === 'absolute') { if (cs.visibility === 'visible') h = Math.max(h, el.scrollHeight); continue; }
    h = Math.max(h, el.offsetTop + el.offsetHeight);
  }
  return h;
}
function panelSize() {
  if (!isStacked()) return EXPANDED;
  layers.expanded.style.setProperty('--exp-w', STACK_W + 'px');   // width first: the height depends on it
  const page = document.querySelector(`.page[data-page="${S.tab}"]`);
  const natural = 10 + 32 + 8 + pageContentHeight(page) + 14;      // padding, header, gap, content, padding (see #expanded)
  const top = S.side ? 16 : document.documentElement.dataset.shape === 'island' ? 10 : 0;
  const max = (window.innerHeight || 720) - top - 16;
  return [STACK_W, Math.max(160, Math.min(natural, max))];
}

function applySize() {
  let w, h;
  if (S.mode === 'expanded') {
    [w, h] = panelSize();
    layers.expanded.style.setProperty('--exp-w', w + 'px');
    layers.expanded.style.setProperty('--exp-h', h + 'px');
  }
  else if (isGhost()) [w, h] = S.side ? GHOST_SIDE : GHOST;   // full-screen movie: just a faint thin line (pop-ups too)
  else if (S.mode === 'peek') { w = S.peekWidth; h = S.peekHeight || PEEK_H; }
  else if (S.side) { w = SIDE_W; h = S.sideLen || 240; }  // side mode: an upright vertical column
  else { w = compactWidth(); h = 34; }
  island.classList.toggle('ghost', isGhost());
  applySideFade();
  if (typeof sparkEnsure === 'function') sparkEnsure();   // sun / orb stop while faded, come back on hover
  if (typeof wxfxEnsure === 'function') wxfxEnsure();     // rain / snow on the pill: same rules
  island.style.width = w + 'px';
  island.style.height = h + 'px';
  if (S.side) {
    // side mode: hug the middle of the right edge. Nothing is rotated: the pill is a vertical column
    // with everything upright, and pop-ups / the panel open to the left of the edge.
    const winW = window.innerWidth || 820, winH = window.innerHeight || 720, gap = 10;
    island.style.left = (winW - gap - w / 2) + 'px';
    island.style.top = (winH / 2) + 'px';
    island.style.transform = 'translate(-50%, -50%)';
    trackHitRect();
    return;
  }
  island.style.top = '';
  island.style.transform = '';
  // slide to the spot the main process chose; keep the whole shape (and its ears) inside the window,
  // so near a screen edge an opened panel grows inward instead of off-screen
  const winW = window.innerWidth || 820, ear = 22;
  const cx = clamp(S.anchor ?? winW / 2, w / 2 + ear, winW - w / 2 - ear);
  if (island.style.left !== cx + 'px') {
    island.style.left = cx + 'px';
    trackHitRect();                       // the clickable area must follow the slide, not just size changes
  }
}
// Full-screen app (movie, game) on the notch's screen + Settings → "Full-screen apps: Fade":
// the pill shrinks to a faint thin line and comes back to normal while the mouse is on it.
const GHOST = [128, 5], GHOST_SIDE = [5, 128];
function isGhost() { return !!S.fsDim && !S.hover && S.mode !== 'expanded'; }
function setFullscreenDim(on) {
  on = !!on;
  if (on === !!S.fsDim) return;
  S.fsDim = on;
  applySize();
  trackHitRect();
}
api.on('fullscreen', setFullscreenDim);
// Side mode + Settings → Side mode → "See-through when idle": the resting pill turns almost invisible
// so it doesn't hide the page behind it; it comes back as it was the moment the mouse touches it.
// Pop-ups (volume, notifications…) and the open panel always show normally.
function isSideFaded() { return !!S.side && S.settings.sideFade !== false && !S.hover && S.mode === 'collapsed' && !isGhost(); }
function applySideFade() {
  const root = document.documentElement;
  // the sliders are "transparency": 0 = solid, 100 = invisible (it still opens when the mouse reaches it)
  root.style.setProperty('--side-bg-op', 1 - clamp((S.settings.sideFadeBg ?? 95) / 100, 0, 1));
  root.style.setProperty('--side-fg-op', 1 - clamp((S.settings.sideFadeFg ?? 85) / 100, 0, 1));
  root.dataset.sideFade = isSideFaded() ? '1' : '';
}

let hitTrackUntil = 0;
function trackHitRect() {
  const running = performance.now() < hitTrackUntil;
  hitTrackUntil = performance.now() + 700;
  if (running) return;
  const step = () => { reportHitRect(); if (performance.now() < hitTrackUntil) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
api.on('anchor', a => { S.anchor = a; applySize(); });
function setSide(on) {
  S.side = !!on;
  document.documentElement.dataset.side = S.side ? '1' : '';
  compactKey = '';                     // rebuild so the content re-measures in its new layout
  renderCompact();
  applySize();
  trackHitRect();
  if (S.side) setTimeout(setupMarquee, 300);
}
api.on('side', setSide);
api.on('drag-state', on => island.classList.toggle('moving', !!on));

function setMode(mode) {
  if (S.mode === mode) { applySize(); return; }
  S.mode = mode;
  island.dataset.mode = mode;
  for (const [k, el] of Object.entries(layers)) el.classList.toggle('show', k === mode);
  if (mode !== 'peek') S.peekKey = null;
  applySize();
  if (mode === 'expanded') onExpanded();
  if (typeof sparkEnsure === 'function') sparkEnsure();
}

function expand(tab) {
  clearTimeout(peekTimer);
  clearTimeout(enterTimer);
  if (tab) setTab(tab);
  else if (S.game && S.mode !== 'expanded') setTab('game');           // playing: straight to the Game page
  else if (isStacked() && S.mode !== 'expanded') setTab('overview');   // Stacked always opens on every section
  setMode('expanded');
}

function collapse() {
  clearTimeout(leaveTimer);
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  setMode('collapsed');
}

function typing() {
  const a = document.activeElement;
  return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a.type === 'text' || a.type === 'number')));
}

function scheduleCollapse(delay = 380) {
  clearTimeout(leaveTimer);
  if (S.mode !== 'expanded' || S.pinned) return;
  leaveTimer = setTimeout(() => {
    if (!S.hover && !S.pinned && !S.dragActive && !S.modal && !typing()) collapse();
  }, delay);
}

// Report the clickable region to the main process (everything else is click-through).
const ro = new ResizeObserver(() => requestAnimationFrame(reportHitRect));
ro.observe(island);
function reportHitRect() {
  const r = island.getBoundingClientRect();
  if (S.side) {                                   // a free-floating shape: just its box plus a margin
    const p = S.mode === 'collapsed' ? 10 : 4;
    api.setHitRect({ x: Math.round(r.left - p), y: Math.round(r.top - p), width: Math.round(r.width + p * 2), height: Math.round(r.height + p * 2) });
    return;
  }
  const padX = S.mode === 'collapsed' ? 14 : 20;
  const padB = S.mode === 'collapsed' ? 8 : 2;
  api.setHitRect({ x: Math.round(r.left - padX), y: 0, width: Math.round(r.width + padX * 2), height: Math.round(r.bottom + padB) });
}

api.on('conn', c => { S.conn = c; renderCompact(); });
api.on('hover', h => {
  S.hover = h;
  if (S.fsDim && S.mode !== 'expanded') { applySize(); trackHitRect(); }   // thin line ⇄ normal pill
  applySideFade();                                      // side mode: see-through ⇄ normal pill
  if (hoverRevealsStats()) renderCompact();             // minimal pill + click-to-open: reveal the details while hovered
  if (!h) S.suppressExpand = false;
  // interactive pop-ups (screenshot, download, USB) stay put while the mouse is on them
  if (S.mode === 'peek' && S.peekInteractive) {
    if (h) clearTimeout(peekTimer); else extendPeek(2500);
  }
  if (h) {
    clearTimeout(leaveTimer);
    const delay = S.game ? -1 : S.settings.openDelay ?? 140;   // gaming: click or Ctrl+Alt+G opens it
    const hold = S.mode === 'peek' && S.peekInteractive;
    if (S.mode !== 'expanded' && !S.suppressExpand && !hold && delay >= 0) {
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => { if (S.hover) expand(); }, delay);
    }
  } else {
    clearTimeout(enterTimer);
    scheduleCollapse();
  }
});
api.on('blur', () => { if (!S.hover && !S.pinned && !S.modal && S.mode === 'expanded') collapse(); });
api.on('open-tab', tab => {
  expand(tab);
  api.focus();
  setTimeout(() => { if (!S.hover) scheduleCollapse(6000); }, 50);
});
api.on('pulse', () => {
  island.classList.remove('pulse'); void island.offsetWidth; island.classList.add('pulse');
});
api.on('settings', s => { S.settings = s; applySettingsUI(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { S.pinned = false; $('pinBtn').classList.remove('on'); collapse(); }
  if (e.key === ' ' && !typing() && S.mode === 'expanded') { e.preventDefault(); api.media('toggle'); }
});

// ================================================================== tabs + header
const TAB_NAMES = { game: 'Game', home: 'Home', apps: 'Apps', shelf: 'Shelf', tools: 'Focus', system: 'System', alerts: 'Alerts', settings: 'Settings' };
function setTab(tab) {
  S.tab = tab;
  island.dataset.view = tab === 'overview' ? 'overview' : '';
  if (tab !== 'overview') $('hdrLabel').textContent = TAB_NAMES[tab] || '';   // Stacked: the page's name in the header
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.page === tab));
  if (tab === 'system' || tab === 'overview') { api.refreshBrightness(); renderSys(); }
  if (typeof onTabShown === 'function') onTabShown(tab);
  if (tab === 'overview' && typeof renderOverview === 'function') renderOverview(true);
  if (S.mode === 'expanded') applySize();          // overview <-> a full page changes the panel's shape
  if (typeof wxfxEnsure === 'function') wxfxEnsure();    // the weather card's scene runs only while it's on screen
}
document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => setTab(b.dataset.tab));
  // dragging something over a tab switches to it (e.g. drop a file on Apps)
  b.addEventListener('dragenter', () => setTab(b.dataset.tab));
});
$('pinBtn').addEventListener('click', () => {
  S.pinned = !S.pinned;
  $('pinBtn').classList.toggle('on', S.pinned);
  if (!S.pinned && !S.hover) scheduleCollapse();
});

function onExpanded() {
  renderMediaCard();
  renderClock(true);
  if (S.tab === 'system') { api.refreshBrightness(); renderSys(); }
  if (typeof specEnsure === 'function') specEnsure();
  if (typeof LIVE !== 'undefined' && LIVE.showLyrics) setTimeout(highlightLyric, 80);
}

// ================================================================== peek (live activities)
function peek(key, html, { width = 400, duration = 2600, height = PEEK_H, interactive = false } = {}) {
  if (S.mode === 'expanded') return;
  layers.peek.innerHTML = html;
  hydrateIcons(layers.peek);
  layers.peek.classList.toggle('tall', height > PEEK_H);
  S.peekKey = key;
  S.peekWidth = width;
  S.peekHeight = height;
  S.peekInteractive = interactive;
  setMode('peek');
  applySize();
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (S.mode === 'peek') setMode('collapsed'); }, duration);
}
function extendPeek(duration = 2000) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (S.mode === 'peek') setMode('collapsed'); }, duration);
}

function peekTrack() {
  const m = S.media;
  if (!m.active || !m.title) return;
  peek('track', `
    <div class="pk-art" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}">${m.thumb ? '' : icon('music')}</div>
    <div class="pk-text">
      <div class="pk-title">${esc(m.title)}</div>
      <div class="pk-sub">${esc(m.artist || m.appLabel || appName(m.app))}</div>
    </div>
    <div class="eq big playing live"><i></i><i></i><i></i><i></i><i></i></div>`, { width: 380, duration: 3000 });
}

function peekVolume() {
  const v = S.volume;
  if (!v) return;
  const pct = Math.round(v.level * 100);
  const ic = v.muted || pct === 0 ? 'mute' : pct < 50 ? 'volumeLow' : 'volume';
  if (S.peekKey === 'volume' && S.mode === 'peek') {
    $('pkVolFill').style.width = (v.muted ? 0 : pct) + '%';
    $('pkVolVal').textContent = v.muted ? 'Muted' : pct;
    $('pkVolIcon').innerHTML = icon(ic);
    extendPeek(1800);
    return;
  }
  peek('volume', `
    <div class="pk-icon" id="pkVolIcon">${icon(ic)}</div>
    <div class="pk-meter"><span id="pkVolFill" style="width:${v.muted ? 0 : pct}%"></span></div>
    <div class="pk-val" id="pkVolVal">${v.muted ? 'Muted' : pct}</div>`, { width: 340, duration: 1800 });
}

// ================================================================== compact view
let compactKey = '';
function renderCompact() {
  const playing = isPlaying();
  const tA = timerActive();
  const gm = S.game;                    // game mode: game icon + time played, then the hardware stats
  const left = gm ? 'game' : playing ? 'art' : 'time';
  const center = gm ? '' : playing ? 'title' : '';
  const st = gm ? gameStatsOn() : idleStatsOn();
  const right = gm ? 'stats' : tA ? 'timer' : playing ? 'eq' : (st.length ? 'stats' : idleCfg().date ? 'none' : 'date');
  const ind = (typeof indicatorsHTML === 'function') ? indicatorsHTML() : '';
  const night = isNight();
  const wx = S.weather ? wxIcon(S.weather.code, S.weather.isDay !== false) : '';
  const mood = weatherMood(), overcast = !!mood && !['sunny', 'partly', 'night'].includes(mood);   // sun / moon hidden by clouds
  const showDate = idleCfg().date;
  const nm = st.includes('net') ? netMode() : '', bm = st.includes('battery') ? battMode() : '';
  const unread = typeof ALERTS !== 'undefined' ? ALERTS.unread : 0;
  const key = `${left}|${center}|${right}|${st.join()}|${night}|${wx}|${overcast}|${showDate}|${nm}|${bm}|${unread}|${playing ? S.media.title + S.media.thumbId : ''}|${ind}|${gm ? gm.exe + (gm.icon ? 1 : 0) + (gm.poster ? 1 : 0) : ''}`;

  if (key !== compactKey) {
    compactKey = key;
    const m = S.media;
    $('cLeft').innerHTML = left === 'game'
      ? `<span class="c-game${gm.poster ? ' has-poster' : ''}" title="${esc(gm.name)}">${gameArtHTML(gm)}</span><span class="c-time c-gtime" id="cGameTime" title="Time played"></span>`
      : left === 'art'
      ? `<div class="c-art-wrap"><div class="c-art" id="cArt" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}">${m.thumb ? '' : icon('music')}</div></div><span class="c-time" id="cTime"></span>`
      : `<span class="c-sky ${night ? 'night' : 'day'}${overcast ? ' overcast' : ''}" title="${night ? 'Night' : 'Day'}${overcast && S.weather.text ? ' · ' + esc(S.weather.text) : ''}">${icon(night ? 'skyMoon' : 'skySun')}</span><span class="c-time" id="cTime"></span>${showDate ? '<span class="c-dsep"></span><span class="c-dt" id="cDt"></span>' : ''}`;
    $('cCenter').innerHTML = center === 'title'
      ? `<div class="c-title-wrap"><span class="c-title" id="cTitle">${esc(m.title)}${m.artist ? ' · ' + esc(m.artist) : ''}</span></div><div class="c-lyric" id="cLyric"></div>`
      : '';
    $('cRight').innerHTML = ind +
      (right === 'timer' ? `<div class="c-timer" id="cTimer"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,159,10,.25)" stroke-width="2.4"/><circle id="cTimerArc" cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="37.7" stroke-dashoffset="0"/></svg><span id="cTimerTxt"></span></div>`
      : right === 'eq' ? `<div class="eq playing live"><i></i><i></i><i></i><i></i></div>`
      : right === 'stats' ? `<div class="c-stats">${st.map(k =>
          k === 'battery' ? battChip(bm)
          : k === 'alerts' ? `<span class="cs bell" title="${unread} unread notification${unread > 1 ? 's' : ''}: click to open"><span class="cs-ic">${icon('bell')}</span><b>${unread > 9 ? '9+' : unread}</b></span>`
          : k === 'weather' ? `<span class="cs wx" title="${esc(S.settings.city || 'Weather')}"><span class="cs-ic">${icon(wx)}</span><b id="csWx">–</b></span>`
          : k === 'net' ? netChip(nm)
          : `<span class="cs ${k}" title="${STAT_CHIP[k][0]}"><span class="cs-ic">${icon(STAT_CHIP[k][1])}</span><b id="cs_${k}">–</b></span>`).join('')}</div>`
      : right === 'none' ? ''
      : `<span class="c-date" id="cDate"></span>`);
    hydrateIcons($('cRight'));
    if (center === 'title') setTimeout(setupMarquee, 650);
    if (typeof refreshPillLyric === 'function') refreshPillLyric(true);
  }
  // live bits
  const now = new Date();
  if ($('cTime')) $('cTime').textContent = fmtClock(now);
  if ($('cDt')) $('cDt').textContent = `${now.toLocaleDateString(undefined, { weekday: 'short' })} ${now.getDate()}`;   // "Fri 13"
  if ($('cBat') && S.batt) {
    const pct = Math.round(S.batt.level * 100);
    $('cBatPct').textContent = pct;
    $('cBatFill').style.width = pct + '%';
  }
  if ($('cDate')) $('cDate').textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  if ($('cTimerTxt')) {
    $('cTimerTxt').textContent = fmtDur(T.remaining);
    $('cTimerArc').setAttribute('stroke-dashoffset', (37.7 * (1 - T.remaining / T.total)).toFixed(2));
    $('cTimer').classList.toggle('paused', !T.running);
  }
  if ($('cBatt') && S.batt) {
    const pct = Math.round(S.batt.level * 100);
    $('cBattPct').textContent = pct + '%';
    const g = $('cBatt');
    g.firstElementChild.style.width = pct + '%';
    g.classList.toggle('charging', S.batt.charging);
    g.classList.toggle('low', !S.batt.charging && pct <= 20);
  }
  if (right === 'stats') {
    if ($('cs_vram') && S.sys && S.sys.vramUsed > 0) {
      const el = $('cs_vram'), pct = S.sys.vramTotal > 0 ? S.sys.vramUsed / S.sys.vramTotal * 100 : 0;
      el.innerHTML = `${(S.sys.vramUsed / 1073741824).toFixed(1)}<small>GB</small>`;
      el.parentElement.classList.toggle('hot', pct >= 85); el.parentElement.classList.toggle('crit', pct >= 90);
    }
    if ($('cGameTime') && S.game) $('cGameTime').textContent = fmtSession(Date.now() - S.game.start);
    for (const k of ['cpu', 'ram', 'gpu']) {
      const el = $('cs_' + k);
      if (el && S.sys && S.sys[k] != null) { el.textContent = S.sys[k] + '%'; el.parentElement.classList.toggle('hot', S.sys[k] >= 85); el.parentElement.classList.toggle('crit', S.sys[k] >= 90); }
    }
    if ($('csNet') && typeof NET !== 'undefined' && NET.cur) {
      const [n, u] = shortRate(NET.cur.rx).split(' ');
      $('csNet').innerHTML = `${n}<small>${u}</small>`;              // the unit can drop under the number in side mode
    }
    if ($('csWx') && S.weather) $('csWx').textContent = S.weather.temp + '°';
    // the pill is as wide as its stats need
    if (!S.side) S.idleW = Math.ceil(28 + 20 + $('cLeft').offsetWidth + $('cRight').offsetWidth + 6);
  } else S.idleW = 0;
  if (S.side) {
    // vertical pill: as tall as its stacked content
    const hasCenter = $('cCenter').childElementCount > 0;
    S.sideLen = Math.ceil(24 + $('cLeft').offsetHeight + (hasCenter ? $('cCenter').offsetHeight + 10 : 0) + ($('cRight').offsetHeight ? $('cRight').offsetHeight + 10 : 0));
  }
  if (typeof renderHeaderStats === 'function') renderHeaderStats();
  if (S.mode === 'collapsed') applySize();
  if (typeof sparkEnsure === 'function') sparkEnsure();
}

function setupMarquee() {
  const t = $('cTitle');
  if (!t) return;
  const wrap = t.parentElement;
  t.classList.remove('scroll');
  wrap.classList.remove('fade');
  const over = t.scrollWidth - wrap.clientWidth;
  if (over > 4) {
    // only long titles scroll; only scrolling titles get the soft edges (so nothing is clipped otherwise)
    t.style.setProperty('--shift', `-${over + 20}px`);
    t.style.setProperty('--dur', `${Math.max(6, (over + 20) / 18)}s`);
    t.classList.add('scroll');
    wrap.classList.add('fade');
  }
}

// ================================================================== media
function appName(id) {
  const s = (id || '').toLowerCase();
  const map = [
    ['spotify', 'Spotify'], ['chrome', 'Chrome'], ['msedge', 'Edge'], ['firefox', 'Firefox'],
    ['308046b0af4a39cb', 'Firefox'], ['brave', 'Brave'], ['opera', 'Opera'], ['vivaldi', 'Vivaldi'],
    ['zunemusic', 'Media Player'], ['zunevideo', 'Movies & TV'], ['vlc', 'VLC'],
    ['applemusic', 'Apple Music'], ['itunes', 'iTunes'], ['amazon', 'Amazon Music'], ['deezer', 'Deezer'],
    ['tidal', 'TIDAL'], ['musicbee', 'MusicBee'], ['foobar', 'foobar2000'], ['aimp', 'AIMP'],
    ['youtube', 'YouTube Music'], ['discord', 'Discord'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'],
  ];
  for (const [k, v] of map) if (s.includes(k)) return v;
  const last = (id || '').split('!').pop().replace(/\.exe$/i, '').split(/[._]/).filter(Boolean).pop();
  return last || 'Media';
}

function mediaPosition() {
  const m = S.media;
  if (!m.active) return 0;
  let p = m.position || 0;
  if (m.status === 'Playing') {
    const base = m.updatedAt > 946684800000 ? m.updatedAt : m.receivedAt;
    p += (Date.now() - base) / 1000;
  }
  return m.duration > 0 ? clamp(p, 0, m.duration) : Math.max(0, p);
}

api.on('media', onMedia);
function onMedia(m) {
  const prev = S.media;
  // the bridge only sends artwork when it changes
  if (m.active && m.thumb === undefined && prev.thumbId === m.thumbId) { m.thumb = prev.thumb; m.artFallback = prev.artFallback; }
  m.receivedAt = Date.now();
  S.media = m;

  const key = m.active && m.title ? `${m.app}|${m.title}|${m.artist}` : '';
  const firstLoad = S.mediaKey === undefined;
  const trackChanged = key && key !== S.mediaKey;
  const resumed = key && key === S.mediaKey && prev.status !== 'Playing' && m.status === 'Playing';
  S.mediaKey = key;
  if (!firstLoad && m.status === 'Playing' && (trackChanged || resumed)) setTimeout(peekTrack, 350);
  if ((trackChanged || (!key && firstLoad === false)) && typeof onTrackChanged === 'function') onTrackChanged();

  // keep looked-up art for the same song even if the player re-sends "no art" (e.g. a forced refresh)
  if (key && !trackChanged && !m.thumb && prev.artFallback) { m.thumb = prev.thumb; m.artFallback = true; }
  if (m.thumb !== prev.thumb) updateAccent(m.thumb);
  renderMediaCard();
  renderCompact();
  if (typeof vizCheck === 'function') vizCheck();
  if (trackChanged || !m.thumb) scheduleArtLookup();
}

// No album art from the player (common for browsers / YouTube)? Give the player a few seconds to
// publish it, then look the song up online (Settings → Live → Find missing album art online).
let artTimer = 0, artKeyAsked = '';
function scheduleArtLookup() {
  const m = S.media;
  if (!m.active || m.thumb || !m.title || !S.settings.onlineArtwork || artKeyAsked === S.mediaKey) return;
  const key = S.mediaKey;
  artKeyAsked = key;
  clearTimeout(artTimer);
  artTimer = setTimeout(async () => {
    if (S.mediaKey !== key || S.media.thumb) return;
    const url = await api.artwork({ title: S.media.title, artist: S.media.artist });
    if (!url || S.mediaKey !== key || S.media.thumb) return;   // asked once per song
    S.media.thumb = url;                  // later bridge updates keep it (same thumbId) until the player sends real art
    S.media.artFallback = true;
    updateAccent(url);
    renderMediaCard();
    compactKey = '';
    renderCompact();
  }, 3500);
}

function renderMediaCard() {
  const m = S.media;
  const card = $('mediaCard');
  const active = m.active && (m.title || m.artist);
  card.classList.toggle('has-art', !!(active && m.thumb));
  card.classList.toggle('active', !!active);
  card.classList.toggle('is-playing', isPlaying());
  $('mcArt').style.backgroundImage = active && m.thumb ? `url('${m.thumb}')` : '';
  $('mcGlow').style.backgroundImage = active && m.thumb ? `url('${m.thumb}')` : '';
  $('mcApp').textContent = active ? (m.appLabel || appName(m.app)) : 'Media';
  $('mcTitle').textContent = active ? (m.title || 'Unknown title') : 'Nothing playing';
  $('mcArtist').textContent = active ? (m.artist || m.album || '') : 'Play something in Spotify, YouTube…';
  $('mcPlay').innerHTML = icon(isPlaying() ? 'pause' : 'play');
  $('mcPrev').disabled = !(active && m.canPrev);
  $('mcNext').disabled = !(active && m.canNext);
  $('mcPlay').disabled = !active;
  $('mcEq').classList.toggle('playing', isPlaying());
  $('mcProgress').classList.toggle('hidden', !(active && m.duration > 0));
  $('mcBar').classList.toggle('noseek', !m.canSeek);
  renderProgress();
  if (typeof renderOverview === 'function') renderOverview();
}

function renderProgress() {
  const m = S.media;
  if (!m.active || !(m.duration > 0)) return;
  const p = mediaPosition();
  $('mcPos').textContent = fmtDur(p);
  $('mcDur').textContent = fmtDur(m.duration);
  $('mcFill').style.width = (100 * p / m.duration).toFixed(2) + '%';
}

$('mcPlay').addEventListener('click', () => {
  // optimistic UI
  if (S.media.active) {
    S.media.position = mediaPosition();
    S.media.updatedAt = Date.now();
    S.media.status = isPlaying() ? 'Paused' : 'Playing';
    renderMediaCard(); renderCompact();
  }
  api.media('toggle');
});
$('mcPrev').addEventListener('click', () => api.media('prev'));
$('mcNext').addEventListener('click', () => api.media('next'));
$('mcBar').addEventListener('click', e => {
  const m = S.media;
  if (!m.active || !m.canSeek || !(m.duration > 0)) return;
  const r = e.currentTarget.getBoundingClientRect();
  const t = clamp((e.clientX - r.left) / r.width, 0, 1) * m.duration;
  S.media.position = t; S.media.updatedAt = Date.now();
  renderProgress();
  api.media('seek', t.toFixed(1));
});

// ---- accent colour from album art
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const DEFAULT_ACCENT = '167, 139, 250';
const ACCENTS = {
  purple: DEFAULT_ACCENT, blue: '10, 132, 255', teal: '64, 200, 224', green: '48, 209, 88',
  orange: '255, 159, 10', pink: '255, 55, 135', red: '255, 69, 58',
};
function hexToRgbStr(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}
function setAccent(rgb) {
  document.documentElement.style.setProperty('--accent', rgb);
  api.reportAccent(rgb);                                        // party mode follows the same colour
  if (typeof applyVizColors === 'function') applyVizColors();   // "Accent" visualizer palette follows it
}
function updateAccent(src) {
  const mode = S.settings.accentMode || 'auto';
  if (mode === 'custom') { setAccent(hexToRgbStr(S.settings.accentCustom) || DEFAULT_ACCENT); return; }
  if (mode !== 'auto') { setAccent(ACCENTS[mode] || DEFAULT_ACCENT); return; }
  if (!src) { setAccent(DEFAULT_ACCENT); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max ? (max - min) / max : 0;
      const wt = sat * sat * (max / 255) + 0.003;
      r += R * wt; g += G * wt; b += B * wt; w += wt;
    }
    let [h, s, l] = rgbToHsl(r / w, g / w, b / w);
    s = s < 0.08 ? s : Math.max(s, 0.6);
    l = clamp(l, 0.58, 0.72);
    const rgb = hslToRgb(h, s, l).map(v => Math.round(v));
    setAccent(rgb.join(', '));
  };
  img.onerror = () => setAccent(DEFAULT_ACCENT);
  img.src = src;
}

// ================================================================== clock + calendar
let calOffset = 0;
let lastDay = -1;
function renderClock(force) {
  const now = new Date();
  $('hdrTime').textContent = fmtClock(now);
  if (S.mode === 'expanded' || force) {
    $('clkTime').innerHTML = fmtClock(now, { seconds: !!S.settings.showSeconds, suffix: true });
    $('clkDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  if (now.getDate() !== lastDay || force) { lastDay = now.getDate(); renderCalendar(); }
}
function renderCalendar() {
  const now = new Date();
  const view = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
  $('calMonth').textContent = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const first = view.getDay();
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="dow">${d}</span>`).join('');
  for (let i = 0; i < first; i++) html += '<span class="other">.</span>';
  for (let d = 1; d <= days; d++) {
    const isToday = calOffset === 0 && d === now.getDate();
    const dow = (first + d - 1) % 7;
    html += `<span class="${isToday ? 'today' : dow === 0 || dow === 6 ? 'wk' : ''}">${d}</span>`;
  }
  $('calGrid').innerHTML = html;
}
$('calPrev').addEventListener('click', () => { calOffset--; renderCalendar(); });
$('calNext').addEventListener('click', () => { calOffset++; renderCalendar(); });

function startClock() {
  const tick = () => {
    renderClock(false);
    renderCompact();
    if (S.mode === 'expanded' && S.tab === 'home' && isPlaying()) renderProgress();
    if (typeof renderOverview === 'function') renderOverview();
  };
  tick();
  // align to the second boundary, then refresh a few times a second for smooth progress
  setTimeout(() => { tick(); setInterval(tick, 500); }, 1000 - (Date.now() % 1000));
}

// ================================================================== weather (Open-Meteo, no key)
const WMO = {
  0: ['Clear sky', '☀️', '🌙'], 1: ['Mainly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Rain showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm & hail', '⛈️'], 99: ['Thunderstorm & hail', '⛈️'],
};
const wmo = (code, day = true) => { const w = WMO[code] || ['—', '🌡️']; return { text: w[0], emoji: !day && w[2] ? w[2] : w[1] }; };

let weatherTimer = 0;
async function fetchWeather() {
  clearTimeout(weatherTimer);
  const { lat, lon, city } = S.settings;
  $('wxCity').textContent = city || 'Set a city';
  if (lat == null || lon == null) { $('wxCond').textContent = 'Set your city in settings'; return; }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5';
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    try { localStorage.setItem('weather', JSON.stringify({ at: Date.now(), city, data })); } catch { /* ignore */ }
    renderWeather(data);
    weatherTimer = setTimeout(fetchWeather, 15 * 60 * 1000);
  } catch (e) {
    $('wxCond').textContent = 'Weather unavailable';
    weatherTimer = setTimeout(fetchWeather, 2 * 60 * 1000);
  }
}
function renderWeather(data) {
  const c = data.current, d = data.daily;
  const w = wmo(c.weather_code, c.is_day === 1);
  S.weather = { temp: Math.round(c.temperature_2m), code: c.weather_code, isDay: c.is_day === 1, text: w.text };   // for the idle pill + overview
  applyWeatherMood();
  if (typeof renderCompact === 'function') renderCompact();
  $('weatherCard').classList.toggle('night', c.is_day !== 1);
  $('wxIcon').innerHTML = icon(wxIcon(c.weather_code, c.is_day === 1));
  $('wxIcon').title = w.text;
  $('wxTemp').textContent = `${Math.round(c.temperature_2m)}°`;
  $('wxCond').textContent = `${w.text} · feels ${Math.round(c.apparent_temperature)}°`;
  $('wxHum').textContent = `${Math.round(c.relative_humidity_2m)}%`;
  $('wxWind').textContent = `${Math.round(c.wind_speed_10m)} km/h`;
  $('wxHL').textContent = `↑${Math.round(d.temperature_2m_max[0])}° ↓${Math.round(d.temperature_2m_min[0])}°`;
  let html = '';
  for (let i = 1; i < Math.min(5, d.time.length); i++) {
    const day = new Date(d.time[i] + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    html += `<div><span class="d">${day}</span><span class="e" title="${esc(wmo(d.weather_code[i]).text)}">${icon(wxIcon(d.weather_code[i], true))}</span>` +
      `<span class="r">${Math.round(d.temperature_2m_max[i])}° <span>${Math.round(d.temperature_2m_min[i])}°</span></span></div>`;
  }
  $('wxDays').innerHTML = html;
}
// self-test / preview: show any weather without waiting for it (nothing is cached; the next fetch replaces it)
function previewWeather(code, isDay = true, temp = 24) {
  const today = new Date();
  const days = Array.from({ length: 5 }, (_, i) => new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10));
  renderWeather({
    current: { temperature_2m: temp, apparent_temperature: temp + 1, relative_humidity_2m: 78, weather_code: code, is_day: isDay ? 1 : 0, wind_speed_10m: 14 },
    daily: { time: days, weather_code: [code, 2, 63, 0, 3], temperature_2m_max: [temp + 3, 29, 25, 31, 27], temperature_2m_min: [temp - 4, 21, 19, 22, 20] },
  });
}
function loadCachedWeather() {
  try {
    const c = JSON.parse(localStorage.getItem('weather') || 'null');
    if (c && c.city === S.settings.city && Date.now() - c.at < 6 * 3600 * 1000) renderWeather(c.data);
  } catch { /* ignore */ }
}

// ================================================================== focus timer / pomodoro
const RING_C = 2 * Math.PI * 52;
$('ringFg').style.strokeDasharray = RING_C.toFixed(2);
const T = { preset: 'focus', total: 25 * 60, remaining: 25 * 60, running: false, endAt: 0 };

function timerActive() { return T.running || (T.remaining > 0 && T.remaining < T.total); }
function sessionsToday() {
  try {
    const s = JSON.parse(localStorage.getItem('sessions') || '{}');
    return s.date === new Date().toDateString() ? s.count : 0;
  } catch { return 0; }
}
function addSession() {
  const n = sessionsToday() + 1;
  try { localStorage.setItem('sessions', JSON.stringify({ date: new Date().toDateString(), count: n })); } catch { /* ignore */ }
}

function tmSet(preset, minutes) {
  T.running = false;
  T.preset = preset;
  const mins = preset === 'focus' ? (S.settings.pomodoroWork || 25) : preset === 'break' ? (S.settings.pomodoroBreak || 5) : minutes;
  T.total = T.remaining = mins * 60;
  renderTimer();
}
function tmStart() {
  if (T.remaining <= 0) T.remaining = T.total;
  T.endAt = Date.now() + T.remaining * 1000;
  T.running = true;
  renderTimer();
}
function tmPause() {
  T.remaining = Math.max(0, (T.endAt - Date.now()) / 1000);
  T.running = false;
  renderTimer();
}
function tmFinish() {
  T.running = false;
  T.remaining = 0;
  chime();
  let title, sub;
  if (T.preset === 'focus') {
    addSession();
    title = 'Focus session complete';
    sub = `Nice work. Take a ${S.settings.pomodoroBreak || 5} minute break.`;
    const held = typeof takeHeldCount === 'function' ? takeHeldCount() : 0;
    if (held) sub = `Nice work! ${held} notification${held > 1 ? 's' : ''} waiting in Alerts.`;
    tmSet('break');
  } else if (T.preset === 'break') {
    title = 'Break is over';
    sub = 'Ready for another focus session?';
    tmSet('focus');
  } else {
    title = "Time's up!";
    sub = `${fmtDur(T.total)} timer finished`;
    T.remaining = T.total;
  }
  renderTimer();
  peek('timer', `
    <div class="pk-icon orange pk-ring-ok">${icon('bell')}</div>
    <div class="pk-text"><div class="pk-title">${esc(title)}</div><div class="pk-sub">${esc(sub)}</div></div>`,
    { width: 400, duration: 6000 });
}
function renderTimer() {
  const card = document.querySelector('.timer-card');
  card.classList.toggle('break', T.preset === 'break');
  $('tmTime').textContent = fmtDur(Math.ceil(T.remaining));
  $('tmLabel').textContent = T.preset === 'focus' ? 'Focus' : T.preset === 'break' ? 'Break' : 'Timer';
  $('ringFg').style.strokeDashoffset = (RING_C * (1 - T.remaining / T.total)).toFixed(2);
  $('tmStart').innerHTML = `${icon(T.running ? 'pause' : 'play')}<span>${T.running ? 'Pause' : T.remaining < T.total && T.remaining > 0 ? 'Resume' : 'Start'}</span>`;
  document.querySelectorAll('#tmPresets .chip').forEach(c => {
    const on = c.dataset.preset ? c.dataset.preset === T.preset : (T.preset === 'custom' && +c.dataset.min * 60 === T.total);
    c.classList.toggle('active', on);
  });
  const n = sessionsToday();
  $('tmSessions').textContent = `${n} focus session${n === 1 ? '' : 's'} today`;
  renderCompact();
  if (typeof renderOverview === 'function') renderOverview();
}
setInterval(() => {
  if (!T.running) return;
  T.remaining = Math.max(0, (T.endAt - Date.now()) / 1000);
  if (T.remaining <= 0) tmFinish();
  else {
    $('tmTime').textContent = fmtDur(Math.ceil(T.remaining));
    $('ringFg').style.strokeDashoffset = (RING_C * (1 - T.remaining / T.total)).toFixed(2);
  }
}, 250);

$('tmStart').addEventListener('click', () => (T.running ? tmPause() : tmStart()));
$('tmReset').addEventListener('click', () => { T.running = false; T.remaining = T.total; renderTimer(); });
$('tmPresets').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  if (c.dataset.preset) tmSet(c.dataset.preset);
  else tmSet('custom', +c.dataset.min);
});
function tmAdjust(deltaMin) {
  const d = deltaMin * 60;
  if (T.total + d < 60) return;
  T.total += d;
  if (T.running) T.endAt = Math.max(Date.now() + 1000, T.endAt + d * 1000);
  T.remaining = clamp(T.remaining + d, 1, T.total);
  if (T.preset !== 'custom' && !T.running) T.preset = 'custom';
  renderTimer();
}
$('tmPlus').addEventListener('click', () => tmAdjust(1));
$('tmMinus').addEventListener('click', () => tmAdjust(-1));

let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const ctx = audioCtx;
    [0, 0.18, 0.36, 1.1, 1.28, 1.46].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = [880, 1108.7, 1318.5][i % 3];
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.65);
    });
  } catch { /* audio unavailable */ }
}

// ================================================================== notes
let notesTimer = 0;
$('notes').addEventListener('input', () => {
  const v = $('notes').value;
  $('notesCount').textContent = v.length ? `${v.length} chars` : '';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => api.setSettings({ notes: v }), 500);
});
$('notes').addEventListener('blur', () => { if (!S.hover) scheduleCollapse(); });

// ================================================================== system stats
api.on('sys', s => { S.sys = s; if (S.mode === 'expanded' && S.tab === 'system') renderSys(); });
function spark(svg, data) {
  if (!data || data.length < 2) return;
  const d = data.slice(-40);
  const pts = d.map((v, i) => `${(i / (d.length - 1) * 100).toFixed(1)},${(30 - (v / 100) * 28 - 1).toFixed(1)}`);
  const first = pts[0].split(',')[0], last = pts[pts.length - 1].split(',')[0];
  svg.innerHTML = `<polygon class="area" points="${first},30 ${pts.join(' ')} ${last},30"/><polyline points="${pts.join(' ')}"/>`;
}
function cpuLabel(name, cores) {
  const n = name.replace(/\((R|TM|tm|r)\)/g, '').replace(/\s+with\s+.*$/i, '').replace(/\bCPU\b/g, '').replace(/@.*$/, '').replace(/\d+(th|st|nd|rd) Gen\s*/i, '').replace(/\s+/g, ' ').trim();
  return `${n} · ${cores} threads`;
}
function gpuLabel(name) {
  return name.replace(/\((R|TM|tm|r)\)/g, '').replace(/^(NVIDIA|AMD|Intel)\s+/i, '').replace(/^GeForce\s+/i, '').replace(/\s+(Laptop|Mobile)\s+GPU$/i, ' Laptop').replace(/\s+/g, ' ').trim();
}
function renderSys() {
  const s = S.sys;
  if (s) {
    $('gpuCard').hidden = s.gpu == null;
    if (s.gpu != null) {
      $('gpuVal').textContent = s.gpu + '%';
      const gb = b => (b / 1073741824).toFixed(1);
      const vram = s.vramTotal > 0 ? `${gb(s.vramUsed)}/${gb(s.vramTotal)} GB` : s.vramUsed > 0 ? `${gb(s.vramUsed)} GB` : '';
      $('gpuSub').textContent = [gpuLabel(s.gpuName || ''), vram].filter(Boolean).join(' · ');
      $('gpuSub').title = s.gpuName || '';
      spark($('gpuSpark'), s.gpuHistory);
    }
    for (const [k, id] of [['cpu', 'cpuVal'], ['ram', 'ramVal'], ['gpu', 'gpuVal']]) {   // big numbers: orange from 85%, red from 90%
      $(id).classList.toggle('hot', s[k] != null && s[k] >= 85);
      $(id).classList.toggle('crit', s[k] != null && s[k] >= 90);
    }
    $('cpuVal').textContent = s.cpu + '%';
    $('ramVal').textContent = s.ram + '%';
    $('cpuName').textContent = cpuLabel(s.cpuName, s.cores);
    $('ramSub').textContent = `${(s.ramUsed / 1073741824).toFixed(1)} of ${(s.ramTotal / 1073741824).toFixed(1)} GB used`;
    $('cpuName').title = `Uptime ${fmtSpan(s.uptime)}`;
    spark($('cpuSpark'), s.cpuHistory);
    spark($('ramSpark'), s.ramHistory);
  }
  renderBattery();
}

// ---- volume
let volDragging = false, ownVolUntil = 0, volSendTimer = 0;
api.on('volume', v => {
  const prev = S.volume;
  S.volume = v;
  renderVolume();
  if (prev && (Math.abs(prev.level - v.level) > 0.004 || prev.muted !== v.muted) && Date.now() > ownVolUntil) peekVolume();
});
function setRangeFill(el) { el.style.setProperty('--p', `${el.value}%`); }
function renderVolume() {
  const v = S.volume;
  if (!v) return;
  const pct = Math.round(v.level * 100);
  if (!volDragging) { $('volSlider').value = v.muted ? 0 : pct; setRangeFill($('volSlider')); }
  $('volVal').textContent = v.muted ? 'Muted' : pct + '%';
  $('muteBtn').innerHTML = icon(v.muted || pct === 0 ? 'mute' : pct < 50 ? 'volumeLow' : 'volume');
  // Home → music card's small volume slider
  if (!volDragging) { $('mcVol').value = v.muted ? 0 : pct; setRangeFill($('mcVol')); }
  $('mcVolVal').textContent = v.muted ? 'Muted' : pct + '%';
  $('mcMute').innerHTML = icon(v.muted || pct === 0 ? 'mute' : pct < 50 ? 'volumeLow' : 'volume');
  $('mcMute').title = v.muted ? 'Unmute' : 'Mute';
  if (typeof renderOverview === 'function') renderOverview();
}
$('volSlider').addEventListener('input', e => {
  volDragging = true;
  setRangeFill(e.target);
  $('volVal').textContent = e.target.value + '%';
  ownVolUntil = Date.now() + 1200;
  clearTimeout(volSendTimer);
  volSendTimer = setTimeout(() => api.setVolume(e.target.value / 100), 40);
});
$('volSlider').addEventListener('change', () => { volDragging = false; });
$('muteBtn').addEventListener('click', () => { ownVolUntil = Date.now() + 1200; api.toggleMute(); });
// the same, right in the music card on Home (no trip to the System tab)
$('mcVol').addEventListener('input', e => {
  volDragging = true;
  setRangeFill(e.target);
  $('mcVolVal').textContent = e.target.value + '%';
  ownVolUntil = Date.now() + 1200;                  // no volume pop-up for our own change
  clearTimeout(volSendTimer);
  volSendTimer = setTimeout(() => api.setVolume(e.target.value / 100), 40);
});
$('mcVol').addEventListener('change', () => { volDragging = false; });
$('mcMute').addEventListener('click', () => { ownVolUntil = Date.now() + 1200; api.toggleMute(); });
// scroll over the slider row: 2% a notch
$('mcVolRow').addEventListener('wheel', e => {
  if (!S.volume || !e.deltaY) return;
  e.preventDefault();
  const cur = S.volume.muted ? 0 : Math.round(S.volume.level * 100);
  const nv = clamp(cur + (e.deltaY < 0 ? 2 : -2), 0, 100);
  ownVolUntil = Date.now() + 1200;
  S.volume = { ...S.volume, level: nv / 100, muted: false };
  renderVolume();
  api.setVolume(nv / 100);
}, { passive: false });

// Scroll on the collapsed notch to change volume
let lastWheelAt = -1000, lastSwipeAt = -1000, swipeAcc = 0, swipeReset = 0;
function holdOpen() { S.suppressExpand = true; clearTimeout(enterTimer); }
function wheelVolume(e) {
  if (!S.volume) return;
  e.preventDefault();
  // sideways swipe (touchpad / tilt wheel) = skip track
  if (S.settings.gestures && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    holdOpen();
    swipeAcc += e.deltaX;
    clearTimeout(swipeReset);
    swipeReset = setTimeout(() => { swipeAcc = 0; }, 260);
    if (Math.abs(swipeAcc) > 60 && e.timeStamp - lastSwipeAt > 700 && S.media.active) {
      lastSwipeAt = e.timeStamp;
      const next = swipeAcc > 0;
      swipeAcc = 0;
      api.media(next ? 'next' : 'prev');
      peek('gesture', `<div class="pk-icon accent">${icon(next ? 'next' : 'prev')}</div><div class="pk-text"><div class="pk-title">${next ? 'Next track' : 'Previous track'}</div></div>`, { width: 260, duration: 900 });
    }
    return;
  }
  // Chromium can deliver a single notch twice; ~1 step per 70ms still feels fast
  if (e.timeStamp - lastWheelAt < 70) return;
  lastWheelAt = e.timeStamp;
  // scrolling means "adjust volume", so don't pop the full panel open under the cursor
  S.suppressExpand = true;
  clearTimeout(enterTimer);
  const step = e.deltaY < 0 ? 0.02 : -0.02;
  const level = clamp(Math.round((S.volume.level + step) * 50) / 50, 0, 1);
  S.volume = { ...S.volume, level, muted: false };
  ownVolUntil = Date.now() + 1200;
  api.setVolume(level);
  renderVolume();
  peekVolume();
}
layers.collapsed.addEventListener('wheel', wheelVolume, { passive: false });
layers.peek.addEventListener('wheel', wheelVolume, { passive: false });
// Click = open (slightly delayed so a double-click can win), double-click = play/pause, middle-click = mute
let pillClickTimer = 0;
const isControl = e => e.target.closest('button, a, input, [draggable="true"]');
// Press and slide to move the notch: on the pill, on a pop-up, or on the open panel's top bar.
// The main process follows the cursor (along the top for Notch, anywhere for Island, across screens).
let dragInfo = null, swallowClick = false;
function makeDraggable(el) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || isControl(e)) return;
    dragInfo = { x: e.screenX, y: e.screenY, id: e.pointerId, on: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!dragInfo || dragInfo.on) return;
    if (Math.hypot(e.screenX - dragInfo.x, e.screenY - dragInfo.y) > 6) {
      dragInfo.on = true;
      clearTimeout(pillClickTimer);
      holdOpen();
      island.classList.add('dragging');
      api.dragStart();
    }
  });
  const endDrag = () => {
    if (!dragInfo) return;
    if (dragInfo.on) { api.dragEnd(); swallowClick = true; setTimeout(() => { swallowClick = false; }, 300); }
    island.classList.remove('dragging');
    dragInfo = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('lostpointercapture', endDrag);
}
makeDraggable(document.querySelector('#expanded .hdr'));
for (const layer of [layers.collapsed, layers.peek]) {
  makeDraggable(layer);
  layer.addEventListener('mousedown', e => { if (!isControl(e)) holdOpen(); });
  layer.addEventListener('click', e => {
    if (isControl(e) || swallowClick) return;
    clearTimeout(pillClickTimer);
    const tab = e.target.closest('.cs.bell') ? 'alerts' : undefined;     // the bell opens Alerts
    pillClickTimer = setTimeout(() => expand(tab), S.settings.gestures ? 230 : 0);
  });
  layer.addEventListener('dblclick', e => {
    if (!S.settings.gestures || isControl(e) || !S.media.active) return;
    clearTimeout(pillClickTimer);
    const wasPlaying = isPlaying();
    api.media('toggle');
    peek('gesture', `<div class="pk-icon accent">${icon(wasPlaying ? 'pause' : 'play')}</div><div class="pk-text"><div class="pk-title">${wasPlaying ? 'Paused' : 'Playing'}</div><div class="pk-sub">${esc(S.media.title || '')}</div></div>`, { width: 320, duration: 1100 });
  });
  layer.addEventListener('auxclick', e => {
    if (e.button !== 1 || !S.settings.gestures) return;
    e.preventDefault();
    holdOpen();
    ownVolUntil = 0;           // let the volume pop-up show the new mute state
    api.toggleMute();
  });
}

// ---- brightness
let brtDragging = false, brtSendTimer = 0;
api.on('brightness', b => {
  S.brightness = b;
  $('brightRow').classList.toggle('disabled', !b.supported);
  if (!b.supported) { $('brtVal').textContent = 'N/A'; return; }
  if (!brtDragging) { $('brtSlider').value = b.level; setRangeFill($('brtSlider')); }
  $('brtVal').textContent = b.level + '%';
  renderCompact();
  if (typeof renderOverview === 'function') renderOverview();
});
$('brtSlider').addEventListener('input', e => {
  brtDragging = true;
  setRangeFill(e.target);
  $('brtVal').textContent = e.target.value + '%';
  clearTimeout(brtSendTimer);
  brtSendTimer = setTimeout(() => api.setBrightness(+e.target.value), 80);
});
$('brtSlider').addEventListener('change', () => { setTimeout(() => { brtDragging = false; }, 400); });

// ---- battery
function hasBattery() {
  const b = S.batt;
  if (!b) return false;
  const looksDesktop = b.charging && b.level === 1 && b.chargingTime === 0 && !(S.brightness && S.brightness.supported);
  return !looksDesktop;
}
let warnedLow = false;
async function initBattery() {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    S.batt = b;
    b.addEventListener('levelchange', () => onBattery(false));
    b.addEventListener('chargingchange', () => onBattery(true));
    b.addEventListener('chargingtimechange', () => renderBattery());
    b.addEventListener('dischargingtimechange', () => renderBattery());
    onBattery(false);
  } catch { /* no battery API */ }
}
function onBattery(chargeChanged) {
  const b = S.batt;
  const pct = Math.round(b.level * 100);
  renderBattery();
  renderCompact();
  if (chargeChanged && hasBattery()) {
    peek('battery', b.charging
      ? `<div class="pk-icon green">${icon('bolt')}</div><div class="pk-text"><div class="pk-title">Charging</div><div class="pk-sub">${pct}% · ${battSub(b)}</div></div><div class="pk-val" style="color:var(--green)">${pct}%</div>`
      : `<div class="pk-icon">${icon('plug')}</div><div class="pk-text"><div class="pk-title">On battery</div><div class="pk-sub">${S.game ? 'Plug in for full gaming performance' : battSub(b)}</div></div><div class="pk-val">${pct}%</div>`,
      { width: 340, duration: 2800 });
  }
  if (!b.charging && pct <= 20 && !warnedLow && hasBattery()) {
    warnedLow = true;
    peek('battery-low', `<div class="pk-icon" style="color:var(--red);background:rgba(255,69,58,.18)">${icon('plug')}</div><div class="pk-text"><div class="pk-title">Battery low</div><div class="pk-sub">${pct}% remaining · plug in soon</div></div>`, { width: 340, duration: 4000 });
  }
  if (b.charging || pct > 25) warnedLow = false;
}
function battSub(b) {
  if (b.charging) {
    if (b.level >= 1) return 'Fully charged';
    return Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? `Full in ${fmtSpan(b.chargingTime)}` : 'Charging';
  }
  return Number.isFinite(b.dischargingTime) ? `${fmtSpan(b.dischargingTime)} left` : 'On battery';
}
function renderBattery() {
  const b = S.batt;
  if (!b || !hasBattery()) {
    $('battPct').textContent = 'AC';
    $('battSub').textContent = 'Plugged in';
    $('battFill').style.width = '100%';
    $('battIcon').classList.add('charging');
    return;
  }
  const pct = Math.round(b.level * 100);
  $('battPct').textContent = pct + '%';
  $('battSub').textContent = battSub(b);
  $('battFill').style.width = pct + '%';
  $('battIcon').classList.toggle('charging', b.charging);
  $('battIcon').classList.toggle('low', !b.charging && pct <= 20);
}

// ================================================================== shelf (files)
const iconCache = new Map();
async function fileIcon(p) {
  if (!iconCache.has(p)) iconCache.set(p, api.fileIcon(p));
  return iconCache.get(p);
}
function baseName(p) { return p.split(/[\\/]/).filter(Boolean).pop() || p; }
function saveShelf() { api.setSettings({ shelf: S.shelf }); }
function renderShelf() {
  const grid = $('shelfGrid');
  grid.innerHTML = '';
  $('shelfZone').classList.toggle('empty', S.shelf.length === 0);
  $('shelfBadge').textContent = S.shelf.length || '';
  for (const p of S.shelf) grid.appendChild(shelfItemEl(p));
  if (typeof renderOverview === 'function') renderOverview();
}
function shelfItemEl(p) {
  const el = document.createElement('div');
  el.className = 'shelf-item';
  el.draggable = true;
  el.title = `${p}\nDouble-click to open · drag out to use`;
  el.innerHTML = `<img alt=""><span>${esc(baseName(p))}</span><button class="rm" title="Remove">${icon('x')}</button>`;
  fileIcon(p).then(src => { if (src) el.querySelector('img').src = src; });
  el.addEventListener('dragstart', e => { e.preventDefault(); api.startDrag(p); });
  el.addEventListener('dblclick', () => api.openPath(p));
  el.addEventListener('contextmenu', e => { e.preventDefault(); api.showInFolder(p); });
  el.querySelector('.rm').addEventListener('click', e => {
    e.stopPropagation();
    S.shelf = S.shelf.filter(x => x !== p);
    saveShelf(); renderShelf();
  });
  return el;
}
async function loadShelf() {
  const list = Array.isArray(S.settings.shelf) ? S.settings.shelf : [];
  const exists = await Promise.all(list.map(p => api.fileExists(p)));
  S.shelf = list.filter((_, i) => exists[i]);
  if (S.shelf.length !== list.length) saveShelf();
  renderShelf();
}
$('shelfClear').addEventListener('click', () => { S.shelf = []; saveShelf(); renderShelf(); });

// Drag & drop: files go to the Shelf; on the Apps tab files and links become shortcuts.
// In the Stacked overview the section under the cursor decides (Apps, else Shelf).
const dragTypes = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []);
const hasFiles = e => dragTypes(e).includes('Files');
const hasLink = e => dragTypes(e).includes('text/uri-list');
let dragLeaveTimer = 0;
function dropTab(e) {
  if (S.tab !== 'overview') return S.tab;
  if (!hasFiles(e)) return 'apps';
  return e.target && e.target.closest && e.target.closest('#ovApps') ? 'apps' : 'shelf';
}
function markDrop(e) {
  const t = dropTab(e), ov = S.tab === 'overview';
  $('shelfZone').classList.toggle('drag-over', !ov && t === 'shelf');
  $('appsCard').classList.toggle('drag-over', !ov && t === 'apps');
  $('ovShelf').classList.toggle('drag-over', ov && t === 'shelf');
  $('ovApps').classList.toggle('drag-over', ov && t === 'apps');
}
document.addEventListener('dragenter', e => {
  if (!hasFiles(e) && !hasLink(e)) return;
  e.preventDefault();
  clearTimeout(dragLeaveTimer);
  S.dragActive = true;
  const wanted = !hasFiles(e) ? 'apps' : (S.tab === 'apps' ? 'apps' : 'shelf');
  if (isStacked() && (S.mode !== 'expanded' || S.tab === 'overview')) { if (S.mode !== 'expanded') expand(); }
  else if (S.mode !== 'expanded') expand(wanted);
  else if (S.tab !== 'shelf' && S.tab !== 'apps') setTab(wanted);
  markDrop(e);
});
document.addEventListener('dragover', e => {
  if (!hasFiles(e) && !hasLink(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = dropTab(e) === 'apps' ? 'link' : 'copy';
  clearTimeout(dragLeaveTimer);
  markDrop(e);
});
document.addEventListener('dragleave', () => {
  clearTimeout(dragLeaveTimer);
  dragLeaveTimer = setTimeout(endDrag, 120);
});
function endDrag() {
  S.dragActive = false;
  for (const id of ['shelfZone', 'appsCard', 'ovShelf', 'ovApps']) $(id).classList.remove('drag-over');
  if (!S.hover) scheduleCollapse(600);
}
document.addEventListener('drop', e => {
  e.preventDefault();
  clearTimeout(dragLeaveTimer);
  const paths = Array.from(e.dataTransfer.files || []).map(f => api.pathForFile(f)).filter(Boolean);
  const target = dropTab(e);
  if (target === 'apps') {
    const links = paths.length ? [] : (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
    addShortcutsFromDrop([...paths, ...links]);
  } else if (target === 'shelf' || paths.length) {
    let added = 0;
    for (const p of paths) if (!S.shelf.includes(p)) { S.shelf.push(p); added++; }
    if (added) { saveShelf(); renderShelf(); }
  }
  endDrag();
});

// ================================================================== clipboard history
api.on('clipboard', list => { S.clipboard = list; renderClipboard(); });
function renderClipboard() {
  if (typeof renderOverview === 'function') renderOverview();
  const box = $('clipList');
  if (!S.settings.clipboardHistory) { box.innerHTML = '<div class="clip-empty">Clipboard history is off (Settings)</div>'; return; }
  if (!S.clipboard.length) { box.innerHTML = '<div class="clip-empty">Copied text will show up here</div>'; return; }
  box.innerHTML = '';
  S.clipboard.forEach(t => {
    const b = document.createElement('button');
    b.className = 'clip-item';
    b.textContent = t.trim().slice(0, 300);
    b.title = t.length > 300 ? t.slice(0, 600) + '…' : t;
    b.addEventListener('click', () => {
      api.copyText(t);
      b.textContent = '✓ Copied';
      setTimeout(() => renderClipboard(), 700);
    });
    box.appendChild(b);
  });
}
$('clipClear').addEventListener('click', () => api.clearClipboard());

// ================================================================== settings
function applySettingsUI() {
  const s = S.settings;
  document.querySelectorAll('[data-setting]').forEach(el => { el.checked = !!s[el.dataset.setting]; });
  if (document.activeElement !== $('setCity')) $('setCity').value = s.city || '';
  $('setWork').value = s.pomodoroWork || 25;
  $('setBreak').value = s.pomodoroBreak || 5;
  if (document.activeElement !== $('notes')) $('notes').value = s.notes || '';
  $('notesCount').textContent = (s.notes || '').length ? `${s.notes.length} chars` : '';
  document.documentElement.dataset.layout = isStacked() ? 'stacked' : 'tabs';
  if (!isStacked() && S.tab === 'overview') setTab('home');
  if (S.mode === 'expanded') applySize();
  applySideFade();
  compactKey = '';
  renderClock(true);
  renderCompact();
  renderClipboard();
  updateAccent(S.media.thumb);
  if (typeof applyExtrasUI === 'function') applyExtrasUI();
}
document.querySelectorAll('[data-setting]').forEach(el => {
  el.addEventListener('change', async () => {
    S.settings = await api.setSettings({ [el.dataset.setting]: el.checked });
    applySettingsUI();
  });
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
    S.settings = await api.setSettings({ city: g.name, lat: g.latitude, lon: g.longitude });
    $('setCity').value = g.name;
    $('cityHint').textContent = `✓ ${[g.name, g.admin1, g.country].filter(Boolean).join(', ')}`;
    fetchWeather();
  } catch {
    $('cityHint').textContent = 'Network error, try again';
  }
}
$('setCitySave').addEventListener('click', saveCity);
$('setCity').addEventListener('keydown', e => { if (e.key === 'Enter') saveCity(); });
async function savePomodoro() {
  const work = clamp(parseInt($('setWork').value, 10) || 25, 1, 180);
  const brk = clamp(parseInt($('setBreak').value, 10) || 5, 1, 60);
  S.settings = await api.setSettings({ pomodoroWork: work, pomodoroBreak: brk });
  if (!T.running && (T.preset === 'focus' || T.preset === 'break') && T.remaining === T.total) tmSet(T.preset);
}
$('setWork').addEventListener('change', savePomodoro);
$('setBreak').addEventListener('change', savePomodoro);
$('quitBtn').addEventListener('click', () => api.quit());

// focus the window when the user clicks into a text field (window is shown inactive)
document.addEventListener('mousedown', e => {
  if (e.target.closest('input, textarea')) api.focus();
});

