'use strict';
/* NotchMine ambient screen: while a movie (any full-screen app) plays on one screen, this window fills another
   screen with its colours, changing with every scene, and moves to its sound.

   main.js opens one per other screen and says which screen to watch (sourceId) and on which side of this one it is
   (side: the movie's colours spill in from that edge, mirrored like light from the next screen). The movie screen is
   captured at a tiny size (256 × 144 at most, a few times a second, never saved or sent anywhere) and read here:
     - a 12 × 7 grid of its colours (black letterbox / pillarbox bars are cut off first),
     - its three main colours (vivid ones count more than greys),
     - scene cuts (the grid changes a lot at once): the colours then jump instead of drifting.
   A protected video (Netflix and the like in a browser) captures as black: after a while the colours follow the
   "Visualizer colours" palette instead, so the screen still moves to the sound.

   Looks (Settings → Ambient → Look): glow · reflect · mood · edge · lava · solid. On top: any equalizer style from
   eqstyles.js, coloured by the scene. Click-through; it fades away while the mouse is on its screen. */

const api = window.notch;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);
let settings = {}, accent = '167, 139, 250', media = { active: false };
let info = { sourceId: '', side: 'left', preview: false }, peek = false;
const pct = (k, d) => clamp((settings[k] ?? d) / 100, 0, 1);

// ================================================================ capture (the movie's screen, tiny)
const video = document.createElement('video');
video.muted = true;
const GW = 48, GH = 27;                                    // what the colours are read from
const grab = document.createElement('canvas');
grab.width = GW; grab.height = GH;
const gx = grab.getContext('2d', { willReadFrequently: true });
let stream = null, capId = '', fresh = false;
async function capture(id) {
  if (id === capId) return;
  capId = id;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  if (!id) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 256, maxHeight: 144, maxFrameRate: 24 } },
    });
    if (capId !== id) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    await video.play().catch(() => {});
    watchFrames();
  } catch (e) { console.warn('Ambient: screen capture failed:', e && e.message); }
}
function watchFrames() {
  if (!video.requestVideoFrameCallback) { fresh = true; return; }
  const on = () => { fresh = true; if (stream) video.requestVideoFrameCallback(on); };
  video.requestVideoFrameCallback(on);
}

// ================================================================ reading the picture
const CX = 12, CY = 7;
const cellT = new Float32Array(CX * CY * 3), cellC = new Float32Array(CX * CY * 3), cellPrev = new Float32Array(CX * CY * 3);
const palT = new Float32Array(9), palC = new Float32Array(9);   // three main colours, 0…1
let lumT = 0, lumC = 0, cutAt = -1e9, darkSince = 0, blackout = false, readOnce = false;

