'use strict';
/* NotchMine live wallpaper: one window per screen, placed behind the desktop icons by the bridge (see Desk in
   bridge.ps1). Settings → Wallpaper:
   - Automatic: the style follows the weather in your city (sunny, cloudy, rain, storm, snow; at night stars or aurora)
   - Choose myself: one style that stays (rain, storm, snow, sunny, cloudy, starry night, aurora, music)
   It draws at most 30 times a second, stops completely while a full-screen app, game or maximized window covers
   its screen (main.js tells it), and can hold still on battery. "Pulse with the music" listens to the system audio
   the same way the desktop equalizer does: analysed locally, never recorded. */

const api = window.notch;
const cv = document.getElementById('wp');
const ctx = cv.getContext('2d');
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let settings = {}, weather = null, paused = false, onBattery = false;
let W = 0, H = 0, K = 1;                         // K: size of this screen relative to the design (≈ 760 px wide)
let P = [], B = [], stars = [], flash = 0, nextFlash = 0, bolt = null, shoot = null, nextShoot = 0, styleKey = '';

// ---- which wallpaper: Automatic (weather) or the chosen style
// WMO weather code → wallpaper style, and how much falls from the sky (0..1)
function fromWeather(w) {
  if (!w) { const h = new Date().getHours(); return { style: h < 6 || h >= 18 ? 'night' : 'sunny', amt: 1 }; }
  const c = w.code, day = w.isDay !== false;
  if (c >= 95) return { style: 'storm', amt: 1 };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { style: 'snow', amt: c === 75 || c === 86 ? 1 : 0.7 };
  if (c >= 51 && c <= 57) return { style: 'rain', amt: 0.45 };                       // drizzle
  if (c === 65 || c === 67 || c === 82) return { style: 'rain', amt: 1.25 };         // heavy rain
  if ((c >= 61 && c <= 66) || c === 80 || c === 81) return { style: 'rain', amt: 0.85 };
  if (c === 0 || c === 1) return { style: day ? 'sunny' : 'night', amt: 1 };
  if (c === 2) return { style: day ? 'sunny' : 'night', amt: 0.6 };
  return { style: 'cloudy', amt: 1 };                                                // overcast, fog
}
function current() {
  if (settings.wpMode === 'manual') return { style: settings.wpStyle || 'rain', amt: 1 };
  const r = fromWeather(weather);
  if (r.style === 'night' && settings.wpNight === 'aurora') r.style = 'aurora';
  return r;
}
const amount = () => clamp((settings.wpAmount ?? 60) / 100, 0.1, 1) * current().amt;

// ---- audio: a gentle pulse on the beat (only while "Pulse with the music" or the Music style needs it)
const AU = { an: null, data: null, peak: 0.4, level: 0, beat: 0, prev: 0, starting: false };
// the sound comes from the notch's one capture (audiofeed.js), never a capture of our own
function startAudio() {
  if (!AU.an) Object.assign(AU, { an: AUDIO_FEED.an, ac: AUDIO_FEED.ctx, data: new Uint8Array(AUDIO_FEED.an.frequencyBinCount) });
}
const wantsAudio = () => settings.wpBeat !== false || current().style === 'music';
function listen() {
  if (!AU.an) { AU.level *= 0.9; AU.beat *= 0.85; return; }
  AU.an.getByteFrequencyData(AU.data);
  const hz = AU.ac.sampleRate / AU.an.fftSize;
  let s = 0, n = 0;
  for (let i = Math.max(1, Math.floor(40 / hz)); i <= Math.ceil(170 / hz); i++) { s += AU.data[i]; n++; }
  const bass = n ? s / n / 255 : 0;
  AU.peak = Math.max(bass, Math.max(0.3, AU.peak * 0.995));
  const v = clamp((bass - 0.15) / (AU.peak - 0.15), 0, 1);
  AU.beat = v > AU.prev + 0.12 && v > 0.55 ? 1 : AU.beat * 0.86;          // a kick: jump, then fade
  AU.prev = v;
  AU.level += (v - AU.level) * 0.3;
}
// the Music style's bars: the real spectrum, mirrored (bass in the middle)
function band(i, n) {
  if (!AU.an) return 0;
  const k = Math.abs(i - (n - 1) / 2) / (n / 2);
  const hz = AU.ac.sampleRate / AU.an.fftSize;
  const f0 = 50 * Math.pow(200, k), f1 = 50 * Math.pow(200, Math.min(1, k + 2 / n));
  let m = 0;
  for (let b = Math.max(1, Math.floor(f0 / hz)); b <= Math.ceil(f1 / hz) && b < AU.data.length; b++) m = Math.max(m, AU.data[b]);
  return clamp((m / 255 - 0.28) / 0.6, 0, 1);
}

