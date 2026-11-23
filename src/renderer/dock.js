'use strict';
/* NotchMine Dock (Settings → Taskbar). Draws one of the styles from the state main.js sends ('dock-state'):
   - dockeq: Dock + music: now playing bottom-left, the dock in the middle, status bottom-right, an equalizer behind
   - dock:   the floating dock; now playing and status bottom-right (the same equalizer only if Bottom equalizer is on)
   - bar:    a full-width bar along the bottom edge
   The dock rests small (Start + running apps) and opens up on hover (search, task view, every pinned app) while the
   corner pills shrink. Clicking works like the Windows taskbar; Start / search / quick settings open Windows' own. */

const api = window.notch;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let st = null, wide = false, wideT = 0, overDock = false;
const SV = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  task: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="11" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9.5" y="10" width="11" height="9" rx="2" fill="rgba(0,0,0,.5)" stroke="currentColor" stroke-width="1.8"/></svg>',
  // Start: three tiles and a glowing dot, which spread apart on hover (dock.css)
  start: '<svg viewBox="0 0 24 24"><rect class="s1" x="3" y="3" width="8" height="8" rx="2.4"/><rect class="s2" x="13" y="3" width="8" height="8" rx="2.4"/><rect class="s3" x="3" y="13" width="8" height="8" rx="2.4"/><circle class="s4" cx="17" cy="17" r="4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#000"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="#000"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5v14l9-7zM16 5h3v14h-3z" fill="#fff"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 5v14l-9-7zM5 5h3v14H5z" fill="#fff"/></svg>',
};
const batt = (lvl, chg) => `<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="17" height="10" rx="2.5" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="4.5" y="9" width="${Math.max(1, 13 * lvl).toFixed(1)}" height="6" rx="1" fill="${chg ? '#34d399' : lvl <= .2 ? '#ff453a' : '#fff'}"/><rect x="20" y="10" width="2" height="4" rx="1" fill="#fff"/></svg>`;

// ---- battery (this window's own reading)
let bat = null;
(async () => { try { const b = await navigator.getBattery(); const u = () => { bat = { level: b.level, charging: b.charging }; renderStatus(); }; b.addEventListener('levelchange', u); b.addEventListener('chargingchange', u); u(); } catch { /* desktop PC */ } })();