function analyse(now) {
  gx.drawImage(video, 0, 0, GW, GH);
  const d = gx.getImageData(0, 0, GW, GH).data;
  // letterbox / pillarbox: rows and columns that are (nearly) black all the way across
  const px = (x, y) => { const i = (y * GW + x) * 4; return d[i] + d[i + 1] + d[i + 2]; };
  const rowLit = y => { for (let x = 0; x < GW; x++) if (px(x, y) > 36) return true; return false; };
  const colLit = x => { for (let y = 0; y < GH; y++) if (px(x, y) > 36) return true; return false; };
  let y0 = 0, y1 = GH - 1, x0 = 0, x1 = GW - 1;
  while (y0 < y1 && !rowLit(y0)) y0++;
  while (y1 > y0 && !rowLit(y1)) y1--;
  while (x0 < x1 && !colLit(x0)) x0++;
  while (x1 > x0 && !colLit(x1)) x1--;
  // real bars are even (top ≈ bottom) and leave most of the picture; a dark scene with only subtitles lit isn't one
  if (y1 - y0 < GH * 0.5 || Math.abs(y0 - (GH - 1 - y1)) > 3) { y0 = 0; y1 = GH - 1; }
  if (x1 - x0 < GW * 0.5 || Math.abs(x0 - (GW - 1 - x1)) > 3) { x0 = 0; x1 = GW - 1; }
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 36) lit++;
  litT = lit / (GW * GH);

  // the grid
  const cw = (x1 - x0 + 1) / CX, ch = (y1 - y0 + 1) / CY;
  for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
    let r = 0, g = 0, b = 0, n = 0;
    const ya = y0 + Math.floor(cy * ch), yb = Math.max(ya + 1, y0 + Math.floor((cy + 1) * ch));
    const xa = x0 + Math.floor(cx * cw), xb = Math.max(xa + 1, x0 + Math.floor((cx + 1) * cw));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { const i = (y * GW + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    const k = (cy * CX + cx) * 3;
    cellT[k] = r / n / 255; cellT[k + 1] = g / n / 255; cellT[k + 2] = b / n / 255;
  }

  lumT = mainColours(d, GW, x0, y0, x1, y1, palT);

  // a scene cut: the grid changes a lot at once
  if (readOnce) {
    let diff = 0;
    for (let i = 0; i < cellT.length; i++) diff += Math.abs(cellT[i] - cellPrev[i]);
    if (diff / cellT.length > 0.14 && now - cutAt > 700) { cutAt = now; flash = settings.ambCutFlash !== false ? 1 : 0; }
  }
  cellPrev.set(cellT);
  readOnce = true;

  // (almost) nothing lit for a long time: a protected video (Prime Video, Netflix… in a browser) captures as plain
  // black → the film's artwork (or the music palette) takes over. A dark scene still has dim detail or subtitles,
  // and a fade to black is over in a few seconds.
  if (litT < 0.03) { if (!darkSince) darkSince = now; } else darkSince = 0;
  const was = blackout;
  blackout = !!darkSince && now - darkSince > 6000;
  if (blackout && !was) noteLater = now + 4000;
  if (!blackout) { noteLater = 0; showNote(''); }
  if (DEV && now - devLogAt > 5000) {
    devLogAt = now;
    const hex = p => '#' + [0, 1, 2].map(c => Math.round(palT[p * 3 + c] * 255).toString(16).padStart(2, '0')).join('');
    console.log(`[ambient] ${video.videoWidth}x${video.videoHeight} lum=${lumT.toFixed(3)} lit=${(litT * 100).toFixed(0)}% crop=${x0},${y0}-${x1},${y1} colours=${hex(0)} ${hex(1)} ${hex(2)}${blackout ? (art ? ' (black: artwork colours)' : ' (black: music colours)') : ''}`);
  }
}
let litT = 1, devLogAt = 0, DEV = false;

// the three main colours of an RGBA pixel block (into out, 0…1): hue buckets, vivid pixels weigh more, greys share
// one bucket. Returns the average brightness.
function mainColours(d, stride, x0, y0, x1, y1, out) {
  const B = 12, w = new Float32Array(B + 1), sr = new Float32Array(B + 1), sg = new Float32Array(B + 1), sb = new Float32Array(B + 1);
  let lum = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * stride + x) * 4, r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
    lum += 0.299 * r + 0.587 * g + 0.114 * b; n++;
    let bucket = B;
    if (s > 0.2 && mx > 0.08) {
      let h;
      if (mx === r) h = ((g - b) / (mx - mn)) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
      bucket = Math.floor(((h + 6) % 6) / 6 * B) % B;
    }
    const wt = 0.04 + s * s * mx * 1.6;
    w[bucket] += wt; sr[bucket] += r * wt; sg[bucket] += g * wt; sb[bucket] += b * wt;
  }
  const order = [...w.keys()].filter(i => w[i] > 0).sort((a, b) => w[b] - w[a]);
  for (let p = 0; p < 3; p++) {
    const i = order[p] ?? order[0];
    if (i === undefined) { out[p * 3] = out[p * 3 + 1] = out[p * 3 + 2] = 0; continue; }
    if (order[p] === undefined) {                           // fewer colours than three: a lighter / darker shade of the first
      const f = p === 1 ? 1.35 : 0.65;
      out[p * 3] = clamp(sr[i] / w[i] * f, 0, 1); out[p * 3 + 1] = clamp(sg[i] / w[i] * f, 0, 1); out[p * 3 + 2] = clamp(sb[i] / w[i] * f, 0, 1);
    } else { out[p * 3] = sr[i] / w[i]; out[p * 3 + 1] = sg[i] / w[i]; out[p * 3 + 2] = sb[i] / w[i]; }
  }
  return n ? lum / n : 0;
}

