'use strict';
/* NotchMine party mode: a full-screen light show that follows the music.
   - centre (main screen): a big Orb or Sun (follows the "Music icon effect" setting) that throws sparks
   - lighting (each can be switched on/off): club beams, pulsing edge glow, floating particles, blurred album art
   - a faint equalizer blowing up from the bottom of the screen
   Everything is coloured by the "Visualizer colours" palette and driven by the PC's real audio (loopback). */

const api = window.notch;
const $ = id => document.getElementById(id);
const ROLE = new URLSearchParams(location.search).get('role') || 'main';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, '0');
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`; };
if (ROLE !== 'main') document.body.classList.add('side');

let settings = {};
let media = { active: false };
let accent = '167, 139, 250';

// ================================================================== palette (same rules as the notch)
const PRESETS = {
  rainbow: ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#bf5af2'],
  sunset: ['#ff5f6d', '#ff9966', '#ffc371'], ocean: ['#00c6ff', '#0072ff', '#7b5cff'],
  neon: ['#ff00cc', '#7a5cff', '#00f0ff'], fire: ['#ff2a00', '#ff7b00', '#ffd000'],
  aurora: ['#30d0c0', '#7b5cff', '#ff3787'],
};
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : null; };
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; }
  return [h, s, l];
}
function hslRgb(h, s, l) {
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t % 1 + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
let stops = [[167, 139, 250]];
function computeStops() {
  const mode = settings.vizPalette || 'accent';
  let s = null;
  if (mode === 'custom') {
    const n = clamp(settings.vizCustomCount || 3, 1, 3);
    s = (settings.vizCustom || []).slice(0, n).map(hexRgb).filter(Boolean);
  } else if (PRESETS[mode]) s = PRESETS[mode].map(hexRgb);
  if (!s || !s.length) s = [accent.split(',').map(Number)];
  // a single colour gets two neighbouring hues so the room isn't flat
  if (s.length === 1) { const [h, sa, l] = rgbHsl(s[0]); s = [hslRgb(h - 0.09, sa, l), s[0], hslRgb(h + 0.09, sa, l)]; }
  stops = s;
  document.documentElement.style.setProperty('--accent', stops[Math.floor(stops.length / 2)].join(', '));
}
function palAt(t) {
  if (stops.length === 1) return stops[0];
  const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map(k => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f));
}
const pal = t => palAt(t).join(', ');
const palHot = (t, w = 0.6) => palAt(t).map(v => Math.round(v + (255 - v) * w)).join(', ');
const lights = () => ({ beams: true, glow: true, particles: true, albumArt: true, ...(settings.partyLights || {}) });
const isPlaying = () => media.active && media.status === 'Playing';

// ================================================================== audio (system loopback, analysed locally)
const NB = 72;
const AU = {
  an: null, ctx: null, data: null, peak: 0.5, lvlPeak: 0.4, bandPeak: 0.6,
  bass: 0, level: 0.3, prevBass: 0, lastKick: 0, flash: 0,
  bands: new Float32Array(NB),
};
async function startAudio() {
  if (settings.visualizer === false) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 64, maxHeight: 64, maxFrameRate: 1 } },
    });
    s.getVideoTracks().forEach(t => t.stop());
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0.62; an.minDecibels = -95; an.maxDecibels = -12;
    ctx.createMediaStreamSource(s).connect(an);
    Object.assign(AU, { an, ctx, data: new Uint8Array(an.frequencyBinCount) });
  } catch (e) { console.warn('party: no system audio, using a synthetic beat', e && e.message); }
}
function listen(t) {
  const playing = isPlaying();
  let bass = 0, lvl = 0.12;
  const target = new Float32Array(NB);
  if (AU.an && playing) {
    const d = AU.data, hz = AU.ctx.sampleRate / AU.an.fftSize;
    AU.an.getByteFrequencyData(d);
    let s = 0, n = 0;
    for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(170 / hz); i++) { s += d[i]; n++; }
    const raw = n ? s / n / 255 : 0;
    AU.peak = Math.max(raw, Math.max(0.45, AU.peak * 0.996));
    bass = clamp((raw - 0.3) / (AU.peak - 0.3), 0, 1);
    let sa = 0, na = 0;
    for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(10000 / hz) && i < d.length; i++) { sa += d[i]; na++; }
    const all = na ? sa / na / 255 : 0;
    AU.lvlPeak = Math.max(all, Math.max(0.3, AU.lvlPeak * 0.9985));
    lvl = clamp(Math.pow(clamp((all - 0.1) / (AU.lvlPeak - 0.1), 0, 1), 1.3), 0, 1);
    let fmax = 0;
    for (let i = 0; i < NB; i++) {
      const f0 = 35 * Math.pow(16000 / 35, i / NB), f1 = 35 * Math.pow(16000 / 35, (i + 1) / NB);
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < d.length; b++) m = Math.max(m, d[b]);
      target[i] = m / 255 + (i / NB) * 0.13;
      fmax = Math.max(fmax, target[i]);
    }
    AU.bandPeak = Math.max(fmax, Math.max(0.5, AU.bandPeak * 0.995));
    for (let i = 0; i < NB; i++) target[i] = clamp((target[i] - 0.32) / (AU.bandPeak - 0.32), 0, 1);
  } else if (playing) {
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI / 500)), 8);
    bass = 0.2 + beat * 0.8; lvl = 0.6;
    for (let i = 0; i < NB; i++) target[i] = clamp(0.3 + Math.sin(t / 380 + i * 0.45) * 0.2 + beat * 0.4 * (1 - i / NB), 0, 1);
  }
  AU.bass += (bass - AU.bass) * (bass > AU.bass ? 0.55 : 0.1);
  AU.level += (lvl - AU.level) * 0.06;
  for (let i = 0; i < NB; i++) AU.bands[i] += (target[i] - AU.bands[i]) * (target[i] > AU.bands[i] ? 0.5 : 0.14);
  const kick = bass - AU.prevBass > 0.12 && bass > 0.35 && t - AU.lastKick > 95;
  AU.prevBass = bass;
  if (kick) { AU.lastKick = t; AU.flash = Math.min(1, AU.flash + 0.6 + bass * 0.4); }
  AU.flash *= 0.9;
  return kick;
}

// ================================================================== canvas + scene
const cv = $('fx');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
window.addEventListener('resize', resize);
resize();

const centre = () => ({ x: W / 2, y: H * 0.46, R: Math.min(W, H) * 0.165 });

// particles drifting through the room
const PARTS = Array.from({ length: 260 }, () => ({
  x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00002, vy: -(0.000006 + Math.random() * 0.000022),
  s: 0.6 + Math.random() * 1.9, ph: Math.random() * 6.28, tw: 0.6 + Math.random() * 2.4, c: Math.random(),
}));
// club beams: from the floor and the top corners, sweeping
const BEAMS = [
  ...[0.06, 0.22, 0.38, 0.62, 0.78, 0.94].map((fx, i) => ({ ox: fx, oy: 1.02, base: -Math.PI / 2 + (fx - 0.5) * 0.7, sweep: 0.5, sp: 0.00045 + i * 0.00007, ph: i * 1.3, c: i / 5 })),
  { ox: -0.02, oy: -0.02, base: Math.PI / 4, sweep: 0.35, sp: 0.0004, ph: 0.7, c: 0.2 },
  { ox: 1.02, oy: -0.02, base: Math.PI * 3 / 4, sweep: 0.35, sp: 0.00037, ph: 2.1, c: 0.8 },
];
// sparks thrown out of the centre piece and shock rings on kicks
const SPARKS = [], RINGS = [];

function drawGlow() {
  const a = (0.08 + AU.bass * 0.38 + AU.flash * 0.1) * (0.35 + AU.level * 0.65);
  const edge = (x0, y0, x1, y1, col, alpha, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(${col}, ${alpha})`); g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, W * 0.22, 0, pal(0), a, 0, 0, W * 0.22, H);
  edge(W, 0, W * 0.78, 0, pal(1), a, W * 0.78, 0, W * 0.22, H);
  edge(0, H, 0, H * 0.62, pal(0.5), a * 1.1, 0, H * 0.62, W, H * 0.38);
  edge(0, 0, 0, H * 0.18, pal(0.3), a * 0.5, 0, 0, W, H * 0.18);
}