// ---- scene setup
function size() {
  const d = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight; K = W / 760;
  cv.width = Math.round(W * d); cv.height = Math.round(H * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
  reset();
}
function reset() {
  const { style } = current(), k = amount();
  styleKey = style + '|' + k.toFixed(2);
  P = []; B = []; stars = [];
  const n = style === 'rain' ? 260 * k * K : style === 'storm' ? 380 * k * K : style === 'snow' ? 220 * k * K : style === 'sunny' ? 70 * k * K : style === 'cloudy' ? 6 + Math.round(K) : 0;
  for (let i = 0; i < n; i++) P.push(spawn(style, true));
  if (style === 'rain' || style === 'storm') for (let i = 0; i < 26 * Math.sqrt(K); i++) B.push({ x: rnd(0, W), y: rnd(H * .25, H * .9), r: rnd(W * .008, W * .035), c: Math.random() < .5 ? '255,190,120' : '120,180,255', a: rnd(.08, .25), ph: rnd(0, 6) });
  if (style === 'night' || style === 'aurora') for (let i = 0; i < 220 * K; i++) stars.push({ x: rnd(0, W), y: rnd(0, H * .8), r: rnd(.3, 1.3) * Math.sqrt(K) * .8, ph: rnd(0, 6), sp: rnd(.5, 2) });
  if (wantsAudio()) startAudio();
}
function spawn(style, any) {
  const s = Math.sqrt(K);
  if (style === 'rain' || style === 'storm') { const heavy = style === 'storm'; return { x: rnd(-.1, 1.1) * W, y: any ? rnd(0, H) : rnd(-.3, 0) * H, sp: (heavy ? rnd(900, 1300) : rnd(600, 900)) * H / 600, len: (heavy ? rnd(14, 26) : rnd(9, 18)) * s, a: rnd(.18, .5), w: (Math.random() < .2 ? 1.4 : 1) * Math.max(1, s * .7) }; }
  if (style === 'snow') return { x: rnd(0, W), y: any ? rnd(0, H) : -5, sp: rnd(18, 50) * H / 600, r: rnd(.8, 2.6) * s, ph: rnd(0, 6), sw: rnd(.5, 1.5), a: rnd(.5, .95) };
  if (style === 'sunny') return { x: rnd(0, W), y: any ? rnd(0, H) : H + 5, sp: rnd(6, 18) * s, r: rnd(.6, 1.8) * s, ph: rnd(0, 6), a: rnd(.25, .7) };
  if (style === 'cloudy') return { x: rnd(-.2, 1) * W, y: rnd(.05, .55) * H, s: rnd(.18, .38) * W, sp: rnd(4, 12) * s, a: rnd(.18, .32) };
  return {};
}
// ---- Background → My wallpaper: your own Windows wallpaper instead of the drawn sky, effects on top
let bg = null, bgStyle = '';
function setBg(url) {
  if (!url) { bg = null; redraw(); return; }
  const img = new Image();
  img.onload = () => { bg = img; redraw(); };
  img.onerror = () => { bg = null; console.warn('wallpaper: could not load your wallpaper'); redraw(); };
  img.src = url;
}
// a light veil per style so rain, snow and stars still show up over a bright picture
const VEIL = { rain: 'rgba(8,16,32,.32)', storm: 'rgba(6,6,20,.5)', snow: 'rgba(20,32,52,.22)', cloudy: 'rgba(70,80,96,.28)',
  night: 'rgba(4,5,26,.5)', aurora: 'rgba(2,4,12,.45)', music: 'rgba(7,6,15,.4)' };
function drawBg() {
  const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);      // fill the screen, like Windows' "Fill"
  const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
  ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
  if (VEIL[bgStyle]) { ctx.fillStyle = VEIL[bgStyle]; ctx.fillRect(0, 0, W, H); }
}
function sky(stops) {
  if (bg) { drawBg(); return; }
  const g = ctx.createLinearGradient(0, 0, 0, H); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function glow(x, y, r, c, a) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }

// ---- one frame
function draw(t, dt) {
  const { style } = current(), k = amount();
  if (style + '|' + k.toFixed(2) !== styleKey) reset();
  bgStyle = style;
  if (wantsAudio()) listen();
  const beat = settings.wpBeat !== false ? AU.beat : 0;
  if (style === 'rain' || style === 'storm') {
    sky(style === 'storm' ? ['#07070f', '#151236', '#231b4d'] : ['#0b1626', '#13253c', '#1d3350']);
    for (const b of B) { ctx.globalAlpha = b.a * (0.75 + 0.25 * Math.sin(t / 900 + b.ph)); glow(b.x, b.y, b.r, b.c, 1); }
    ctx.globalAlpha = 1;
    const slant = style === 'storm' ? .28 : .14;
    ctx.strokeStyle = 'rgb(175,208,255)'; ctx.lineCap = 'round';
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.y += p.sp * dt; p.x += p.sp * slant * dt; if (p.y - p.len > H) { P[i] = spawn(style, false); continue; } ctx.globalAlpha = p.a; ctx.lineWidth = p.w; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * slant, p.y - p.len); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (style === 'storm') {
      const now = performance.now();
      if (!nextFlash) nextFlash = now + 1500;
      if (now > nextFlash) {                                     // thunder every 4–5 s, at a random moment
        flash = now; nextFlash = now + rnd(4000, 5000); bolt = [];
        let x = rnd(.25, .85) * W, y = 0;
        while (y < H * .7) { bolt.push([x, y]); y += rnd(12, 30) * Math.sqrt(K); x += rnd(-18, 18) * Math.sqrt(K); }
      }
      const age = (now - flash) / 1000;
      const f = age < .08 ? 1 : age < .16 ? .25 : age < .24 ? .85 : Math.max(0, .85 - (age - .24) * 2.2);
      if (f > 0) {
        ctx.fillStyle = `rgba(215,210,255,${f * .28})`; ctx.fillRect(0, 0, W, H);
        if (bolt && f > .2) { ctx.strokeStyle = `rgba(255,246,200,${Math.min(1, f)})`; ctx.lineWidth = 2 * Math.sqrt(K); ctx.shadowColor = 'rgba(200,190,255,.9)'; ctx.shadowBlur = 14 * Math.sqrt(K); ctx.beginPath(); bolt.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.shadowBlur = 0; }
      }
    }
  } else if (style === 'snow') {
    sky(['#16223a', '#2f4466', '#6d84a8']);
    glow(W * .5, H, W * .7, '230,240,255', .25);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.y += p.sp * dt; p.ph += dt * p.sw; if (p.y > H + 4) { P[i] = spawn(style, false); continue; } ctx.globalAlpha = p.a; ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph) * 8 * p.sw * Math.sqrt(K), p.y, p.r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (style === 'sunny') {
    sky(['#2f7df6', '#7fbfff', '#ffd9a0']);
    const sx = W * .78, sy = H * .2;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(t / 40000);
    for (let i = 0; i < 18; i++) { ctx.rotate(Math.PI * 2 / 18); const g = ctx.createLinearGradient(0, 0, W * .6, 0); g.addColorStop(0, 'rgba(255,240,190,.22)'); g.addColorStop(1, 'rgba(255,240,190,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * .6, -W * .025); ctx.lineTo(W * .6, W * .025); ctx.fill(); }
    ctx.restore();
    glow(sx, sy, W * .22 * (1 + beat * .06), '255,214,110', .75); glow(sx, sy, W * .05, '255,255,235', 1);
    ctx.fillStyle = '#fff3c4';
    for (let i = 0; i < P.length; i++) { const p = P[i]; p.y -= p.sp * dt; p.ph += dt; if (p.y < -5) { P[i] = spawn(style, false); continue; } ctx.globalAlpha = p.a * (.6 + .4 * Math.sin(p.ph * 2)); ctx.beginPath(); ctx.arc(p.x + Math.sin(p.ph) * 6, p.y, p.r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (style === 'cloudy') {
    sky(['#4c586c', '#6d798d', '#9aa4b4']);
    for (const c of P) { c.x += c.sp * dt; if (c.x - c.s > W) c.x = -c.s; for (let j = 0; j < 4; j++) { ctx.globalAlpha = c.a; glow(c.x + (j - 1.5) * c.s * .35, c.y + Math.sin(j * 2.1) * c.s * .08, c.s * .45, '235,240,248', .55); } }
    ctx.globalAlpha = 1;
  } else if (style === 'night' || style === 'aurora') {
    sky(style === 'aurora' ? ['#02040c', '#06122a', '#0b1f3a'] : ['#04051a', '#0f1240', '#1d1b52']);
    ctx.fillStyle = '#eef0ff';
    for (const s of stars) { ctx.globalAlpha = .25 + .65 * (.5 + .5 * Math.sin(t / 1000 * s.sp + s.ph)); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (style === 'night') {
      glow(W * .8, H * .18, W * .12, '200,205,255', .35);
      ctx.fillStyle = '#eef0ff'; ctx.beginPath(); ctx.arc(W * .8, H * .18, W * .022, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#1a1a4c'; ctx.beginPath(); ctx.arc(W * .808, H * .172, W * .019, 0, 6.283); ctx.fill();
      const now = performance.now();
      if (!nextShoot) nextShoot = now + 2500;
      if (now > nextShoot) { shoot = { x: rnd(.1, .6) * W, y: rnd(.05, .3) * H, t: now }; nextShoot = now + rnd(5000, 9000); }
      if (shoot) {
        const a = (now - shoot.t) / 900;
        if (a > 1) shoot = null;
        else { const x = shoot.x + a * W * .25, y = shoot.y + a * H * .12; const g = ctx.createLinearGradient(x, y, x - W * .08, y - H * .04); g.addColorStop(0, `rgba(255,255,255,${1 - a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.strokeStyle = g; ctx.lineWidth = 1.6 * Math.sqrt(K); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - W * .08, y - H * .04); ctx.stroke(); }
      }
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const step = Math.max(4, Math.round(4 * K));
      [[.32, '48,208,160', .9], [.42, '120,110,250', .7], [.26, '64,200,224', .5]].forEach(([base, c, a], bi) => {
        for (let x = 0; x <= W; x += step) {
          const y = H * base + Math.sin(x / W * 6 + t / 2600 + bi) * H * .06 + Math.sin(x / W * 15 - t / 1700) * H * .02;
          const len = H * (.18 + .08 * Math.sin(x / W * 9 + t / 2000 + bi * 2)) * (0.9 + beat * .25);
          const g = ctx.createLinearGradient(0, y, 0, y + len);
          g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(.25, `rgba(${c},${a * .22 * k + .05})`); g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g; ctx.fillRect(x, y, step, len);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    }
  } else if (style === 'music') {
    sky(['#07060f', '#140f2c', '#241848']);
    const n = 64, bw = W / n;
    glow(W * .5, H, W * .6 * (1 + beat * .15), '167,139,250', .35 + beat * .25);
    for (let i = 0; i < n; i++) {
      const v = AU.an ? band(i, n) * k * 1.4 : Math.max(.04, (.5 - Math.abs(i - n / 2) / n * .6) + .2 * Math.sin(t / 260 + i * .7) * Math.sin(t / 900 + i * .21)) * k;
      const h = clamp(v, 0, 1) * H * .55;
      const g = ctx.createLinearGradient(0, H - h, 0, H);
      g.addColorStop(0, 'rgba(64,200,224,.85)'); g.addColorStop(1, 'rgba(167,139,250,.25)');
      ctx.fillStyle = g; ctx.fillRect(i * bw + bw * .18, H - h, bw * .64, h);
    }
  }
  if (beat > .02 && style !== 'music') { ctx.globalAlpha = beat * .5; glow(W * .5, H * 1.05, W * .55, '167,139,250', .35); ctx.globalAlpha = 1; }
  const dim = clamp((settings.wpDim ?? 15) / 100, 0, .8);
  if (dim) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
}

// ---- the loop: ≤30 fps, nothing at all while paused (the last frame stays on screen)
let raf = 0, last = 0;
const still = () => paused || (onBattery && settings.wpBatteryStill !== false);
function loop(t) {
  raf = 0;
  if (still()) return;
  raf = requestAnimationFrame(loop);
  if (last && t - last < 32) return;
  const dt = last ? Math.min(.05, (t - last) / 1000) : .033;
  last = t;
  draw(t, dt);
}
function kick() { if (!raf && !still()) { last = 0; raf = requestAnimationFrame(loop); } }
function redraw() { if (still()) draw(performance.now(), 0); kick(); }

// a new style / amount restarts the scene (draw() notices); other settings changes don't disturb it
api.on('settings', s => { settings = s; if (wantsAudio()) startAudio(); if (still()) draw(performance.now(), 0); kick(); });
api.on('wp-weather', w => { weather = w; if (still()) draw(performance.now(), 0); kick(); });
api.on('wp-paused', p => { paused = !!p; kick(); });
api.on('wp-bg', setBg);
window.addEventListener('resize', () => { size(); draw(performance.now(), 0); });

(async function boot() {
  const init = await api.wpInit();
  settings = init.settings || {};
  weather = init.weather || null;
  paused = !!init.paused;
  if (init.bg) setBg(init.bg);
  try {
    const b = await navigator.getBattery();
    const upd = () => { onBattery = !b.charging; kick(); if (still()) draw(performance.now(), 0); };
    b.addEventListener('chargingchange', upd); upd();
  } catch { /* no battery info: treat as plugged in */ }
  size();
  draw(performance.now(), 0);                    // a first frame right away, even if paused
  kick();
  window.__wp = { current, fps: () => last, paused: () => still() };
})();