// ---- the film's artwork (the poster / thumbnail the player shows in Windows' media controls): when the picture
// itself can't be read, its colours stand in, laid out like the poster, breathing and moving with the sound
let art = null, artSrc = '';                                   // { pal: Float32Array(9), cells: Float32Array }
function loadArt(src) {
  if (src === artSrc) return;
  artSrc = src || '';
  art = null;
  if (!src) return;
  const img = new Image();
  img.onload = () => {
    if (artSrc !== src) return;
    const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
    c.width = 32; c.height = 32;
    x.drawImage(img, 0, 0, 32, 32);
    const pal = new Float32Array(9);
    mainColours(x.getImageData(0, 0, 32, 32).data, 32, 0, 0, 31, 31, pal);
    c.width = CX; c.height = CY;
    x.drawImage(img, 0, 0, CX, CY);
    const d = x.getImageData(0, 0, CX, CY).data, cells = new Float32Array(CX * CY * 3);
    for (let i = 0; i < CX * CY; i++) { cells[i * 3] = d[i * 4] / 255; cells[i * 3 + 1] = d[i * 4 + 1] / 255; cells[i * 3 + 2] = d[i * 4 + 2] / 255; }
    art = { pal, cells };
  };
  img.src = src;
}
function artPalette(t) {
  palT.set(art.pal);
  const sway = Math.sin(t / 6000) * 0.5 + 0.5;              // the poster's colours drift slowly from side to side
  for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
    const sx = Math.round(clamp(cx + (sway - 0.5) * 3, 0, CX - 1)), k = (cy * CX + cx) * 3, s = (cy * CX + sx) * 3;
    for (let c = 0; c < 3; c++) cellT[k + c] = art.cells[s + c];
  }
  lumT = 0.3;
}

// the "Visualizer colours" palette (when the picture can't be read)
const PRESETS = {
  rainbow: ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#bf5af2'],
  sunset: ['#ff5f6d', '#ff9966', '#ffc371'], ocean: ['#00c6ff', '#0072ff', '#7b5cff'],
  neon: ['#ff00cc', '#7a5cff', '#00f0ff'], fire: ['#ff2a00', '#ff7b00', '#ffd000'],
  aurora: ['#30d0c0', '#7b5cff', '#ff3787'],
};
const hexRgb = h => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map(i => parseInt(m[i], 16) / 255) : null; };
function musicPalette(t) {
  const mode = settings.vizPalette || 'accent';
  let s = null;
  if (mode === 'custom') s = (settings.vizCustom || []).slice(0, clamp(settings.vizCustomCount || 3, 1, 3)).map(hexRgb).filter(Boolean);
  else if (PRESETS[mode]) s = PRESETS[mode].map(hexRgb);
  if (!s || !s.length) s = [accent.split(',').map(v => Number(v) / 255)];
  const shift = (t / 9000) % 1;                             // drifts slowly through the palette
  for (let p = 0; p < 3; p++) {
    const c = s[Math.floor((p / 3 + shift) * s.length) % s.length];
    palT.set(c, p * 3);
  }
  for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
    const k = (cy * CX + cx) * 3, x = (cx / (CX - 1) + shift) % 1, i = Math.floor(x * 3) % 3, j = (i + 1) % 3, f = x * 3 - Math.floor(x * 3);
    for (let c = 0; c < 3; c++) cellT[k + c] = (palT[i * 3 + c] * (1 - f) + palT[j * 3 + c] * f) * (0.55 + 0.45 * Math.sin(cy / CY * Math.PI));
  }
  lumT = 0.3;
}