function drawBeams(t) {
  const L = Math.hypot(W, H) * 1.15;
  for (const b of BEAMS) {
    const ox = b.ox * W, oy = b.oy * H;
    const ang = b.base + Math.sin(t * b.sp + b.ph) * b.sweep;
    const half = 0.018 + AU.bass * 0.02;
    const alpha = (0.035 + AU.level * 0.08 + AU.flash * 0.16) ;
    const col = pal(b.c);
    const ex = ox + Math.cos(ang) * L, ey = oy + Math.sin(ang) * L;
    const g = ctx.createLinearGradient(ox, oy, ex, ey);
    g.addColorStop(0, `rgba(${palHot(b.c, 0.4)}, ${alpha * 1.6})`);
    g.addColorStop(0.35, `rgba(${col}, ${alpha})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(ang - half) * L, oy + Math.sin(ang - half) * L);
    ctx.lineTo(ox + Math.cos(ang + half) * L, oy + Math.sin(ang + half) * L);
    ctx.closePath();
    ctx.fill();
  }
}

function drawParticles(dt, t) {
  const speed = 1 + AU.bass * 3.5;
  for (const p of PARTS) {
    p.x += p.vx * dt * speed; p.y += p.vy * dt * speed;
    if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
    if (p.x < -0.02) p.x = 1.02; else if (p.x > 1.02) p.x = -0.02;
    const tw = 0.5 + 0.5 * Math.sin(t / 1000 * p.tw + p.ph);
    const a = (0.12 + 0.6 * tw) * (0.35 + AU.level * 0.65);
    const s = p.s * (1 + AU.bass * 0.6);
    ctx.fillStyle = `rgba(${palHot(p.c, 0.35)}, ${a})`;
    ctx.fillRect(p.x * W - s / 2, p.y * H - s / 2, s, s);
  }
}

function drawEqualizer() {
  const n = NB, gap = Math.max(2, W / n * 0.22), bw = (W - gap * (n - 1)) / n, maxH = H * 0.3;
  for (let i = 0; i < n; i++) {
    const v = AU.bands[i];
    const h = Math.max(2, v * maxH);
    const x = i * (bw + gap);
    const col = pal(i / (n - 1));
    const g = ctx.createLinearGradient(0, H - h, 0, H);
    g.addColorStop(0, `rgba(${col}, 0)`);
    g.addColorStop(1, `rgba(${col}, ${0.16 + v * 0.3})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, H - h, bw, h);
  }
}

