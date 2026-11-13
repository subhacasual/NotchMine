'use strict';
/* NotchMine v3 live activities: camera/mic dots, meeting mode, synced lyrics, per-app mixer,
   device pop-ups, screenshot catcher, download tracker, phone drop, focus quiet mode. */

const LIVE = {
  cam: [], mic: [], micMuted: false, micPresent: false, micReady: false,
  lyrics: null, lyricKey: '', lyricIdx: -1, showLyrics: false,
  recent: [], mixerOpen: false, mixerDrag: null, mixerTimer: 0,
  phone: { running: false }, held: 0,
};

// ================================================================== indicators in the pill / header
function indicatorsHTML() {
  let h = '';
  if (S.settings.privacyDots) {
    if (LIVE.cam.length) h += `<span class="pdot cam" title="Camera: ${esc(LIVE.cam.join(', '))}"></span>`;
    if (LIVE.mic.length) h += `<span class="pdot mic" title="Microphone: ${esc(LIVE.mic.join(', '))}"></span>`;
  }
  if (LIVE.phone.running) h += `<span class="c-ind-ic phone" title="Phone drop is on"><i data-icon="phone"></i></span>`;
  if (LIVE.micMuted && LIVE.micPresent) h += `<span class="c-ind-ic micoff" title="Microphone muted (Ctrl+Alt+M)"><i data-icon="micOff"></i></span>`;
  return h ? `<span class="c-ind">${h}</span>` : '';
}
function indicatorWidth() {
  let w = 0;
  if (S.settings.privacyDots) w += (LIVE.cam.length ? 11 : 0) + (LIVE.mic.length ? 11 : 0);
  if (LIVE.phone.running) w += 20;
  if (LIVE.micMuted && LIVE.micPresent) w += 22;
  return w ? w + 8 : 0;
}
function renderHeaderInd() {
  const parts = [];
  if (S.settings.privacyDots && LIVE.cam.length) parts.push(`<span class="hi cam"><i></i>Camera · ${esc(LIVE.cam[0])}</span>`);
  if (S.settings.privacyDots && LIVE.mic.length) parts.push(`<span class="hi mic"><i></i>Mic · ${esc(LIVE.mic[0])}</span>`);
  if (LIVE.micMuted && LIVE.micPresent) parts.push(`<span class="hi muted">${icon('micOff')}Muted</span>`);
  $('hdrInd').innerHTML = parts.join('');
}
function refreshIndicators() { renderCompact(); renderHeaderInd(); }

api.on('privacy', p => {
  const prevCam = LIVE.cam, prevMic = LIVE.mic;
  LIVE.cam = p.cam || [];
  LIVE.mic = p.mic || [];
  refreshIndicators();
  if (!S.settings.privacyDots) return;
  const cam = LIVE.cam.filter(n => !prevCam.includes(n));
  const mic = LIVE.mic.filter(n => !prevMic.includes(n));
  if (cam.length) {
    peek('privacy', `<div class="pk-icon green">${icon('camera')}</div><div class="pk-text"><div class="pk-title">Camera is on</div><div class="pk-sub">${esc(cam.join(', '))}</div></div><span class="pdot cam big"></span>`, { width: 340, duration: 2800 });
  } else if (mic.length) {
    peek('privacy', `<div class="pk-icon orange">${icon('mic')}</div><div class="pk-text"><div class="pk-title">Microphone is on</div><div class="pk-sub">${esc(mic.join(', '))}</div></div><span class="pdot mic big"></span>`, { width: 340, duration: 2800 });
  }
});

// ================================================================== meeting mode (mic mute)
function renderMicPill() {
  const b = $('micPill');
  b.classList.toggle('muted', LIVE.micMuted);
  b.disabled = !LIVE.micPresent;
  b.innerHTML = `${icon(LIVE.micMuted ? 'micOff' : 'mic')}<span>${!LIVE.micPresent ? 'No mic' : LIVE.micMuted ? 'Mic muted' : 'Mic on'}</span>`;
}
api.on('mic', m => {
  const was = LIVE.micMuted;
  LIVE.micMuted = !!m.muted;
  LIVE.micPresent = !!m.present;
  renderMicPill();
  refreshIndicators();
  if (LIVE.micReady && was !== LIVE.micMuted && LIVE.micPresent) {
    peek('mic', LIVE.micMuted
      ? `<div class="pk-icon" style="color:var(--red);background:rgba(255,69,58,.18)">${icon('micOff')}</div><div class="pk-text"><div class="pk-title">Microphone muted</div><div class="pk-sub">Ctrl + Alt + M to unmute</div></div>`
      : `<div class="pk-icon green">${icon('mic')}</div><div class="pk-text"><div class="pk-title">Microphone on</div><div class="pk-sub">You're live</div></div>`,
      { width: 300, duration: 1800 });
  }
  LIVE.micReady = true;
});
$('micPill').addEventListener('click', () => api.micToggle());