// ================================================================ sound
const AU = { an: null, ctx: null, data: null, td: null, peak: 0.6, bassPeak: 0.5 };
const beatOf = makeBeatDetector();
let bass = 0, kick = false, soundVis = 0, synthT = 0;
function startAudio() {
  const an = AUDIO_FEED.an;
  Object.assign(AU, { an, ctx: AUDIO_FEED.ctx, data: new Uint8Array(an.frequencyBinCount), td: new Uint8Array(an.fftSize) });
}
let N = 0, vals = new Float32Array(0), peaks = new Float32Array(0), peakV = new Float32Array(0);
function spectrum(t, dt, W) {
  const n = clamp(Math.round(W / 21), 40, 160);
  if (n !== N) { N = n; vals = new Float32Array(n); peaks = new Float32Array(n); peakV = new Float32Array(n); }
  const half = Math.ceil(N / 2), target = new Float32Array(half);
  let level = 0;
  if (AUDIO_FEED.live()) {
    const d = AU.data, hz = AU.ctx.sampleRate / AU.an.fftSize;
    AU.an.getByteFrequencyData(d);
    let bs = 0, bn = 0;
    for (let b = Math.max(1, Math.floor(40 / hz)); b <= Math.ceil(170 / hz); b++) { bs += d[b]; bn++; }
    const raw = bn ? bs / bn / 255 : 0;
    AU.bassPeak = Math.max(raw, Math.max(0.45, AU.bassPeak * 0.996));
    bass = clamp((raw - 0.3) / (AU.bassPeak - 0.3), 0, 1);
    let mx = 0;
    for (let i = 0; i < half; i++) {
      const f0 = 32 * Math.pow(16000 / 32, i / half), f1 = 32 * Math.pow(16000 / 32, (i + 1) / half);
      let m = 0;
      for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < d.length; b++) m = Math.max(m, d[b]);
      target[i] = m / 255 + (i / half) * 0.14;
      mx = Math.max(mx, target[i]);
      level += m;
    }
    AU.peak = Math.max(mx, Math.max(0.5, AU.peak * 0.996));
    for (let i = 0; i < half; i++) target[i] = clamp((target[i] - 0.3) / (AU.peak - 0.3), 0, 1);
    level /= half * 255;
  } else bass = 0;
  const sound = level > 0.04;                               // something is audible (a film's own player may not report "playing")
  soundVis += ((sound ? 1 : 0) - soundVis) * (sound ? 0.08 : 0.03);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);                   // bass in the middle
    const v = target[Math.min(half - 1, Math.floor(k * (half - 1) + 0.5))] || 0;
    vals[i] += (v - vals[i]) * (v > vals[i] ? 0.55 : 0.16);
    if (vals[i] >= peaks[i]) { peaks[i] = vals[i]; peakV[i] = 0; } else { peakV[i] += dt * 0.0000025; peaks[i] = Math.max(vals[i], peaks[i] - peakV[i] * dt); }
  }
  kick = beatOf(bass, t);
}

// ================================================================ colour grading
// colour boost + brightness, and dark colours lifted (a night scene still glows, in its own hue)
function grade(r, g, b, out, o, extra = 1) {
  const sat = pct('ambSat', 40), bright = (0.25 + pct('ambBright', 70) * 1.1) * extra;
  const l = 0.299 * r + 0.587 * g + 0.114 * b, sb = 1 + sat * 1.6;
  r = clamp(l + (r - l) * sb, 0, 1); g = clamp(l + (g - l) * sb, 0, 1); b = clamp(l + (b - l) * sb, 0, 1);
  const m = Math.max(r, g, b);
  const lift = m > 0.01 ? (m + (1 - m) * 0.3) / m : 0;
  out[o] = clamp(r * lift * bright, 0, 1) * 255; out[o + 1] = clamp(g * lift * bright, 0, 1) * 255; out[o + 2] = clamp(b * lift * bright, 0, 1) * 255;
}
const tmp3 = new Float32Array(3);
function palRgb(p, extra = 1) { grade(palC[p * 3], palC[p * 3 + 1], palC[p * 3 + 2], tmp3, 0, extra); return `${tmp3[0] | 0}, ${tmp3[1] | 0}, ${tmp3[2] | 0}`; }