// ================================================================ rendering
const size = () => ({ s: .85, m: 1, l: 1.15 }[st.size] || 1);
function iconHTML(a, extraCls = '') {
  const run = a.windows.length;
  const tipTitle = a.windows.slice(0, 3).map(w => w.title).join('\n');
  return `<button class="ico hit${a.active ? ' active' : ''}${extraCls}" data-key="${esc(a.key)}" data-name="${esc(a.name)}" data-tip="${esc(tipTitle)}" aria-label="${esc(a.name)}">` +
    (a.icon ? `<img src="${a.icon}" alt="">` : `<span class="gen">${esc((a.name || '?')[0])}</span>`) +
    (run ? `<span class="dots">${'<i></i>'.repeat(Math.min(3, run))}</span>` : '') + '</button>';
}
function statusHTML() {
  const c = st.conn || {}, v = st.volume;
  const net = c.kind === 'none' || c.online === false ? icon('wifiOff') : c.kind === 'eth' ? icon('ethernet') : icon('wifi');
  const vol = (!v ? icon('volume') : v.muted || v.level === 0 ? icon('mute') : v.level < .5 ? icon('volumeLow') : icon('volume')).replace('<svg', '<svg class="opt"');
  const b = bat ? batt(bat.level, bat.charging) + `<span class="pct">${Math.round(bat.level * 100)}%</span>` : '';
  return net + vol + b;          // while the dock is open only Wi-Fi and the battery stay
}
function renderStatus() {
  if (!st) return;
  document.querySelectorAll('.chin').forEach(c => { c.innerHTML = statusHTML(); });
}
let lastSig = '';
function render() {
  if (!st) return;
  if (pressing) { renderLater = true; return; }
  const root = document.documentElement;
  root.style.setProperty('--accent', st.accent || '167, 139, 250');
  root.style.setProperty('--wx', wxColor(st.wx));
  root.style.setProperty('--s', size());
  const isBar = st.style === 'bar', music = st.style === 'dockeq' || st.style === 'dock';
  $('zones').hidden = isBar; $('bar').hidden = !isBar;
  $('eq').classList.toggle('on', music && st.eq && !!(st.media && st.media.playing));
  const barLive = isBar && st.eq && !!(st.media && st.media.playing);
  $('barEq').classList.toggle('on', barLive);
  $('bar').classList.toggle('eq-live', barLive);
  // now playing: its own corner on the left with Dock + music, next to the status pills on the right with the floating dock
  const npHost = st.style === 'dock' ? $('rightZone') : $('zones');
  if ($('np').parentElement !== npHost) {
    if (npHost === $('rightZone')) npHost.insertBefore($('np'), $('rzStatus'));
    else npHost.insertBefore($('np'), $('dock'));
  }
  $('np').classList.toggle('in-right', npHost === $('rightZone'));
  const sig = JSON.stringify([st.style, st.size, st.hover, st.np, st.apps.map(a => [a.key, a.active, a.windows.length, !!a.icon, a.windows.map(w => w.title).join('|')]), st.media, st.conn, st.volume]);
  if (sig === lastSig) return;
  lastSig = sig;
  rectsSoon();                                                      // the dock may have changed size
  const running = st.apps.filter(a => a.windows.length);
  const restIcons = st.apps.map(a => iconHTML(a, a.windows.length ? '' : ' extra')).join('');
  const m = st.media;
  if (isBar) {
    $('barL').innerHTML = `<button class="start-orb hit" data-act="start" aria-label="Start">${SV.start}</button><button class="search hit" data-act="search">${SV.search}Search</button>`;
    $('barM').innerHTML = st.apps.map(a => iconHTML(a)).join('');
    $('barR').innerHTML = (m ? `<button class="nowmini hit${m.playing ? '' : ' paused'}" data-act="np-toggle" title="${esc(m.title)}${m.artist ? ' · ' + esc(m.artist) : ''}"><span class="eqmini"><i></i><i></i><i></i><i></i></span><b>${esc(m.title)}</b></button>` : '') +
      `<button class="trayb hit" data-act="tray" title="Show the Windows tray icons for a moment">${SV.up}</button><button class="chin hit" data-act="quick" title="Wi-Fi, sound, battery">${statusHTML()}</button><button class="clock hit" data-act="notif" id="clk"></button>`;
    tickClock();
  } else {
    const always = !st.hover;
    $('dock').className = `dock pill hit${wide && !always ? ' wide' : ''}${always ? ' always' : ''}`;
    $('dock').innerHTML = `<button class="start-orb hit" data-act="start" aria-label="Start">${SV.start}</button>` +
      `<button class="search hit extra" data-act="search">${SV.search}Search</button>` +
      `<button class="ico tool hit extra" data-act="taskview" data-name="Task view">${SV.task}</button><span class="sep${running.length || always || wide ? '' : ' extra'}"></span>` + restIcons;
    const showNp = music && st.np && m;
    $('np').hidden = !showNp;
    if (showNp) {
      $('np').className = `np pill hit${m.playing ? '' : ' paused'}${wide && !always ? ' mini' : ''}${st.style === 'dock' ? ' in-right' : ''}`;
      $('np').innerHTML = `<span class="art" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}"></span><span class="meta"><b>${esc(m.title)}</b><span>${esc(m.artist || '')}</span></span>` +
        `<span class="eqmini"><i></i><i></i><i></i><i></i></span>` +
        `<button class="ctl side" data-act="np-prev" aria-label="Previous">${SV.prev}</button><button class="ctl play" data-act="np-toggle" aria-label="${m.playing ? 'Pause' : 'Play'}">${m.playing ? SV.pause : SV.play}</button><button class="ctl side" data-act="np-next" aria-label="Next">${SV.next}</button>`;
    }
    $('rzStatus').innerHTML = `<button class="trayb pill hit" data-act="tray" title="Show the Windows tray icons for a moment">${SV.up}</button><button class="chin pill hit${wide && !always ? ' mini' : ''}" data-act="quick" title="Wi-Fi, sound, battery">${statusHTML()}</button>`;
  }
  renderStatus();
}
function wxColor(w) {
  if (!w) return '30, 120, 255';
  const c = w.code, day = w.isDay !== false;
  if (c >= 95) return '110, 80, 240';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return '200, 225, 255';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return '30, 120, 255';
  if (c <= 2) return day ? '255, 170, 50' : '94, 92, 230';
  return '150, 165, 195';
}
function tickClock() {
  const el = $('clk'); if (!el) return;
  const d = new Date();
  el.innerHTML = `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}<small>${d.toLocaleDateString()}</small>`;
}
setInterval(tickClock, 15000);