// ================================================================== synced lyrics
async function onTrackChanged() {
  const key = S.mediaKey || '';
  if (key === LIVE.lyricKey) return;
  LIVE.lyricKey = key;
  LIVE.lyrics = null;
  LIVE.lyricIdx = -1;
  renderLyrics();
  refreshPillLyric(true);
  if (!key || !S.settings.lyrics) return;
  const m = S.media;
  const res = await api.lyrics({ title: m.title, artist: m.artist, album: m.album, duration: m.duration });
  if (LIVE.lyricKey !== key) return;          // song changed while we were fetching
  LIVE.lyrics = res || { none: true };
  LIVE.lyricIdx = -1;
  renderLyrics();
}

function lyricIndexAt(t) {
  const L = LIVE.lyrics && LIVE.lyrics.synced;
  if (!L) return -1;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

function pillLyricText() {
  if (!S.settings.lyrics || !S.settings.lyricsInPill || !isPlaying()) return '';
  const L = LIVE.lyrics && LIVE.lyrics.synced;
  if (!L || LIVE.lyricIdx < 0) return '';
  return L[LIVE.lyricIdx].text || '♪';
}
const PILL_MAX = 640;   // widest the pill may grow for a lyric line
function lyricPillWidth() { return LIVE.pillLyricW || 0; }

function refreshPillLyric(force) {
  const el = $('cLyric'), center = $('cCenter');
  if (!el) { if (LIVE.pillLyricW) { LIVE.pillLyricW = 0; if (S.mode === 'collapsed') applySize(); } return; }
  const txt = pillLyricText();
  center.classList.toggle('lyric-on', !!txt);
  if (force || txt !== el.dataset.txt) {
    el.dataset.txt = txt;
    el.innerHTML = txt ? `<span class="c-lyric-txt">${esc(txt)}</span>` : '';
    el.classList.remove('in', 'long'); void el.offsetWidth; el.classList.add('in');
    requestAnimationFrame(sizePillForLyric);
  }
}

// Grow the pill to fit the whole line; if it still doesn't fit at max width, scroll it once.
function sizePillForLyric() {
  const el = $('cLyric');
  const inner = el && el.firstElementChild;
  if (!inner) {
    if (LIVE.pillLyricW) { LIVE.pillLyricW = 0; if (S.mode === 'collapsed') applySize(); }
    return;
  }
  const textW = inner.scrollWidth;
  // pill = side padding (28) + slot gaps (20) + left slot + right slot + text
  const need = Math.ceil(28 + 20 + $('cLeft').offsetWidth + $('cRight').offsetWidth + textW + 8);
  LIVE.pillLyricW = Math.min(PILL_MAX, need);
  if (S.mode === 'collapsed') applySize();
  if (need > PILL_MAX) {
    const over = need - PILL_MAX + 14;
    el.classList.add('long');
    inner.style.setProperty('--shift', `-${over}px`);
    inner.style.setProperty('--dur', `${Math.max(1.2, over / 45).toFixed(2)}s`);
    inner.classList.add('scroll');
  }
}

function renderLyrics() {
  const card = $('mediaCard');
  const btn = $('mcLyrBtn');
  const has = !!(LIVE.lyrics && (LIVE.lyrics.synced || LIVE.lyrics.plain));
  btn.classList.toggle('on', LIVE.showLyrics);
  btn.classList.toggle('has', has);
  btn.style.display = S.settings.lyrics ? '' : 'none';
  card.classList.toggle('show-lyrics', LIVE.showLyrics && !!S.settings.lyrics);
  const box = $('mcLyrics');
  if (!LIVE.showLyrics) return;
  if (!S.media.active) { box.innerHTML = '<div class="ly-msg">Play a song to see its lyrics</div>'; return; }
  if (!LIVE.lyrics) { box.innerHTML = '<div class="ly-msg">Looking for lyrics…</div>'; return; }
  if (LIVE.lyrics.none) { box.innerHTML = '<div class="ly-msg">No lyrics found for this song</div>'; return; }
  if (LIVE.lyrics.synced) {
    box.innerHTML = LIVE.lyrics.synced.map((l, i) => `<p class="ly" data-i="${i}" data-t="${l.t}">${esc(l.text) || '♪'}</p>`).join('');
    LIVE.lyricIdx = -2;               // force highlight
    tickLyrics();
  } else {
    box.innerHTML = `<div class="ly-plain">${esc(LIVE.lyrics.plain).replace(/\n/g, '<br>')}</div>`;
  }
}
function highlightLyric() {
  const box = $('mcLyrics');
  const cur = box.querySelector('.ly.cur');
  if (cur) cur.classList.remove('cur');
  const el = box.querySelector(`.ly[data-i="${LIVE.lyricIdx}"]`);
  if (!el) return;
  el.classList.add('cur');
  box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
}
function tickLyrics() {
  if (!LIVE.lyrics || !LIVE.lyrics.synced) return;
  const i = lyricIndexAt(mediaPosition() + 0.3);
  if (i === LIVE.lyricIdx) return;
  LIVE.lyricIdx = i;
  refreshPillLyric();
  if (LIVE.showLyrics && S.mode === 'expanded') highlightLyric();
}
setInterval(tickLyrics, 200);

$('mcLyrBtn').addEventListener('click', () => {
  LIVE.showLyrics = !LIVE.showLyrics;
  renderLyrics();
});
$('mcLyrics').addEventListener('click', e => {
  const p = e.target.closest('.ly');
  if (!p || !S.media.canSeek) return;
  const t = Number(p.dataset.t);
  S.media.position = t; S.media.updatedAt = Date.now();
  api.media('seek', t.toFixed(1));
});

// ================================================================== per-app volume mixer
function openMixer(open) {
  LIVE.mixerOpen = open;
  $('controlsCard').classList.toggle('mixer-open', open);
  clearInterval(LIVE.mixerTimer);
  if (open) {
    api.mixerGet();
    LIVE.mixerTimer = setInterval(() => {
      if (!(S.mode === 'expanded' && S.tab === 'system')) return;
      if (!LIVE.mixerDrag) api.mixerGet();
    }, 1500);
  }
}
$('mixerBtn').addEventListener('click', () => openMixer(true));
$('mixerClose').addEventListener('click', () => openMixer(false));

let mixerSendT = 0;
api.on('mixer', apps => {
  if (!LIVE.mixerOpen) return;
  const list = $('mixerList');
  if (!apps.length) { list.innerHTML = '<div class="clip-empty">No apps are playing sound right now</div>'; return; }
  // don't rebuild under the user's finger
  if (LIVE.mixerDrag) return;
  apps.sort((a, b) => (a.system - b.system) || (b.active - a.active) || a.name.localeCompare(b.name));
  list.innerHTML = apps.map(a => {
    const v = Math.round(a.volume * 100);
    const ico = a.icon ? `<img src="${esc(a.icon)}" alt="">`
      : a.system ? icon('volume') : `<span class="app-letter" style="background:${avatarColor(a.name)}">${esc(a.name.charAt(0).toUpperCase())}</span>`;
    return `<div class="mx-row${a.active ? ' active' : ''}" data-pid="${a.pid}">
      <span class="mx-ic">${ico}</span>
      <div class="mx-body"><div class="mx-name"><span>${esc(a.name)}</span><b>${a.muted ? 'Muted' : v + '%'}</b></div>
      <input type="range" min="0" max="100" value="${a.muted ? 0 : v}" style="--p:${a.muted ? 0 : v}%"></div>
      <button class="mx-mute${a.muted ? ' on' : ''}" title="Mute">${icon(a.muted ? 'mute' : 'volume')}</button>
    </div>`;
  }).join('');
});
$('mixerList').addEventListener('input', e => {
  if (e.target.type !== 'range') return;
  const row = e.target.closest('.mx-row');
  LIVE.mixerDrag = row.dataset.pid;
  e.target.style.setProperty('--p', e.target.value + '%');
  row.querySelector('.mx-name b').textContent = e.target.value + '%';
  clearTimeout(mixerSendT);
  mixerSendT = setTimeout(() => api.mixerSet(row.dataset.pid, e.target.value / 100), 40);
});
$('mixerList').addEventListener('change', () => { setTimeout(() => { LIVE.mixerDrag = null; }, 300); });
$('mixerList').addEventListener('click', e => {
  const b = e.target.closest('.mx-mute');
  if (b) api.mixerMute(b.closest('.mx-row').dataset.pid);
});

// ================================================================== device pop-ups
api.on('audio-device', d => {
  if (d.initial || !S.settings.devicePopups || !d.name) return;
  const hp = /head|ear|buds|airpods|wh-|wf-|bluetooth|hands-?free|bose|jbl|sony/i.test(d.name);
  peek('device', `<div class="pk-icon accent">${icon(hp ? 'headphones' : 'volume')}</div><div class="pk-text"><div class="pk-title">${hp ? 'Headphones connected' : 'Sound output changed'}</div><div class="pk-sub">${esc(d.name)}</div></div>`, { width: 390, duration: 3000 });
});
api.on('lockkey', k => {
  if (!S.settings.devicePopups) return;
  peek('lockkey', `<div class="pk-key${k.on ? ' on' : ''}">${k.key === 'Caps Lock' ? 'A' : '1'}</div><div class="pk-text"><div class="pk-title">${esc(k.key)} ${k.on ? 'on' : 'off'}</div></div>`, { width: 240, duration: 1300 });
});
function fmtSize(b) {
  if (!b) return '';
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}
api.on('drive', d => {
  if (!S.settings.devicePopups) return;
  if (d.added) {
    peek('usb', `<div class="pk-icon accent">${icon('usb')}</div>
      <div class="pk-text"><div class="pk-title">USB drive connected</div><div class="pk-sub">${esc(d.letter)} ${esc(d.label || 'Removable disk')} · ${fmtSize(d.free)} free</div></div>
      <button class="pk-btn" data-act="open" data-path="${esc(d.letter)}\\">Open</button>`, { width: 420, duration: 6000, interactive: true });
  } else {
    peek('usb', `<div class="pk-icon">${icon('usb')}</div><div class="pk-text"><div class="pk-title">USB drive removed</div><div class="pk-sub">${esc(d.letter)} ${esc(d.label || '')}</div></div>`, { width: 320, duration: 2200 });
  }
});

// ================================================================== screenshots + downloads ("Recent")
function timeAgoShort(ms) { return typeof timeAgo === 'function' ? timeAgo(ms) : ''; }
function addRecent(it) {
  LIVE.recent = [it, ...LIVE.recent.filter(r => r.path !== it.path)].slice(0, 16);
  renderRecent();
}
function renderRecent() {
  const box = $('recentList');
  if (!LIVE.recent.length) {
    box.innerHTML = '<div class="clip-empty">Screenshots and finished downloads<br>will show up here</div>';
    return;
  }
  box.innerHTML = LIVE.recent.map(r => {
    const cap = r.kind === 'capture';
    const vis = cap ? `<img class="rc-thumb" src="${esc(r.thumb)}" alt="">`
      : `<span class="rc-file">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : icon('download')}</span>`;
    const sub = cap ? `Screenshot · ${r.w}×${r.h}` : `Download · ${fmtSize(r.size)}`;
    const acts = cap
      ? `<button class="mini-btn" data-act="ocr" title="Copy text in image">${icon('text')}</button><button class="mini-btn" data-act="save" title="Save to Pictures">${icon('save')}</button>`
      : `<button class="mini-btn" data-act="folder" title="Show in folder">${icon('folder')}</button>`;
    return `<div class="rc-item" draggable="true" data-path="${esc(r.path)}" title="Drag into any app · click to open">
      ${vis}<div class="rc-body"><div class="rc-name">${esc(r.name)}</div><div class="rc-sub">${sub} · ${timeAgoShort(r.time)}</div></div>
      <div class="rc-acts">${acts}<button class="mini-btn" data-act="remove" title="Remove from list">${icon('x')}</button></div></div>`;
  }).join('');
}
async function runAction(act, p, btn) {
  switch (act) {
    case 'ocr': {
      if (btn) btn.classList.add('busy');
      const text = await api.ocr(p);
      if (btn) btn.classList.remove('busy');
      peek('ocr', `<div class="pk-icon accent">${icon('text')}</div><div class="pk-text"><div class="pk-title">${text ? 'Text copied' : 'No text found'}</div><div class="pk-sub">${text ? esc(text.replace(/\s+/g, ' ').slice(0, 80)) : 'Try a sharper screenshot'}</div></div>`, { width: 400, duration: 2600 });
      return text;
    }
    case 'save': { const d = await api.captureSave(p); if (btn) btn.classList.add('done'); return d; }
    case 'copyimg': api.captureCopy(p); return;
    case 'open': api.openPath(p); return;
    case 'folder': api.showInFolder(p); return;
    case 'remove':
      LIVE.recent = LIVE.recent.filter(r => r.path !== p);
      api.recentRemove(p);
      renderRecent();
      return;
  }
}
$('recentList').addEventListener('click', e => {
  const item = e.target.closest('.rc-item');
  if (!item) return;
  const b = e.target.closest('[data-act]');
  if (b) { e.stopPropagation(); runAction(b.dataset.act, item.dataset.path, b); return; }
  api.openPath(item.dataset.path);
});
$('recentList').addEventListener('dragstart', e => {
  const item = e.target.closest('.rc-item');
  if (!item) return;
  e.preventDefault();
  api.startDrag(item.dataset.path);
});

api.on('capture', it => {
  addRecent(it);
  if (!S.settings.catchScreenshots) return;
  peek('capture', `
    <img class="pk-shot" src="${esc(it.thumb)}" draggable="true" data-drag="${esc(it.path)}" alt="" title="Drag into any app">
    <div class="pk-text">
      <div class="pk-title">Screenshot captured</div>
      <div class="pk-sub">${it.w}×${it.h} · drag the picture into any app</div>
      <div class="pk-actions">
        <button class="pk-btn" data-act="ocr" data-path="${esc(it.path)}">${icon('text')}Copy text</button>
        <button class="pk-btn" data-act="save" data-path="${esc(it.path)}">${icon('save')}Save</button>
      </div>
    </div>`, { width: 440, height: 100, duration: 6500, interactive: true });
});
api.on('download', it => {
  addRecent(it);
  if (!S.settings.trackDownloads) return;
  peek('download', `
    <span class="pk-file" draggable="true" data-drag="${esc(it.path)}" title="Drag into any app">${it.icon ? `<img src="${esc(it.icon)}" alt="">` : icon('download')}</span>
    <div class="pk-text"><div class="pk-title">Download finished</div><div class="pk-sub">${esc(it.name)} · ${fmtSize(it.size)}</div></div>
    <button class="pk-btn" data-act="open" data-path="${esc(it.path)}">Open</button>
    <button class="pk-btn ghost" data-act="folder" data-path="${esc(it.path)}">${icon('folder')}</button>`,
    { width: 450, duration: 6000, interactive: true });
});

// buttons + dragging inside pop-ups
layers.peek.addEventListener('click', async e => {
  const b = e.target.closest('.pk-btn');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'ocr') b.innerHTML = 'Reading…';
  await runAction(act, b.dataset.path, b);
  if (act === 'save') { b.innerHTML = `${icon('check')}Saved`; extendPeek(2200); }
  if (act === 'open' || act === 'folder') setMode('collapsed');
});
layers.peek.addEventListener('dragstart', e => {
  const d = e.target.closest('[data-drag]');
  if (!d) return;
  e.preventDefault();
  api.startDrag(d.dataset.drag);
});