// ================================================================ drawing
const bg = $('bg'), bx = bg.getContext('2d');
const eqc = $('eq'), ex = eqc.getContext('2d');
const grid = document.createElement('canvas'); grid.width = CX; grid.height = CY;
const gridx = grid.getContext('2d');
const gridImg = gridx.createImageData(CX, CY);
let W = 0, H = 0, BW = 0, BH = 0, EW = 0, EH = 0, DPR = 1;
function resize() {
  W = innerWidth; H = innerHeight; DPR = devicePixelRatio || 1;
  BW = Math.max(32, Math.round(W / 10)); BH = Math.max(18, Math.round(H / 10));   // the glow is soft: a tenth of the size is plenty
  bg.width = BW; bg.height = BH;
  EW = W; EH = Math.round(H * 0.7);
  eqc.width = Math.round(EW * DPR); eqc.height = Math.round(EH * DPR);
}
addEventListener('resize', resize);
resize();

// the movie's picture is mirrored across the edge the two screens share, like light spilling over
function mirror(c, w, h) {
  if (info.side === 'left' || info.side === 'right') { c.translate(w, 0); c.scale(-1, 1); } else { c.translate(0, h); c.scale(1, -1); }
}
// darker away from the shared edge (0 = none … 1 = black at the far side)
function falloff(c, w, h, amount, reach = 1) {
  const s = info.side;
  const g = s === 'left' ? c.createLinearGradient(0, 0, w * reach, 0) : s === 'right' ? c.createLinearGradient(w, 0, w - w * reach, 0)
    : s === 'top' ? c.createLinearGradient(0, 0, 0, h * reach) : c.createLinearGradient(0, h, 0, h - h * reach);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${amount})`);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function paintGrid(extra) {
  for (let i = 0; i < CX * CY; i++) { grade(cellC[i * 3], cellC[i * 3 + 1], cellC[i * 3 + 2], gridImg.data, i * 4, extra); gridImg.data[i * 4 + 3] = 255; }
  gridx.putImageData(gridImg, 0, 0);
}

let flash = 0, noteLater = 0;
const blobs = Array.from({ length: 6 }, (_, i) => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00004, vy: (Math.random() - 0.5) * 0.00004, r: 0.25 + Math.random() * 0.2, p: i % 3, ph: Math.random() * 6 }));

const LOOKS = {
  glow(extra) {                                             // the movie's colours, mirrored and softly blurred
    paintGrid(extra);
    bx.save(); mirror(bx, BW, BH); bx.filter = `blur(${Math.round(BW / 14)}px)`;
    bx.drawImage(grid, -BW * 0.1, -BH * 0.1, BW * 1.2, BH * 1.2); bx.restore();
    falloff(bx, BW, BH, 0.45);
  },
  reflect(extra) {                                          // the picture itself, mirrored and blurred
    if (blackout || !video.videoWidth) { LOOKS.glow(extra); return; }
    const sat = pct('ambSat', 40), bright = (0.35 + pct('ambBright', 70) * 1.0) * extra;
    bx.save(); mirror(bx, BW, BH);
    bx.filter = `blur(${Math.max(1, Math.round(BW / 90))}px) saturate(${1 + sat * 1.4}) brightness(${bright.toFixed(2)})`;
    bx.drawImage(video, 0, 0, BW, BH); bx.restore();
    falloff(bx, BW, BH, 0.55);
  },
  edge(extra) {                                             // only a band of light along the shared edge
    LOOKS.glow(extra * 1.15);
    bx.globalCompositeOperation = 'destination-in';
    const s = info.side, g = s === 'left' ? bx.createLinearGradient(0, 0, BW * 0.45, 0) : s === 'right' ? bx.createLinearGradient(BW, 0, BW * 0.55, 0)
      : s === 'top' ? bx.createLinearGradient(0, 0, 0, BH * 0.5) : bx.createLinearGradient(0, BH, 0, BH * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    bx.fillStyle = g; bx.fillRect(0, 0, BW, BH);
    bx.globalCompositeOperation = 'source-over';
  },
  mood(extra, t) {                                          // the scene's three colours, drifting
    bx.fillStyle = `rgba(${palRgb(0, extra * 0.35)}, 1)`; bx.fillRect(0, 0, BW, BH);
    bx.globalCompositeOperation = 'lighter';
    for (let p = 0; p < 3; p++) {
      const x = BW * (0.5 + 0.38 * Math.sin(t / (7000 + p * 2300) + p * 2.1)), y = BH * (0.5 + 0.34 * Math.cos(t / (8300 + p * 1900) + p));
      const r = Math.max(BW, BH) * (0.55 + 0.1 * Math.sin(t / 3000 + p));
      const g = bx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${palRgb(p, extra)}, .75)`); g.addColorStop(1, `rgba(${palRgb(p, extra)}, 0)`);
      bx.fillStyle = g; bx.fillRect(0, 0, BW, BH);
    }
    bx.globalCompositeOperation = 'source-over';
  },
  lava(extra, t, dt) {                                      // big soft blobs that swell on the beat
    bx.fillStyle = `rgba(${palRgb(0, extra * 0.18)}, 1)`; bx.fillRect(0, 0, BW, BH);
    bx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0.05 || b.x > 0.95) b.vx *= -1;
      if (b.y < 0.05 || b.y > 0.95) b.vy *= -1;
      const r = Math.max(BW, BH) * b.r * (1 + 0.25 * Math.sin(t / 1800 + b.ph) + bass * 0.35 * (settings.ambPulse !== false ? 1 : 0));
      const g = bx.createRadialGradient(b.x * BW, b.y * BH, 0, b.x * BW, b.y * BH, r);
      g.addColorStop(0, `rgba(${palRgb(b.p, extra)}, .7)`); g.addColorStop(0.6, `rgba(${palRgb(b.p, extra)}, .25)`); g.addColorStop(1, `rgba(${palRgb(b.p, extra)}, 0)`);
      bx.fillStyle = g; bx.fillRect(0, 0, BW, BH);
    }
    bx.globalCompositeOperation = 'source-over';
  },
  solid(extra) {                                            // one colour: the scene's main one
    bx.fillStyle = `rgba(${palRgb(0, extra)}, 1)`; bx.fillRect(0, 0, BW, BH);
    const g = bx.createRadialGradient(BW / 2, BH / 2, Math.min(BW, BH) * 0.3, BW / 2, BH / 2, Math.max(BW, BH) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    bx.fillStyle = g; bx.fillRect(0, 0, BW, BH);
  },
};