// ---- shared: sparks + rings around the centre piece
function emitSparks(kick, dt, c) {
  const fire = (count, power) => {
    for (let j = 0; j < count && SPARKS.length < 260; j++) {
      SPARKS.push({
        a: Math.random() * Math.PI * 2, r: c.R * 0.98,
        v: (0.18 + Math.random() * 0.38) * (0.7 + power * 0.7) * (c.R / 120),
        len: c.R * (0.12 + Math.random() * 0.3), w: 1.2 + Math.random() * 2.4, life: 1, col: palHot(Math.random(), 0.25),
      });
    }
  };
  if (kick) {
    fire(10 + Math.round(AU.bass * 20 * (0.4 + AU.level)), AU.bass);
    if (AU.bass > 0.55 && RINGS.length < 4) RINGS.push({ r: c.R, life: 1 });
  }
  if (isPlaying()) {
    emitSparks.acc = (emitSparks.acc || 0) + dt * (0.01 + 0.08 * AU.level * (0.4 + AU.bass));
    while (emitSparks.acc >= 1) { emitSparks.acc -= 1; fire(1, AU.level * 0.7); }
  }
}
function drawSparks(dt, c) {
  const maxR = Math.hypot(W, H) / 2;
  ctx.lineCap = 'round';
  for (let j = SPARKS.length - 1; j >= 0; j--) {
    const p = SPARKS[j];
    p.r += p.v * dt; p.life -= dt / 1500;
    if (p.life <= 0 || p.r > maxR) { SPARKS.splice(j, 1); continue; }
    const x0 = c.x + Math.cos(p.a) * p.r, y0 = c.y + Math.sin(p.a) * p.r;
    const back = Math.max(c.R * 0.98, p.r - p.len);
    const x1 = c.x + Math.cos(p.a) * back, y1 = c.y + Math.sin(p.a) * back;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const pa = p.life * (0.5 + AU.level * 0.5);
    g.addColorStop(0, `rgba(255, 255, 255, ${pa})`);
    g.addColorStop(0.3, `rgba(${p.col}, ${pa * 0.75})`);
    g.addColorStop(1, `rgba(${p.col}, 0)`);
    ctx.strokeStyle = g; ctx.lineWidth = p.w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  for (let j = RINGS.length - 1; j >= 0; j--) {
    const r = RINGS[j];
    r.r += dt * 0.55 * (c.R / 120); r.life -= dt / 1300;
    if (r.life <= 0) { RINGS.splice(j, 1); continue; }
    ctx.strokeStyle = `rgba(${pal(0.5)}, ${r.life * 0.28})`;
    ctx.lineWidth = 1.5 + r.life * 3;
    ctx.beginPath(); ctx.arc(c.x, c.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
}

// ---- the big sun
const SUN_N = 96;
const SUN = {
  len: new Float32Array(SUN_N),
  jit: Float32Array.from({ length: SUN_N }, () => 0.55 + Math.random() * 0.6),
  jitT: Float32Array.from({ length: SUN_N }, () => 0.55 + Math.random() * 0.6),
  ang: Float32Array.from({ length: SUN_N }, (_, i) => (i / SUN_N) * Math.PI * 2 + (Math.random() - 0.5) * 0.05),
};
function drawSun(c, kick) {
  const b = AU.bass, glow = 0.3 + AU.level * 0.7, R = c.R * 0.55 * (1 + b * 0.12);
  for (let i = 0; i < SUN_N; i++) {
    const k = i < SUN_N / 2 ? i : SUN_N - 1 - i;
    const band = AU.bands[Math.floor(k / (SUN_N / 2) * (NB - 1))];
    const tgt = band * 0.75 + b * 0.45;
    SUN.len[i] += (tgt - SUN.len[i]) * (tgt > SUN.len[i] ? 0.5 : 0.09);
    if (kick) SUN.jitT[i] = 0.5 + Math.random() * 0.7;
    SUN.jit[i] += (SUN.jitT[i] - SUN.jit[i]) * 0.04;
  }
  // bloom
  let g = ctx.createRadialGradient(c.x, c.y, R * 0.3, c.x, c.y, R * (2.6 + b * 1.6));
  g.addColorStop(0, `rgba(${pal(0.5)}, ${(0.4 + b * 0.3) * glow})`);
  g.addColorStop(0.4, `rgba(${pal(0.5)}, ${(0.12 + b * 0.12) * glow})`);
  g.addColorStop(1, `rgba(${pal(0.5)}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R * (2.6 + b * 1.6), 0, Math.PI * 2); ctx.fill();
  // corona
  for (let i = 0; i < SUN_N; i++) {
    const a = SUN.ang[i], r0 = R * 0.95, L = R * (0.2 + SUN.len[i] * 1.9 * (0.45 + AU.level * 0.55)) * SUN.jit[i], r1 = r0 + L;
    const half = (0.012 + SUN.len[i] * 0.012) * (i % 3 === 0 ? 1.5 : 1);
    const alpha = (0.08 + SUN.len[i] * 0.4) * glow;
    const col = pal(i < SUN_N / 2 ? i / (SUN_N / 2) : (SUN_N - i) / (SUN_N / 2));
    const rg = ctx.createRadialGradient(c.x, c.y, r0, c.x, c.y, r1);
    rg.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.6})`);
    rg.addColorStop(0.2, `rgba(${col}, ${alpha})`);
    rg.addColorStop(1, `rgba(${col}, 0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a - half) * r0, c.y + Math.sin(a - half) * r0);
    ctx.lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1);
    ctx.lineTo(c.x + Math.cos(a + half) * r0, c.y + Math.sin(a + half) * r0);
    ctx.closePath(); ctx.fill();
  }
  // the disc itself: white-hot centre fading to the palette
  g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.85 + b * 0.15})`);
  g.addColorStop(0.45, `rgba(${palHot(0.5, 0.55)}, ${0.7 + b * 0.2})`);
  g.addColorStop(0.85, `rgba(${pal(0.5)}, ${0.45 + b * 0.25})`);
  g.addColorStop(1, `rgba(${pal(0.5)}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.fill();
}

// ---- the big orb (the holographic globe from the author's Friday project, denser for the big screen)
const ORB = (() => {
  let seed = 11;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function ring(normal, n, offset = 0, scale = 1) {
    const nn = norm(normal), u = norm(cross(nn, Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(nn, u), k = Math.sqrt(1 - offset * offset);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); for (let d = 0; d < 3; d++) pts[i * 3 + d] = (nn[d] * offset + k * (cs * u[d] + sn * v[d])) * scale; }
    return pts;
  }
  const arcs = (n, spans, mn, mx) => { const on = new Uint8Array(n); for (let s = 0; s < spans; s++) { const st = Math.floor(rnd() * n), len = mn + Math.floor(rnd() * (mx - mn)); for (let i = 0; i < len; i++) on[(st + i) % n] = 1; } return on; };
  const lines = [];
  for (let k = 0; k < 40; k++) {
    const n = 110, on = arcs(n, 1 + Math.floor(rnd() * 3), 18, 75), st = rnd();
    if (st < 0.2) for (let i = 0; i < n; i += 2) on[i] = 0; else if (st < 0.45) for (let i = 0; i < n; i += 4) on[i] = 0;
    lines.push({ pts: ring([gauss(), gauss(), gauss()], n, k >= 30 ? 0.3 + rnd() * 0.45 : 0), on, base: 0.45 + rnd() * 0.55, layer: 0 });
  }
  for (const lat of [-62, -42, -21, 0, 21, 42, 62]) {
    const n = 140, r = Math.cos(lat * Math.PI / 180), y = Math.sin(lat * Math.PI / 180), pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.set([r * Math.cos(a), y, r * Math.sin(a)], i * 3); }
    const on = new Uint8Array(n).fill(1); const gp = Math.floor(rnd() * n); for (let i = 0; i < 8 + rnd() * 20; i++) on[(gp + i) % n] = 0;
    lines.push({ pts, on, base: lat === 0 ? 0.85 : 0.55, layer: 0 });
  }
  for (let k = 0; k < 8; k++) lines.push({ pts: ring([gauss(), gauss(), gauss()], 70, 0, 0.5), on: arcs(70, 2, 15, 50), base: 0.4 + rnd() * 0.4, layer: 1 });
  for (const r of [1.16, 1.24, 1.31, 1.38]) { const tilt = rnd() - 0.5; lines.push({ pts: ring([Math.sin(tilt), Math.cos(tilt), (rnd() - 0.5) * 0.6], 160, 0, r), on: arcs(160, 2, 40, 110), base: 0.7, layer: 2 }); }
  const dust = [];
  for (let i = 0; i < 420; i++) { const d = norm([gauss(), gauss(), gauss()]), r = i < 300 ? 1 + gauss() * 0.025 : i < 360 ? 0.05 + rnd() * 0.55 : 1.08 + rnd() * 0.45; dust.push([d[0] * r, d[1] * r, d[2] * r, rnd() * 6.28, 0.5 + rnd() * 2]); }
  return { lines, dust, yaw: 0, inner: 0, orbit: 0 };
})();
function drawOrb(c, dt, t) {
  const b = AU.bass, glow = 0.3 + AU.level * 0.7, R = c.R * (1 + b * 0.06);
  ORB.yaw += dt / 1000 * (0.25 + b * 1.2); ORB.inner -= dt / 1000 * (0.45 + b * 1.4); ORB.orbit += dt / 1000 * (0.18 + b * 0.7);
  const pitch = 0.38 + Math.sin(t / 2600) * 0.1;
  const mats = [ORB.yaw, ORB.inner, ORB.orbit].map(y => { const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(pitch), sp = Math.sin(pitch); return [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy]; });
  const depth = z => 0.1 + 0.9 * Math.pow(clamp((z + 1) / 2, 0, 1), 1.6);
  const MAIN = pal(0.5), HOT = palHot(0.5, 0.6);
  // halo
  let g = ctx.createRadialGradient(c.x, c.y, R * 0.5, c.x, c.y, R * (2.2 + b * 0.8));
  g.addColorStop(0, `rgba(${MAIN}, ${0.32 * glow + 0.08})`); g.addColorStop(0.45, `rgba(${MAIN}, ${0.1 * glow})`); g.addColorStop(1, `rgba(${MAIN}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, R * (2.2 + b * 0.8), 0, Math.PI * 2); ctx.fill();
  // burning core
  const cr = R * (0.55 + b * 0.3);
  g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, cr);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.8 + b * 0.2})`); g.addColorStop(0.3, `rgba(${HOT}, ${0.55 + b * 0.35})`);
  g.addColorStop(0.7, `rgba(${MAIN}, ${0.25 + b * 0.25})`); g.addColorStop(1, `rgba(${MAIN}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, cr, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 9; k++) {
    const a = t / (700 + k * 130) + k * 1.9, d = R * (0.15 + 0.12 * Math.sin(t / 310 + k));
    const fx = c.x + Math.cos(a) * d, fy = c.y + Math.sin(a) * d, fr = R * (0.24 + 0.1 * Math.sin(t / 190 + k * 2.3) + b * 0.14);
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, `rgba(${HOT}, ${0.3 * glow + 0.08})`); fg.addColorStop(1, `rgba(${MAIN}, 0)`);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2); ctx.fill();
  }
  // the wire globe, depth-shaded, batched into brightness steps
  const STEPS = 10, paths = Array.from({ length: STEPS }, () => new Path2D()), used = new Uint8Array(STEPS);
  for (const ln of ORB.lines) {
    const m = mats[ln.layer], P = ln.pts, n = P.length / 3;
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      sx[i] = c.x + (m[0] * x + m[1] * y + m[2] * z) * R; sy[i] = c.y + (m[3] * x + m[4] * y + m[5] * z) * R; sz[i] = m[6] * x + m[7] * y + m[8] * z;
    }
    for (let i = 0; i < n; i++) {
      if (!ln.on[i]) continue;
      const j = (i + 1) % n;
      const bri = ln.base * depth((sz[i] + sz[j]) / 2) * (0.55 + glow * 0.45 + b * 0.2);
      const k = clamp(Math.floor(bri * STEPS), 0, STEPS - 1);
      paths[k].moveTo(sx[i], sy[i]); paths[k].lineTo(sx[j], sy[j]); used[k] = 1;
    }
  }
  const lw = Math.max(0.8, R * 0.0075);
  ctx.lineCap = 'round';
  for (let k = 0; k < STEPS; k++) {
    if (!used[k]) continue;
    const a = (k + 1) / STEPS, lc = pal(k / (STEPS - 1)), lh = palHot(k / (STEPS - 1), 0.55);
    ctx.strokeStyle = `rgba(${lc}, ${a * 0.2})`; ctx.lineWidth = lw * 4; ctx.stroke(paths[k]);
    ctx.strokeStyle = `rgba(${a > 0.7 ? lh : lc}, ${a * 0.9})`; ctx.lineWidth = lw; ctx.stroke(paths[k]);
  }
  const m = mats[0];
  for (const [x, y, z, ph, rate] of ORB.dust) {
    const pz = m[6] * x + m[7] * y + m[8] * z;
    const a = depth(pz) * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t / 1000 * rate * 3 + ph))) * (0.5 + glow * 0.5);
    ctx.fillStyle = `rgba(${HOT}, ${a})`;
    const s = Math.max(1, R * 0.008);
    ctx.fillRect(c.x + (m[0] * x + m[1] * y + m[2] * z) * R - s / 2, c.y + (m[3] * x + m[4] * y + m[5] * z) * R - s / 2, s, s);
  }
}
function drawNote(c) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(c.x, c.y);
  const s = c.R * 0.3 / 24 * (1 + AU.bass * 0.06);
  ctx.scale(s, s); ctx.translate(-12, -12);
  const ink = `rgba(${palAt(0.5).map(v => Math.round(v * 0.2)).join(', ')}, 0.85)`;
  ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D('M9 18V5l12-2v13'));
  ctx.beginPath(); ctx.arc(6, 18, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(18, 16, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ================================================================== theme: SYNTHWAVE (80s retro night drive)
// A striped neon sun sinking behind mountains that dance with the spectrum, a glowing grid floor
// rushing towards you (faster on the bass), stars and the odd shooting star on big beats.
const SW = {
  scroll: 0,
  stars: Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random() * 0.6, s: 0.5 + Math.random() * 1.6, ph: Math.random() * 6.28, tw: 0.5 + Math.random() * 2.2 })),
  shoot: [],
  back: Float32Array.from({ length: 56 }, () => 0.35 + Math.random() * 0.65),     // fixed jagged ridge shapes
  front: Float32Array.from({ length: 72 }, () => 0.3 + Math.random() * 0.7),
  img: new Image(), imgSrc: '',
};
const darken = (rgb, k) => rgb.map(v => Math.round(v * k)).join(', ');