// ================================================================== phone → PC drop
function showPhonePanel(show, warn = false) {
  $('phonePanel').classList.toggle('open', show);
  $('phonePanel').classList.toggle('warn', show && warn);
}
function applyPhone(st) {
  LIVE.phone = st || { running: false };
  $('phoneBtn').classList.toggle('live', !!LIVE.phone.running);
  const rc = LIVE.phone.receiving;
  $('phoneRecv').classList.toggle('on', !!(LIVE.phone.running && rc));
  if (LIVE.phone.running && rc) {
    const pct = rc.total ? Math.min(100, Math.round(rc.bytes / rc.total * 100)) : 0;
    $('prName').textContent = `Receiving ${rc.name}`;
    $('prPct').textContent = rc.total ? pct + '%' : '';
    $('prBar').style.width = pct + '%';
    $('prSub').textContent = `${fmtSize(rc.bytes)}${rc.total ? ' of ' + fmtSize(rc.total) : ''}${rc.speed ? ' · ' + fmtSize(rc.speed) + '/s' : ''}`;
  }
  if (LIVE.phone.running) {
    $('phoneQr').src = LIVE.phone.qr;
    $('phoneQr').title = LIVE.phone.url;
    $('phoneNet').textContent = LIVE.phone.network ? `same network (${LIVE.phone.network})` : 'same Wi-Fi';
    $('phoneStatus').textContent = (LIVE.phone.received
      ? `✓ ${LIVE.phone.received} file${LIVE.phone.received > 1 ? 's' : ''} received`
      : 'Waiting for your phone…') + (LIVE.phone.pc ? ` · this PC shows as “${LIVE.phone.pc}”` : '');
  } else if (LIVE.phone.error) {
    $('phoneStatus').textContent = LIVE.phone.error;
  } else {
    showPhonePanel(false);
  }
  refreshIndicators();
}
$('phoneBtn').addEventListener('click', () => {
  if (LIVE.phone.running) { showPhonePanel(true); return; }
  if (!S.settings.phoneWarned) { $('phoneWarnSkip').checked = false; showPhonePanel(true, true); return; }
  startPhone();
});
$('phoneWarnCancel').addEventListener('click', () => showPhonePanel(false));
$('phoneWarnOk').addEventListener('click', () => {
  if ($('phoneWarnSkip').checked) patchSettings({ phoneWarned: true });
  startPhone();
});
async function startPhone() {
  showPhonePanel(true);
  $('phoneStatus').textContent = 'Starting…';
  $('phoneQr').removeAttribute('src');
  S.modal = true;                      // Windows may show a firewall prompt; keep the panel open
  try { applyPhone(await api.phoneStart()); } finally { S.modal = false; }
}
$('phoneStop').addEventListener('click', async () => { applyPhone(await api.phoneStop()); showPhonePanel(false); });
api.on('phone-status', applyPhone);
api.on('phone-file', p => {
  if (!S.shelf.includes(p)) { S.shelf.push(p); saveShelf(); renderShelf(); }
  peek('phone', `<span class="pk-file" draggable="true" data-drag="${esc(p)}">${icon('phone')}</span>
    <div class="pk-text"><div class="pk-title">Received from phone</div><div class="pk-sub">${esc(baseName(p))} · added to Shelf</div></div>
    <button class="pk-btn" data-act="open" data-path="${esc(p)}">Open</button>`, { width: 420, duration: 4500, interactive: true });
});

// ================================================================== focus quiet mode
function focusQuiet() { return !!S.settings.focusSilence && T.running && T.preset === 'focus'; }
$('tmSilence').addEventListener('click', () => patchSettings({ focusSilence: !S.settings.focusSilence }));
function takeHeldCount() { const n = LIVE.held; LIVE.held = 0; return n; }

// ================================================================== settings + boot hooks
function applyLiveUI() {
  $('tmSilence').classList.toggle('active', !!S.settings.focusSilence);
  renderLyrics();
  refreshPillLyric(true);
  renderHeaderInd();
  if (!S.settings.lyrics) { LIVE.showLyrics = false; }
}
function liveInit(init) {
  LIVE.recent = (init.recent || []).slice();
  renderRecent();
  if (init.state.privacy) { LIVE.cam = init.state.privacy.cam || []; LIVE.mic = init.state.privacy.mic || []; }
  if (init.state.mic) { LIVE.micMuted = !!init.state.mic.muted; LIVE.micPresent = !!init.state.mic.present; LIVE.micReady = true; }
  renderMicPill();
  applyPhone(init.phone);
  refreshIndicators();
  onTrackChanged();
}