// ---- opening up on hover: the dock grows, the corner pills shrink
function setWide(v) {
  if (!st || !st.hover || wide === v) return;
  wide = v;
  rectsSoon();
  $('dock').classList.toggle('wide', v);
  $('np').classList.toggle('mini', v);
  document.querySelectorAll('.zones .chin').forEach(c => c.classList.toggle('mini', v));
}

// ================================================================ the mouse
// The window is click-through except over the dock, the pills and the window list. main.js polls the cursor against
// the boxes sent from here and flips click-through itself (see 'dock-rects' there): sent whenever they may have moved.
const PAD = 6;
let rectsSig = '', rectsUntil = 0, rectsRaf = 0;
function hitRects() {
  const out = [];
  const add = (el, top = PAD) => {
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push([Math.floor(r.left - PAD), Math.floor(r.top - top), Math.ceil(r.width + 2 * PAD), Math.ceil(r.height + top + PAD)]);
  };
  if (!st) return out;
  if (st.style === 'bar') add($('bar'), 20);                          // + the neon edge's glow above it
  else {
    add($('dock'), 18);                                               // + room for the icon that grows on hover
    add($('np'));
    document.querySelectorAll('#rzStatus .hit').forEach(el => add(el));
  }
  if ($('wlist').classList.contains('show')) add($('wlist'));
  return out;
}
function sendRects() {
  const r = hitRects(), sig = JSON.stringify(r);
  if (sig !== rectsSig) { rectsSig = sig; api.dockRects(r); }
}
// something changed size: keep the boxes up to date until its transition is over
function rectsSoon(ms = 650) {
  rectsUntil = Math.max(rectsUntil, performance.now() + ms);
  if (rectsRaf) return;
  const step = () => { sendRects(); rectsRaf = performance.now() < rectsUntil ? requestAnimationFrame(step) : 0; };
  rectsRaf = requestAnimationFrame(step);
}
setInterval(sendRects, 1000);                                         // safety net (images loading, fonts…)
addEventListener('resize', () => rectsSoon());

// main.js says when the cursor leaves the dock's boxes: the same as a mouseleave, but one that can be trusted
// (Chromium sends a fake one whenever click-through flips, and none at all if mouse forwarding has stopped)
let ptrOver = false, awayT = 0;
api.on('dock-over', on => {
  ptrOver = on;
  clearTimeout(awayT);
  if (on) return;
  awayT = setTimeout(() => {
    if (ptrOver) return;
    $('tip').classList.remove('show'); hideList();
    if (overDock) { overDock = false; clearTimeout(wideT); wideT = setTimeout(() => { if (!overDock) setWide(false); }, 450); }
  }, 150);
});

