'use strict';
/* Loaded last: wires up initial state once every widget script has run. */

// test hook used by the snapshot self-test (NOTCH_SNAP=<dir>)
window.__notchDebug = {
  S, T, ALERTS, NET, VIZ, expand, collapse, setTab, setMode, peekTrack, peekVolume, peekNotif,
  onMedia, tmSet, tmStart, renderSys, addNotif, patchSettings,
};

(async function boot() {
  hydrateIcons();
  const init = await api.init();
  S.settings = init.settings;
  if (Number.isFinite(init.anchor)) S.anchor = init.anchor;
  if (init.side) setSide(true);
  if (init.state && init.state.conn) S.conn = init.state.conn;
  S.clipboard = init.clipboard || [];
  tmSet('focus');
  applySettingsUI();
  setTab('home');
  for (const el of Object.values(layers)) el.classList.remove('show');
  layers.collapsed.classList.add('show');
  applySize();
  reportHitRect();

  if (init.state.volume) { S.volume = init.state.volume; renderVolume(); }
  if (init.state.brightness) api.refreshBrightness();
  if (init.state.media) onMedia(init.state.media); else S.mediaKey = '';
  if (S.mediaKey === undefined) S.mediaKey = '';
  if (init.state.notifStatus) ALERTS.status = init.state.notifStatus;
  (init.notifs || []).slice().reverse().forEach(n => addNotif(n, true));
  liveInit(init);

  startClock();
  loadCachedWeather();
  fetchWeather();
  initBattery();
  loadShelf();
  renderClipboard();
  renderSys();
  renderAlerts();
})();
