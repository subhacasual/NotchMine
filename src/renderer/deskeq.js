'use strict';
/* NotchMine desktop equalizer: see-through, click-through visualizer along the bottom of the screen.
   It jumps with whatever the PC is playing, fades away when the music stops, and uses the
   "Visualizer colours" palette. Style = one of the 15 looks in eqstyles.js (Settings → Desktop equalizer; party mode uses it too),
   Intensity = brightness/glow, Height = how high it can reach. */

const api = window.notch;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let settings = {}, media = { active: false }, accent = '167, 139, 250';

// ---- palette (same rules as the notch / party mode)
const PRESETS = {
  rainbow: ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#bf5af2'],
  sunset: ['#ff5f6d', '#ff9966', '#ffc371'], ocean: ['#00c6ff', '#0072ff', '#7b5cff'],
  neon: ['#ff00cc', '#7a5cff', '#00f0ff'], fire: ['#ff2a00', '#ff7b00', '#ffd000'],
  aurora: ['#30d0c0', '#7b5cff', '#ff3787'],
};
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : null; };
let stops = [[167, 139, 250]];
function computeStops() {
  const mode = settings.vizPalette || 'accent';
  let s = null;
  if (mode === 'custom') s = (settings.vizCustom || []).slice(0, clamp(settings.vizCustomCount || 3, 1, 3)).map(hexRgb).filter(Boolean);
  else if (PRESETS[mode]) s = PRESETS[mode].map(hexRgb);
  stops = s && s.length ? s : [accent.split(',').map(Number)];
}
function palAt(t) {
  if (stops.length === 1) return stops[0];
  const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map(k => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f));
}
const pal = t => palAt(t).join(', ');
const hot = (t, w) => palAt(t).map(v => Math.round(v + (255 - v) * w)).join(', ');

// ---- audio (system loopback, analysed locally, never recorded)
const AU = { an: null, ctx: null, data: null, peak: 0.6, bassPeak: 0.5 };
// the raw bass (40–170 Hz) for beat detection (makeBeatDetector in eqstyles.js)
const BEAT = { bass: 0 };
const beatOf = makeBeatDetector();         // eqstyles.js
async function startAudio() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 64, maxHeight: 64, maxFrameRate: 1 } },
    });
    s.getVideoTracks().forEach(t => t.stop());
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 4096; an.smoothingTimeConstant = 0.55; an.minDecibels = -95; an.maxDecibels = -12;
    ctx.createMediaStreamSource(s).connect(an);
    Object.assign(AU, { an, ctx, data: new Uint8Array(an.frequencyBinCount), td: new Uint8Array(an.fftSize) });
  } catch (e) { console.warn('desktop eq: no system audio', e && e.message); }
}

// ---- drawing
const cv = document.getElementById('eq');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1; W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
window.addEventListener('resize', resize);
resize();

let N = 0, vals = new Float32Array(0), peaks = new Float32Array(0), peakV = new Float32Array(0);
function ensureBars() {
  const n = clamp(Math.round(W / 21), 40, 160);
  if (n === N) return;
  N = n; vals = new Float32Array(n); peaks = new Float32Array(n); peakV = new Float32Array(n);
}
const isPlaying = () => media.active && media.status === 'Playing';
let vis = 0, last = 0, synthT = 0;

function frame(t) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(50, t - last) : 16;
  last = t;
  ensureBars();
  const playing = isPlaying();
  vis += ((playing ? 1 : 0) - vis) * (playing ? 0.08 : 0.04);          // fade in / out with the music
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (vis < 0.01 && !playing) return;

  // spectrum: log-spaced bands, optionally mirrored (bass in the middle)
  const mirror = settings.deskEqMirror !== false;
  const half = mirror ? Math.ceil(N / 2) : N;
  const target = new Float32Array(half);
  if (AU.an && playing) {
    const d = AU.data, hz = AU.ctx.sampleRate / AU.an.fftSize;
    AU.an.getByteFrequencyData(d);
    let bs = 0, bn = 0;
    for (let b = Math.max(1, Math.floor(40 / hz)); b <= Math.ceil(170 / hz); b++) { bs += d[b]; bn++; }
    const raw = bn ? bs / bn / 255 : 0;
    AU.bassPeak = Math.max(raw, Math.max(0.45, AU.bassPeak * 0.996));
    BEAT.bass = clamp((raw - 0.3) / (AU.bassPeak - 0.3), 0, 1);
    let mx = 0;
    for (let i = 0; i < half; i++) {
      const f0 = 32 * Math.pow(16000 / 32, i / half), f1 = 32 * Math.pow(16000 / 32, (i + 1) / half);
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < d.length; b++) m = Math.max(m, d[b]);
      target[i] = m / 255 + (i / half) * 0.14;
      mx = Math.max(mx, target[i]);
    }
    AU.peak = Math.max(mx, Math.max(0.5, AU.peak * 0.996));
    for (let i = 0; i < half; i++) target[i] = clamp((target[i] - 0.3) / (AU.peak - 0.3), 0, 1);
  } else if (playing) {
    synthT += dt;
    const beat = Math.exp(-(synthT % 500) / 110);                     // a kick drum: instant hit, quick decay
    BEAT.bass = 0.2 + beat * 0.8;
    for (let i = 0; i < half; i++) target[i] = clamp(0.25 + Math.sin(synthT / 300 + i * 0.5) * 0.18 + beat * 0.5 * (1 - i / half), 0, 1);
  }
  for (let i = 0; i < N; i++) {
    const k = mirror ? Math.abs(i - (N - 1) / 2) / ((N - 1) / 2) : i / (N - 1);        // 0 = bass
    const v = target[Math.min(half - 1, Math.floor(k * (half - 1) + 0.5))] || 0;
    vals[i] += (v - vals[i]) * (v > vals[i] ? 0.55 : 0.16);
    if (vals[i] >= peaks[i]) { peaks[i] = vals[i]; peakV[i] = 0; } else { peakV[i] += dt * 0.0000025; peaks[i] = Math.max(vals[i], peaks[i] - peakV[i] * dt); }
  }

  const inten = clamp((settings.deskEqIntensity ?? 60) / 100, 0, 1);
  const P = {
    inten, mirror, a: vis * (0.15 + inten * 0.85),
    maxH: H * (0.12 + clamp((settings.deskEqHeight ?? 45) / 100, 0, 1) * 0.88),
    pt: i => (mirror ? Math.abs(i - (N - 1) / 2) / ((N - 1) / 2) : i / (N - 1)),   // palette position of column i
  };
  if (!playing) BEAT.bass = 0;
  const kick = beatOf(BEAT.bass, t);
  ctx.globalCompositeOperation = 'lighter';
  drawEq({ ctx, W, H, N, vals, peaks, pal, hot, playing, AU, synthT, kick, bass: BEAT.bass }, settings.deskEqStyle, P, dt);
}

// the look (Settings → Desktop equalizer → Style) is drawn by eqstyles.js, shared with party mode
const drawEq = makeEqStyles();

api.on('media', m => {
  if (m.active && m.thumb === undefined && media.thumbId === m.thumbId) m.thumb = media.thumb;
  m.receivedAt = Date.now();
  media = m;
});
api.on('settings', s => { settings = s; computeStops(); });
api.on('accent', a => { accent = a; computeStops(); });

(async function boot() {
  const init = await api.partyInit();
  settings = init.settings || {};
  accent = init.accent || accent;
  if (init.media) media = init.media;
  computeStops();
  startAudio();
  requestAnimationFrame(frame);
  window.__eq = { AU, vals: () => vals, vis: () => vis };
})();