document.addEventListener('mousemove', e => {
  const inDock = !!e.target.closest('#dock');
  if (inDock !== overDock) {
    overDock = inDock;
    clearTimeout(wideT);
    if (inDock) setWide(true); else wideT = setTimeout(() => { if (!overDock) setWide(false); }, 450);
  }
  // over an app: its open windows as a list to pick from (like the Windows taskbar's hover), else just its name
  const ic = e.target.closest('.ico[data-key]'), inList = !!e.target.closest('#wlist'), tip = $('tip');
  const a = ic && st ? st.apps.find(x => x.key === ic.dataset.key) : null;
  if (a && a.windows.length) { tip.classList.remove('show'); showList(a, ic); }
  else if (!inList) {
    if (towardList(e.clientX, e.clientY)) hideListSoon(); else hideList();   // off the icon: gone at once
    const named = e.target.closest('[data-name]');
    if (named) {
      const r = named.getBoundingClientRect();
      tip.innerHTML = `<b>${esc(named.dataset.name)}</b>`;
      tip.style.left = Math.max(80, Math.min(innerWidth - 80, r.left + r.width / 2)) + 'px';
      tip.style.bottom = (innerHeight - r.top + 12) + 'px';
      tip.classList.add('show');
    } else tip.classList.remove('show');
  } else { clearTimeout(listT); listT = 0; }
});
let listKey = '', listT = 0, listIcR = null;
function showList(a, ic) {
  clearTimeout(listT); listT = 0;
  const el = $('wlist');
  const sig = a.key + JSON.stringify(a.windows) + st.fg;
  if (listKey !== sig) {
    listKey = sig;
    el.innerHTML = `<div class="wh">${esc(a.name)} · ${a.windows.length} window${a.windows.length > 1 ? 's' : ''}</div>` +
      a.windows.map(w => `<button class="wr${w.hwnd === st.fg && !w.min ? ' cur' : ''}" data-hwnd="${esc(w.hwnd)}">${a.icon ? `<img src="${a.icon}" alt="">` : ''}<span>${esc(w.title || a.name)}</span>${w.min ? '<em>minimized</em>' : ''}<i class="wx" data-close="${esc(w.hwnd)}" title="Close window">✕</i></button>`).join('');
  }
  const r = listIcR = ic.getBoundingClientRect();
  el.style.left = Math.max(180, Math.min(innerWidth - 180, r.left + r.width / 2)) + 'px';
  el.style.bottom = (innerHeight - r.top + 14) + 'px';
  const shown = el.classList.contains('show');
  el.classList.add('show');
  if (!shown || el.dataset.at !== el.style.left) { el.dataset.at = el.style.left; rectsSoon(300); }
}
function hideList() {
  clearTimeout(listT); listT = 0;
  const el = $('wlist');
  if (!el.classList.contains('show')) return;
  el.classList.remove('show'); listKey = ''; listIcR = null;
  rectsSoon(300);
}
// a short grace only while crossing the gap from the icon up to its list; it isn't restarted by every mousemove
// (that kept the list up for as long as the mouse kept moving)
function hideListSoon() { if (!listT) listT = setTimeout(hideList, 250); }
function towardList(x, y) {
  const el = $('wlist');
  if (!listIcR || !el.classList.contains('show')) return false;
  const l = el.getBoundingClientRect();
  return x >= Math.min(l.left, listIcR.left) - 6 && x <= Math.max(l.right, listIcR.right) + 6 && y >= l.bottom - 2 && y <= listIcR.top + 4;
}
// While a button is held the dock isn't redrawn: a new state (a window title changing, the song, the volume…)
// replaced the icon between mousedown and mouseup, and a click whose button was swapped out from under it is lost.
let pressing = false, pressT = 0, renderLater = false;
function pressEnd() {
  if (!pressing) return;
  pressing = false; clearTimeout(pressT);
  if (renderLater) { renderLater = false; setTimeout(render, 0); }   // after the click has gone through
}
['pointerdown','mousedown','mouseup','click','auxclick'].forEach(t => document.addEventListener(t, e => console.warn('DIAG', t, e.button, e.target && (e.target.dataset.key || e.target.className)), true));   // TEMP DIAG
document.addEventListener('mousedown', () => { pressing = true; clearTimeout(pressT); pressT = setTimeout(pressEnd, 1500); }, true);
addEventListener('mouseup', pressEnd);
addEventListener('blur', pressEnd);
document.addEventListener('contextmenu', pressEnd, true);
// Windows can swallow the press on this window (it never takes focus) and pass on only the release: after the dock
// had been hidden for a full-screen app, every left click came through as a lone mouseup, so no 'click' event at all
// (right-click kept working: its menu opens on the release). A release over the dock with no press before it is
// taken as the click. A normal click has its press, so it isn't counted twice.
let leftDown = false;
document.addEventListener('mousedown', e => { if (e.button === 0) leftDown = true; }, true);
document.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  const lone = !leftDown;
  leftDown = false;
  if (lone && ptrOver) dockAct(e.target);
}, true);
document.addEventListener('click', e => dockAct(e.target));
function dockAct(target) {
  if (!target || !target.closest) return;
  const cl = target.closest('[data-close]');
  if (cl) { api.dockCmd({ cmd: 'win', act: 'close', hwnd: cl.dataset.close }); return; }
  const wr = target.closest('.wr[data-hwnd]');
  if (wr) { api.dockCmd({ cmd: 'win', act: 'activate', hwnd: wr.dataset.hwnd }); $('wlist').classList.remove('show'); listKey = ''; return; }
  const ic = target.closest('.ico[data-key]');
  if (ic) {
    const a = st && st.apps.find(x => x.key === ic.dataset.key);
    if (a && !a.windows.length) { ic.classList.add('launch'); setTimeout(() => ic.classList.remove('launch'), 1500); }
    api.dockCmd({ cmd: 'app', key: ic.dataset.key });
    return;
  }
  const b = target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'start' || act === 'search' || act === 'taskview' || act === 'quick' || act === 'notif') api.dockCmd({ cmd: 'key', what: act });
  else if (act === 'tray') api.dockCmd({ cmd: 'tray' });
  else if (act === 'np-toggle') api.dockCmd({ cmd: 'media', what: 'toggle' });
  else if (act === 'np-next') api.dockCmd({ cmd: 'media', what: 'next' });
  else if (act === 'np-prev') api.dockCmd({ cmd: 'media', what: 'prev' });
}
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  const ic = e.target.closest('.ico[data-key]');
  if (ic) api.dockCmd({ cmd: 'menu', key: ic.dataset.key });
});