function ridge(profile, horizon, maxH, phase, depthK) {
  // heights: fixed rock shape + the spectrum; low in the middle so the sun sets in a valley
  const n = profile.length, pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, k = Math.abs(u - 0.5) * 2;                       // 0 centre → 1 edges
    const band = AU.bands[Math.floor((1 - k) * (NB * 0.55) + phase) % NB];
    const h = (profile[i % n] * 0.55 + band * 0.75 * depthK) * (0.22 + 0.78 * Math.pow(k, 1.3)) * maxH;
    pts.push([u * W, horizon - h]);
  }
  return pts;
}

function drawSynthwave(dt, t, kick) {
  const hz = H * 0.6, b = AU.bass, lvl = AU.level;
  SW.scroll += dt / 1000 * (0.55 + lvl * 0.7 + b * 2.4 + AU.flash * 1.5);

  // sky + floor (opaque scene)
  ctx.globalCompositeOperation = 'source-over';
  let g = ctx.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, `rgb(${darken(palAt(0.85), 0.06)})`);
  g.addColorStop(0.6, `rgb(${darken(palAt(0.6), 0.22)})`);
  g.addColorStop(1, `rgb(${darken(palAt(0.15), 0.55)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz);
  g = ctx.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, `rgb(${darken(palAt(0.2), 0.22)})`);
  g.addColorStop(1, `rgb(${darken(palAt(0.9), 0.05)})`);
  ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);

  ctx.globalCompositeOperation = 'lighter';
  // stars
  for (const s of SW.stars) {
    const a = (0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t / 1000 * s.tw + s.ph))) * (1 - s.y / 0.6 * 0.7);
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
  }
  // shooting stars on big beats
  if (kick && b > 0.6 && Math.random() < 0.45 && SW.shoot.length < 3) {
    SW.shoot.push({ x: Math.random() * W * 0.8 + W * 0.1, y: Math.random() * hz * 0.4, vx: (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6), vy: 0.35 + Math.random() * 0.25, life: 1 });
  }
  for (let i = SW.shoot.length - 1; i >= 0; i--) {
    const s = SW.shoot[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt / 900;
    if (s.life <= 0) { SW.shoot.splice(i, 1); continue; }
    const tx = s.x - s.vx * 140, ty = s.y - s.vy * 140;
    const lg = ctx.createLinearGradient(s.x, s.y, tx, ty);
    lg.addColorStop(0, `rgba(255, 255, 255, ${s.life})`); lg.addColorStop(1, `rgba(${pal(0.7)}, 0)`);
    ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
  }

  // the sun (main screen)
  if (ROLE === 'main') {
    const R = Math.min(W, H) * 0.24 * (1 + b * 0.05), cx = W / 2, cy = hz - R * 0.5;
    g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (2 + b * 0.8));
    g.addColorStop(0, `rgba(${palHot(0.15, 0.2)}, ${0.35 + b * 0.35})`);
    g.addColorStop(1, `rgba(${pal(0.15)}, 0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * (2 + b * 0.8), 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); ctx.rect(0, 0, W, hz); ctx.clip();               // the sun sets behind the horizon
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, `rgb(${palHot(1, 0.55)})`);
    g.addColorStop(0.55, `rgb(${palHot(0.5, 0.15)})`);
    g.addColorStop(1, `rgb(${pal(0)})`);
    ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const useArt = lights().albumArt && media.thumb && SW.img.complete && SW.img.naturalWidth;
    if (useArt) {                                                     // album art inside the sun, tinted
      ctx.globalAlpha = 0.55;
      ctx.drawImage(SW.img, cx - R, cy - R, R * 2, R * 2);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.globalAlpha = 1;
    }
    // the classic horizontal cuts, sliding down and widening towards the bottom
    const skyAt = y => { const f = clamp(y / hz, 0, 1); return f < 0.6 ? darken(palAt(0.6), 0.22) : darken(palAt(0.15), 0.22 + (f - 0.6) / 0.4 * 0.33); };
    const off = (t / 1600) % 1;
    for (let k = 0; k < 9; k++) {
      const p = (k + off) / 9;                                        // 0 at mid-sun → 1 at bottom
      const y = cy + R * (0.02 + p * 0.98);
      const hgt = R * (0.012 + p * 0.07) * (1 + b * 0.4);
      ctx.fillStyle = `rgb(${skyAt(y)})`;
      ctx.fillRect(cx - R, y, R * 2, hgt);
    }
    ctx.restore();
  }

  // mountains: a dark back ridge and a front ridge with a neon edge (they are the equalizer)
  ctx.globalCompositeOperation = 'source-over';
  for (const [prof, maxH, ph, dk, fill, edge] of [
    [SW.back, H * 0.2, 7, 0.7, darken(palAt(0.8), 0.12), pal(0.85)],
    [SW.front, H * 0.13, 0, 1, darken(palAt(0.3), 0.07), pal(0.25)],
  ]) {
    const pts = ridge(prof, hz, maxH, ph, dk);
    ctx.beginPath(); ctx.moveTo(0, hz);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W, hz); ctx.closePath();
    ctx.fillStyle = `rgb(${fill})`; ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = `rgba(${edge}, ${0.18 + lvl * 0.15})`; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = `rgba(${edge}, ${0.75 + b * 0.25})`; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }

  // the grid floor
  ctx.globalCompositeOperation = 'lighter';
  const flash = 0.45 + lvl * 0.35 + AU.flash * 0.6;
  const vpX = W / 2;
  // horizon line
  g = ctx.createLinearGradient(0, hz - 30, 0, hz + 30);
  g.addColorStop(0, `rgba(${pal(0.15)}, 0)`); g.addColorStop(0.5, `rgba(${palHot(0.15, 0.3)}, ${0.5 * flash})`); g.addColorStop(1, `rgba(${pal(0.15)}, 0)`);
  ctx.fillStyle = g; ctx.fillRect(0, hz - 30, W, 60);
  // depth lines (rushing towards you)
  const frac = SW.scroll % 1;
  for (let i = 1; i < 34; i++) {
    const d = (i - frac) * 0.55;
    if (d <= 0.05) continue;
    const y = hz + (H - hz) * Math.min(1.4, 0.28 / d);
    if (y > H + 4) continue;
    const near = clamp((y - hz) / (H - hz), 0, 1);
    const col = pal(0.15 + near * 0.7);
    ctx.strokeStyle = `rgba(${col}, ${(0.12 + near * 0.75) * flash})`;
    ctx.lineWidth = 0.8 + near * 2.4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // lines running to the vanishing point
  const lanes = 22, spread = W * 0.16;
  for (let j = -lanes; j <= lanes; j++) {
    const xb = vpX + j * spread;
    const col = pal(0.5 + j / lanes * 0.5);
    const lg = ctx.createLinearGradient(0, hz, 0, H);
    lg.addColorStop(0, `rgba(${col}, 0.05)`); lg.addColorStop(1, `rgba(${col}, ${0.85 * flash})`);
    ctx.strokeStyle = lg; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(vpX + j * spread * 0.035, hz); ctx.lineTo(xb, H); ctx.stroke();
  }
}