const drawEq = makeEqStyles();
// the equalizer's palette: the scene's colours, bright (graded once a frame, in eqCols)
const eqCols = [new Float32Array(3), new Float32Array(3), new Float32Array(3)];
function gradeEqCols() { for (let p = 0; p < 3; p++) grade(palC[p * 3], palC[p * 3 + 1], palC[p * 3 + 2], eqCols[p], 0, 1.25); }
const eqPal = t => { const x = clamp(t, 0, 1) * 2, i = Math.min(1, Math.floor(x)), f = x - i, a = eqCols[i], b = eqCols[i + 1]; return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)); };
const pal = t => eqPal(t).join(', ');
const hot = (t, w) => eqPal(t).map(v => Math.round(v + (255 - v) * w)).join(', ');

let last = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (peek || !document.body.classList.contains('on')) { last = t; return; }   // faded away: nothing to draw
  if (t - last < 30) return;                                // about 30 frames a second is smooth enough for light
  const dt = last ? Math.min(100, t - last) : 33;
  last = t;

  if (fresh && video.readyState >= 2) { fresh = false; analyse(t); }
  if (blackout || !stream) { if (art) artPalette(t); else musicPalette(t); }
  if (blackout && noteLater && t > noteLater) {
    noteLater = 0;
    showNote(art ? 'This video is protected from screen capture, so the colours come from its artwork and the sound'
      : 'This video is protected from screen capture, so the colours follow the music', 7000);
  }

  // follow the picture: slowly within a scene, at once on a cut
  const sp = pct('ambSpeed', 50);
  let tau = 60 + 1500 * (1 - sp) * (1 - sp);
  if (t - cutAt < 450) tau = Math.min(tau, 70);
  const k = 1 - Math.exp(-dt / tau);
  for (let i = 0; i < cellC.length; i++) cellC[i] += (cellT[i] - cellC[i]) * k;
  for (let i = 0; i < 9; i++) palC[i] += (palT[i] - palC[i]) * k;
  lumC += (lumT - lumC) * k;

  spectrum(t, dt, EW);
  const pulse = settings.ambPulse !== false ? 1 + bass * 0.28 * soundVis + (kick ? 0.12 : 0) : 1;
  const extra = pulse * (blackout ? 0.75 : 1);

  bx.setTransform(1, 0, 0, 1, 0, 0);
  bx.filter = 'none';
  bx.clearRect(0, 0, BW, BH);
  (LOOKS[settings.ambStyle] || LOOKS.glow)(extra, t, dt);
  if (flash > 0.01) {                                       // scene cut: a soft flash in the new colour
    bx.fillStyle = `rgba(${palRgb(0, 1.4)}, ${flash * 0.35})`; bx.fillRect(0, 0, BW, BH);
    flash *= Math.exp(-dt / 220);
  }

  // the equalizer, in the scene's colours
  ex.setTransform(DPR, 0, 0, DPR, 0, 0);
  ex.clearRect(0, 0, EW, EH);
  const style = settings.ambEq || 'bars';
  if (style !== 'none' && soundVis > 0.01) {
    gradeEqCols();
    const P = {
      inten: 0.8, mirror: true, a: soundVis * 0.9,
      maxH: EH * (0.12 + pct('ambEqHeight', 40) * 0.85),
      pt: i => Math.abs(i - (N - 1) / 2) / ((N - 1) / 2),
    };
    ex.globalCompositeOperation = 'lighter';
    drawEq({ ctx: ex, W: EW, H: EH, N, vals, peaks, pal, hot, playing: true, AU, synthT: (synthT += dt), kick, bass }, style, P, dt);
    ex.globalCompositeOperation = 'source-over';
  }
}

