'use strict';
/* Game mode: while a game is in front the main process moves the notch to the top-right corner.
   Here: the game pill (icon, time played, GPU / graphics memory / CPU / RAM, battery), the Game page,
   holding notification pop-ups, the "Is this a game?" question and the end-of-session summary. */

// ---------------------------------------------------------------- state
function gameQuiet() { return !!S.game && S.settings.gameQuiet !== false; }
// h:mm:ss after an hour, else m:ss
function fmtSession(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
// the stats the game pill shows, in order
function gameStatsOn() {
  const s = S.sys || {};
  const list = ['cpu', 'ram'];
  if (s.gpu != null) list.push('gpu');
  if (s.vramUsed > 0) list.push('vram');
  if (hasBattery()) list.push('battery');
  return list;
}
// the game's poster (from Steam) when there is one, else its app icon
function gameArtHTML(g, cls = '') {
  return g && g.poster ? `<img class="poster ${cls}" src="${esc(g.poster)}" alt="">` : gameIconHTML(g, cls);
}
function gameIconHTML(g, cls = '') {
  return g && g.icon ? `<img class="${cls}" src="${esc(g.icon)}" alt="">` : icon('gamepad');
}

function setGame(g) {
  const was = S.game;
  S.game = g || null;
  document.documentElement.dataset.game = S.game ? '1' : '';
  $('gameTab').hidden = !S.game;
  if (!S.game && S.tab === 'game') setTab(isStacked() ? 'overview' : 'home');
  compactKey = '';
  renderCompact();
  applySize();
  trackHitRect();
  renderGamePage();
  // just started playing on battery: a laptop runs games much slower unplugged
  if (S.game && !was && S.batt && hasBattery() && !S.batt.charging) {
    setTimeout(() => peek('game-batt', `<div class="pk-icon" style="color:var(--orange);background:rgba(255,159,10,.16)">${icon('plug')}</div>
      <div class="pk-text"><div class="pk-title">Playing on battery</div><div class="pk-sub">Plug in for full gaming performance · ${Math.round(S.batt.level * 100)}% left</div></div>`,
      { width: 400, duration: 4500 }), 900);
  }
}
api.on('game', setGame);

// ---------------------------------------------------------------- Game page
function renderGamePage() {
  const g = S.game;
  if (!g) return;
  $('gmName').textContent = g.name;
  $('gmName').title = g.path || g.exe;
  const key = (g.poster || g.icon || 'none').slice(-64);
  if ($('gmIcon').dataset.key !== key) {
    $('gmIcon').dataset.key = key;
    $('gmIcon').innerHTML = gameArtHTML(g);
    $('gmIcon').classList.toggle('poster', !!g.poster);
    $('gmHero').style.backgroundImage = g.hero || g.poster ? `url('${g.hero || g.poster}')` : '';
    $('gmCard').classList.toggle('has-art', !!(g.hero || g.poster));
  }
  $('gmTime').textContent = fmtSession(Date.now() - g.start);
  const meta = [];
  if (S.batt && hasBattery()) meta.push(S.batt.charging ? `<span class="gm-ok">${icon('bolt')}Plugged in</span>` : `<span class="gm-warn">${icon('plug')}On battery · ${Math.round(S.batt.level * 100)}%</span>`);
  if (gameQuiet()) meta.push(`<span>${icon('bell')}${LIVE.held ? `${LIVE.held} notification${LIVE.held > 1 ? 's' : ''} held` : 'Pop-ups held'}</span>`);
  const html = meta.join('');
  if ($('gmMeta').dataset.html !== html) { $('gmMeta').dataset.html = html; $('gmMeta').innerHTML = html; }
  const s = S.sys;
  if (!s) return;
  const set = (id, v, hot) => { const el = $(id); el.textContent = v; el.classList.toggle('hot', hot >= 85); el.classList.toggle('crit', hot >= 90); };
  set('gmCpu', s.cpu + '%', s.cpu);
  set('gmRam', s.ram + '%', s.ram);
  $('gmRamSub').textContent = `${(s.ramUsed / 1073741824).toFixed(1)} of ${(s.ramTotal / 1073741824).toFixed(1)} GB`;
  spark($('gmCpuSpark'), s.cpuHistory);
  spark($('gmRamSpark'), s.ramHistory);
  $('gmGpuCard').hidden = s.gpu == null;
  if (s.gpu != null) {
    set('gmGpu', s.gpu + '%', s.gpu);
    $('gmGpuSub').textContent = typeof gpuLabel === 'function' ? gpuLabel(s.gpuName || '') : s.gpuName || '';
    spark($('gmGpuSpark'), s.gpuHistory);
  }
  $('gmVramCard').hidden = !(s.vramUsed > 0);
  if (s.vramUsed > 0) {
    const pct = s.vramTotal > 0 ? Math.round(s.vramUsed / s.vramTotal * 100) : 0;
    set('gmVram', `${(s.vramUsed / 1073741824).toFixed(1)} GB`, pct);
    $('gmVramSub').textContent = s.vramTotal > 0 ? `${pct}% of ${(s.vramTotal / 1073741824).toFixed(1)} GB` : 'in use';
    spark($('gmVramSpark'), s.vramHistory);
  }
}
api.on('sys', () => { if (S.game && S.mode === 'expanded' && S.tab === 'game') renderGamePage(); });
setInterval(() => { if (S.game && S.mode === 'expanded' && S.tab === 'game') $('gmTime').textContent = fmtSession(Date.now() - S.game.start); }, 1000);
$('gmNotGame').addEventListener('click', () => {
  if (!S.game) return;
  api.gameAnswer({ exe: S.game.exe, name: S.game.name, path: S.game.path || '', game: false });
  collapse();
});

// Ctrl+Alt+G: open / close the panel without the mouse (on the Game page while playing)
api.on('panel-toggle', () => {
  if (S.mode === 'expanded') { S.pinned = false; collapse(); }
  else expand(S.game ? 'game' : undefined);
});

// ---------------------------------------------------------------- "Is this a game?" + session summary
let gameAsk = null;
api.on('game-ask', a => {
  gameAsk = a;
  peek('game-ask', `
    <div class="pk-icon gm-pk">${gameIconHTML(a)}</div>
    <div class="pk-text"><div class="pk-title">Is ${esc(a.name)} a game?</div><div class="pk-sub">Game mode: notch in the corner, stats, pop-ups held</div></div>
    <button class="pk-btn" data-act="game-yes">Yes</button>
    <button class="pk-btn ghost" data-act="game-no">No</button>`, { width: 480, duration: 15000, interactive: true });
});
layers.peek.addEventListener('click', e => {
  const b = e.target.closest('.pk-btn[data-act^="game-"]');
  if (!b || !gameAsk) return;
  api.gameAnswer({ exe: gameAsk.exe, name: gameAsk.name, path: gameAsk.path, game: b.dataset.act === 'game-yes' });
  gameAsk = null;
  setMode('collapsed');
});

api.on('game-summary', g => {
  const held = S.settings.gameQuiet !== false ? takeHeldCount() : 0;
  const parts = [`played ${g.ms >= 60000 ? fmtSpan(g.ms / 1000) : 'under a minute'}`];
  if (g.peakGpu) parts.push(`peak GPU ${g.peakGpu}%`);
  if (held) parts.push(`${held} notification${held > 1 ? 's' : ''} waiting`);
  peek('game-summary', `
    ${g.poster ? `<img class="pk-poster" src="${esc(g.poster)}" alt="">` : `<div class="pk-icon gm-pk">${gameIconHTML(g)}</div>`}
    <div class="pk-text"><div class="pk-title">${esc(g.name)}</div><div class="pk-sub">${esc(parts.join(' · '))}</div></div>
    ${held ? `<button class="pk-btn" data-act="game-alerts">${icon('bell')}Show</button>` : ''}`,
    { width: held ? 540 : 440, duration: 7000, interactive: !!held });
});
layers.peek.addEventListener('click', e => {
  if (e.target.closest('.pk-btn[data-act="game-alerts"]')) expand('alerts');
});