// ================================================================== theme: WARP (hyperspace)
// Stars stream past at a speed set by the music (a "jump" on the drop), neon rings fly through
// the tunnel on beats, and a wormhole glows in the middle with spiral arms and a round spectrum.
const WP = {
  stars: Array.from({ length: 700 }, () => warpStar(Math.random())),
  rings: [], speed: 0.4, rot: 0, lastRing: 0,
};
function warpStar(z) {
  const a = Math.random() * Math.PI * 2, r = 0.05 + Math.pow(Math.random(), 0.6) * 1.6;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: z ?? 1, c: Math.random() };
}
function drawWarp(dt, t, kick) {
  const cx = W / 2, cy = H / 2, F = Math.max(W, H) * 0.5, b = AU.bass, lvl = AU.level;
  const target = isPlaying() ? 0.25 + lvl * 0.7 + b * 1.6 + AU.flash * 1.2 : 0.12;
  WP.speed += (target - WP.speed) * 0.08;
  WP.rot += dt / 1000 * (0.15 + b * 0.6);

  // deep space + a soft nebula in the palette
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.55);
  g.addColorStop(0, `rgba(${pal(0.5)}, ${0.16 + b * 0.18})`);
  g.addColorStop(0.5, `rgba(${pal(0.2)}, 0.05)`);
  g.addColorStop(1, `rgba(${pal(0.9)}, 0.08)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // star streaks, batched by colour and brightness
  const B = 6, A = 4, paths = Array.from({ length: B * A }, () => new Path2D()), used = new Uint8Array(B * A);
  const dz = dt / 1000 * WP.speed * 0.55, tail = 0.01 + WP.speed * 0.045;
  for (let i = 0; i < WP.stars.length; i++) {
    const s = WP.stars[i];
    s.z -= dz;
    if (s.z <= 0.02) { WP.stars[i] = warpStar(1); continue; }
    const px = cx + s.x / s.z * F * 0.35, py = cy + s.y / s.z * F * 0.35;
    if (px < -50 || px > W + 50 || py < -50 || py > H + 50) { WP.stars[i] = warpStar(1); continue; }
    const z2 = s.z + tail;
    const qx = cx + s.x / z2 * F * 0.35, qy = cy + s.y / z2 * F * 0.35;
    const near = clamp(1 - s.z, 0, 1);
    const k = Math.min(B - 1, Math.floor(s.c * B)) * A + Math.min(A - 1, Math.floor(Math.pow(near, 1.3) * A));
    paths[k].moveTo(qx, qy); paths[k].lineTo(px, py); used[k] = 1;
  }
  ctx.lineCap = 'round';
  for (let k = 0; k < B * A; k++) {
    if (!used[k]) continue;
    const ci = Math.floor(k / A), ai = k % A;
    ctx.strokeStyle = `rgba(${palHot(ci / (B - 1), 0.45)}, ${0.25 + ai * 0.25})`;
    ctx.lineWidth = 0.6 + ai * 0.7;
    ctx.stroke(paths[k]);
  }

  // neon rings flying through the tunnel (one per beat, plus a slow steady stream)
  if ((kick || t - WP.lastRing > 1400 / (0.4 + WP.speed)) && WP.rings.length < 10 && isPlaying()) {
    WP.lastRing = t;
    WP.rings.push({ z: 1, c: Math.random(), sides: Math.random() < 0.5 ? 6 : 0, spin: (Math.random() - 0.5) * 0.6 });
  }
  for (let i = WP.rings.length - 1; i >= 0; i--) {
    const r = WP.rings[i];
    r.z -= dz * 0.9;
    if (r.z <= 0.04) { WP.rings.splice(i, 1); continue; }
    const rad = 0.42 / r.z * F * 0.35;
    const near = clamp(1 - r.z, 0, 1);
    const col = pal(r.c);
    ctx.strokeStyle = `rgba(${col}, ${near * 0.18})`; ctx.lineWidth = 2 + near * 18;
    ringPath(cx, cy, rad, r.sides, WP.rot * r.spin * 3); ctx.stroke();
    ctx.strokeStyle = `rgba(${palHot(r.c, 0.35)}, ${near * 0.75})`; ctx.lineWidth = 1 + near * 3;
    ringPath(cx, cy, rad, r.sides, WP.rot * r.spin * 3); ctx.stroke();
  }

  if (ROLE !== 'main') return;
  // the wormhole: spiral arms, round spectrum, glowing core
  const R0 = Math.min(W, H) * 0.075 * (1 + b * 0.35);
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let s = 0; s <= 60; s++) {
      const u = s / 60, r = R0 * (0.8 + u * 4.5), a = WP.rot * 2 + arm * Math.PI / 2 + u * 3.4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = `rgba(${pal(arm / 3)}, ${0.18 + lvl * 0.22})`; ctx.lineWidth = 2.5 + b * 4; ctx.stroke();
  }
  const NBR = 96;
  for (let i = 0; i < NBR; i++) {
    const k = i < NBR / 2 ? i : NBR - 1 - i;
    const v = AU.bands[Math.floor(k / (NBR / 2) * (NB - 1))];
    const a = i / NBR * Math.PI * 2 - Math.PI / 2, r0 = R0 * 1.35, r1 = r0 + v * Math.min(W, H) * 0.13 + 2;
    ctx.strokeStyle = `rgba(${pal(k / (NBR / 2))}, ${0.35 + v * 0.55})`; ctx.lineWidth = Math.max(2, R0 * 0.05);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
  }
  g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R0 * 1.25);
  g.addColorStop(0, `rgba(255, 255, 255, ${0.9})`);
  g.addColorStop(0.35, `rgba(${palHot(0.5, 0.5)}, ${0.75 + b * 0.25})`);
  g.addColorStop(1, `rgba(${pal(0.5)}, 0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R0 * 1.25, 0, Math.PI * 2); ctx.fill();
  drawNote({ x: cx, y: cy, R: R0 * 1.7 });
}
function ringPath(cx, cy, r, sides, rot) {
  ctx.beginPath();
  if (!sides) { ctx.arc(cx, cy, r, 0, Math.PI * 2); return; }
  for (let i = 0; i <= sides; i++) {
    const a = rot + i / sides * Math.PI * 2;
    i ? ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

// ================================================================== frame loop
let last = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = last ? Math.min(50, t - last) : 16;
  last = t;
  const kick = listen(t);
  const L = lights();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const theme = settings.partyTheme || 'club';
  if (theme === 'synthwave') drawSynthwave(dt, t, kick);
  else if (theme === 'warp') drawWarp(dt, t, kick);
  else {
    if (L.glow) drawGlow();
    if (L.beams) drawBeams(t);
    if (L.particles) drawParticles(dt, t);
    drawEqualizer();
    if (ROLE === 'main') {
      const c = centre();
      emitSparks(kick, dt, c);
      drawSparks(dt, c);
      if ((settings.artFx || 'sun') === 'sun') drawSun(c, kick); else drawOrb(c, dt, t);
      drawNote(c);
    }
  }
  const art = $('bgArt');
  if (art.classList.contains('on')) art.style.transform = `scale(${(1 + AU.bass * 0.035).toFixed(4)})`;
  updateProgress();
}

// ================================================================== now playing + controls
let mediaKey = '';
function mediaPos() {
  const m = media;
  if (!m.active) return 0;
  let p = m.position || 0;
  if (m.status === 'Playing') p += (Date.now() - (m.updatedAt > 946684800000 ? m.updatedAt : m.receivedAt)) / 1000;
  return m.duration > 0 ? clamp(p, 0, m.duration) : Math.max(0, p);
}
function onMedia(m) {
  if (m.active && m.thumb === undefined && media.thumbId === m.thumbId) m.thumb = media.thumb;
  m.receivedAt = Date.now();
  media = m;
  const key = m.active && m.title ? `${m.title}|${m.artist}` : '';
  $('title').textContent = m.active ? (m.title || 'Unknown title') : 'Nothing playing';
  $('artist').textContent = m.active ? (m.artist || '') : '';
  $('art').style.backgroundImage = m.thumb ? `url('${m.thumb}')` : '';
  $('art').innerHTML = m.thumb ? '' : icon('music');
  $('play').innerHTML = icon(isPlaying() ? 'pause' : 'play');
  applyArt();
  if (key && key !== mediaKey && ROLE === 'main') showToast(m);
  mediaKey = key;
}
let toastTimer = 0;
function showToast(m) {
  $('toastTitle').textContent = m.title || '';
  $('toastArtist').textContent = m.artist || '';
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
}
function updateProgress() {
  if (document.body.classList.contains('idle') || !media.active || !(media.duration > 0)) return;
  const p = mediaPos();
  $('pos').textContent = fmt(p); $('dur').textContent = fmt(media.duration);
  $('fill').style.width = (100 * p / media.duration).toFixed(2) + '%';
}
$('play').addEventListener('click', () => api.media('toggle'));
$('prev').addEventListener('click', () => api.media('prev'));
$('next').addEventListener('click', () => api.media('next'));
$('bar').addEventListener('click', e => {
  if (!media.canSeek || !(media.duration > 0)) return;
  const r = e.currentTarget.getBoundingClientRect();
  api.media('seek', (clamp((e.clientX - r.left) / r.width, 0, 1) * media.duration).toFixed(1));
});
$('exit').addEventListener('click', () => api.partyStop());

// light + centre chips (saved to settings, so every screen and the notch follow)
// album art: blurred backdrop in Club, inside the sun in Synthwave, not used in Warp
function applyArt() {
  const theme = settings.partyTheme || 'club';
  const bg = $('bgArt');
  const want = lights().albumArt && media.thumb;
  if (want && theme === 'club') { if (bg.getAttribute('src') !== media.thumb) bg.src = media.thumb; bg.classList.add('on'); }
  else bg.classList.remove('on');
  if (want && SW.imgSrc !== media.thumb) { SW.imgSrc = media.thumb; SW.img.src = media.thumb; }
}
function applyChips() {
  const L = lights();
  const theme = settings.partyTheme || 'club';
  document.body.dataset.theme = theme;
  document.querySelectorAll('#chips [data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === theme));
  document.querySelectorAll('[data-light]').forEach(b => b.classList.toggle('on', !!L[b.dataset.light]));
  const fx = (settings.artFx || 'sun') === 'sun' ? 'sun' : 'orb';
  document.querySelectorAll('[data-fx]').forEach(b => b.classList.toggle('on', b.dataset.fx === fx));
  applyArt();
}
$('chips').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.theme) settings = await api.setSettings({ partyTheme: b.dataset.theme });
  if (b.dataset.light) settings = await api.setSettings({ partyLights: { ...lights(), [b.dataset.light]: !lights()[b.dataset.light] } });
  if (b.dataset.fx) settings = await api.setSettings({ artFx: b.dataset.fx });
  computeStops(); applyChips();
});

// show the controls while the mouse moves, hide them (and the cursor) when it rests
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2800);
}
window.addEventListener('mousemove', wake);
window.addEventListener('mousedown', wake);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { api.partyStop(); return; }
  if (e.key === ' ') { e.preventDefault(); api.media('toggle'); }
  if (e.key === 'ArrowRight') api.media('next');
  if (e.key === 'ArrowLeft') api.media('prev');
  wake();
});

api.on('media', onMedia);
api.on('settings', s => { settings = s; computeStops(); applyChips(); });
api.on('accent', a => { accent = a; computeStops(); });

(async function boot() {
  hydrateIcons();
  const init = await api.partyInit();
  settings = init.settings || {};
  accent = init.accent || accent;
  computeStops();
  applyChips();
  if (init.media) onMedia(init.media);
  wake();
  startAudio();
  requestAnimationFrame(frame);
  window.__party = { AU, settings: () => settings, onMedia };
})();