let noteT = 0;
function showNote(text, ms = 4000) {
  const el = $('note');
  clearTimeout(noteT);
  if (!text) { el.classList.remove('show'); return; }
  el.textContent = text;
  el.classList.add('show');
  noteT = setTimeout(() => el.classList.remove('show'), ms);
}

function applyInfo(i) {
  info = { ...info, ...i };
  capture(info.sourceId || '');
  if (info.preview) showNote('Preview: the colours come from your other screen', 5000);
}
api.on('amb-src', applyInfo);
api.on('amb-peek', p => { peek = !!p; document.body.classList.toggle('peek', peek); });
api.on('settings', s => { settings = s; });
api.on('accent', a => { accent = a; });
api.on('media', m => {
  if (m.active && m.thumb === undefined && media.thumbId === m.thumbId) m.thumb = media.thumb;   // the bridge sends artwork only when it changes
  media = m;
  loadArt(m.active ? m.thumb : '');
});

(async function boot() {
  const init = await api.ambInit();
  settings = init.settings || {};
  accent = init.accent || accent;
  if (init.media) { media = init.media; loadArt(media.active ? media.thumb : ''); }
  peek = !!init.peek;
  DEV = !!init.dev;
  document.body.classList.toggle('peek', peek);
  startAudio();
  applyInfo(init);
  requestAnimationFrame(frame);
  requestAnimationFrame(() => document.body.classList.add('on'));   // fades in
  window.__amb = { palC, cellC, info: () => info, blackout: () => blackout, lum: () => lumC };
})();