// ================================================================ equalizer behind the dock (Dock + music)
const AU = { an: null, data: null, peak: .5, starting: false };
// the sound comes from the notch's one capture (audiofeed.js), never a capture of our own
function startAudio() {
  if (!AU.an) Object.assign(AU, { an: AUDIO_FEED.an, ac: AUDIO_FEED.ctx, data: new Uint8Array(AUDIO_FEED.an.frequencyBinCount) });
}
const cv = $('eq'), cx = cv.getContext('2d');
const N = 96, lv = new Float32Array(N);
let eqRaf = 0, eqLast = 0;
function eqFrame(t) {
  eqRaf = requestAnimationFrame(eqFrame);
  if (t - eqLast < 32) return;
  eqLast = t;
  const on = cv.classList.contains('on');
  const d = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, w, h);
  if (!on) { if (lv.every(x => x < .01)) { cancelAnimationFrame(eqRaf); eqRaf = 0; } lv.fill(0); return; }
  if (AU.an) AU.an.getByteFrequencyData(AU.data);
  const hz = AU.an ? AU.ac.sampleRate / AU.an.fftSize : 1;
  const bw = w / N, acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '167, 139, 250';
  for (let i = 0; i < N; i++) {
    const k = Math.abs(i - (N - 1) / 2) / (N / 2);                       // bass in the middle, highs to the sides
    let target = 0;
    if (AU.an) {
      const f0 = 45 * Math.pow(220, k), f1 = 45 * Math.pow(220, Math.min(1, k + 2 / N));
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < AU.data.length; b++) m = Math.max(m, AU.data[b]);
      target = Math.max(0, Math.min(1, (m / 255 - .25) / .6));
    }
    lv[i] += (target - lv[i]) * (target > lv[i] ? .45 : .1);
    const hh = lv[i] * h;
    if (hh < 1) continue;
    const g = cx.createLinearGradient(0, h - hh, 0, h);
    g.addColorStop(0, 'rgba(64,200,224,.6)'); g.addColorStop(.6, `rgba(${acc},.35)`); g.addColorStop(1, `rgba(${acc},.06)`);
    cx.fillStyle = g; cx.fillRect(i * bw + bw * .22, h - hh, bw * .56, hh);
    cx.fillStyle = 'rgba(220,235,255,.7)'; cx.fillRect(i * bw + bw * .22, h - hh - 2, bw * .56, 1.5);
  }
}
function eqEnsure() {
  if (cv.classList.contains('on')) { startAudio(); if (!eqRaf) eqRaf = requestAnimationFrame(eqFrame); }
  if (bcv.classList.contains('on')) { startAudio(); if (!barRaf) barRaf = requestAnimationFrame(barFrame); }
}

// ================================================================ the full-width bar's neon edge (Full-width bar)
// At rest it's the thin accent → weather-colour line (CSS). While music plays the line stays a flat line, but its
// light moves along it with the music: the yellow / blue meeting point sways left and right (bass pushes the accent
// colour out, highs pull the weather colour in), every beat sends two bright flashes racing out from the middle,
// and the line glows brighter where that part of the sound is loud (bass in the middle, highs at the ends).
const bcv = $('barEq'), bcx = bcv.getContext('2d');
const BN = 320, blv = new Float32Array(BN);
const BL = { shift: 0, avg: .2, lastBeat: 0, pulses: [], alive: 0 };
let barRaf = 0, barLast = 0;
const cssRgb = name => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? v : [167, 139, 250];
};
// loudness (0..1) of a frequency range
function bandLevel(lo, hi) {
  if (!AU.an) return 0;
  const hz = AU.ac.sampleRate / AU.an.fftSize;
  let s = 0, n = 0;
  for (let b = Math.max(1, Math.floor(lo / hz)); b <= Math.ceil(hi / hz) && b < AU.data.length; b++) { s += AU.data[b]; n++; }
  return n ? s / n / 255 : 0;
}
function barFrame(t) {
  barRaf = requestAnimationFrame(barFrame);
  if (t - barLast < 32) return;                                         // ≤ 30 fps
  barLast = t;
  const on = bcv.classList.contains('on');
  const d = Math.min(2, devicePixelRatio || 1), w = bcv.clientWidth, h = bcv.clientHeight;
  if (!w || !h) return;
  if (bcv.width !== Math.round(w * d) || bcv.height !== Math.round(h * d)) { bcv.width = Math.round(w * d); bcv.height = Math.round(h * d); }
  bcx.setTransform(d, 0, 0, d, 0, 0);
  bcx.clearRect(0, 0, w, h);
  if (!on && blv.every(x => x < .01) && !BL.pulses.length) { cancelAnimationFrame(barRaf); barRaf = 0; BL.shift = 0; return; }

  // ---- listen
  if (AU.an) AU.an.getByteFrequencyData(AU.data);
  const hz = AU.an ? AU.ac.sampleRate / AU.an.fftSize : 1;
  let bass, high;
  if (AU.an) { bass = bandLevel(40, 160); high = bandLevel(2500, 9000); }
  else { bass = .45 + .35 * Math.max(0, Math.sin(t / 240)) ** 6; high = .3 + .1 * Math.sin(t / 700); }   // no system audio: a made-up beat
  if (!on) { bass = 0; high = 0; }
  for (let i = 0; i < BN; i++) {                                         // how bright each part of the line is
    let target = 0;
    if (on && AU.an) {
      const k = Math.abs(i - (BN - 1) / 2) / (BN / 2);                   // bass in the middle, highs to the ends
      const f0 = 45 * Math.pow(220, k), f1 = 45 * Math.pow(220, Math.min(1, k + 2 / BN));
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < AU.data.length; b++) m = Math.max(m, AU.data[b]);
      target = Math.max(0, Math.min(1, (m / 255 - .25) / .6));
    } else if (on) target = .25 + .15 * Math.sin(t / 400 + i * .05);
    blv[i] += (target - blv[i]) * (target > blv[i] ? .5 : .12);
  }
  // the colours' meeting point sways: bass pushes the accent colour right, highs push the weather colour left,
  // and every beat kicks it hard to one side, then the other (it springs back between beats)
  BL.avg += (bass - BL.avg) * .05;
  const beat = on && bass > BL.avg * 1.18 && bass > .2 && t - BL.lastBeat > 180;
  if (beat) {
    BL.lastBeat = t;
    const a = Math.min(1, .6 + (bass - BL.avg) * 4);
    BL.side = -(BL.side || 1);                                           // alternate left / right
    BL.kick = BL.side * (.22 + .2 * a);
    BL.pulses.push({ x: .5 + BL.shift, dir: -1, a: a * 1.4 }, { x: .5 + BL.shift, dir: 1, a: a * 1.4 });
  }
  BL.kick = (BL.kick || 0) * .93;                                        // springs back to the middle between beats
  BL.hiAvg = (BL.hiAvg ?? high) + (high - (BL.hiAvg ?? high)) * .05;   // highs against their own recent level, so it centres
  const sway = Math.max(-.42, Math.min(.42, BL.kick - (high - BL.hiAvg) * 1.5));
  BL.shift += (sway - BL.shift) * .3;
  for (const p of BL.pulses) { p.x += p.dir * .03; p.a *= .965; }
  BL.pulses = BL.pulses.filter(p => p.a > .04 && p.x > -.08 && p.x < 1.08);

  // ---- draw: one flat line along the bar's top edge, plus its glow (each a single smooth gradient left → right)
  const A = cssRgb('--accent'), B = cssRgb('--wx'), y = h - 2;
  const gLine = bcx.createLinearGradient(0, 0, w, 0), gGlow = bcx.createLinearGradient(0, 0, w, 0), gHalo = bcx.createLinearGradient(0, 0, w, 0);
  const STEP = 4;                                                        // a colour stop every 4 points is plenty
  for (let i = 0; i < BN; i += STEP) {
    const f = i / (BN - 1);
    const fade = Math.max(0, Math.min(1, f / .07, (1 - f) / .07));     // fades out at both ends, like the resting line
    const cpos = Math.max(0, Math.min(1, (f - .5 - BL.shift) * 6 + .5));      // yellow | short blend | blue; the blend sways
    const rgb = [0, 1, 2].map(j => A[j] + (B[j] - A[j]) * cpos);
    let flash = 0;
    for (const p of BL.pulses) flash += p.a * Math.exp(-(((f - p.x) / .045) ** 2));
    const b = (.25 + 1.0 * blv[i] + flash) * fade;                         // brightness; past 1 it turns white-hot
    const hot = Math.min(.6, Math.max(0, (b - 1.4) * .8));              // only the core of a beat flash turns white-ish
    const c = rgb.map(x => Math.round(x + (255 - x) * hot)).join(',');
    gLine.addColorStop(f, `rgba(${c},${Math.min(1, b).toFixed(3)})`);
    gGlow.addColorStop(f, `rgba(${c},${Math.min(.85, b * .55).toFixed(3)})`);
    gHalo.addColorStop(f, `rgba(${c},${Math.min(.4, b * .25).toFixed(3)})`);
  }
  bcx.fillStyle = gHalo; bcx.fillRect(0, y - 7, w, 14);                 // a soft halo hugging the line
  bcx.fillStyle = gGlow; bcx.fillRect(0, y - 3, w, 6);
  bcx.fillStyle = gLine; bcx.fillRect(0, y - 1.25, w, 2.5);              // the line itself
}

// ================================================================ state from main
function apply(s) {
  st = s;
  if (!st.hover) wide = false;
  render();
  eqEnsure();
}
api.on('dock-state', apply);
(async () => { apply(await api.dockInit()); })();
window.__dock = { state: () => st, wide: () => wide };
