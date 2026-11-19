'use strict';
/* NotchMine equalizer styles, shared by the desktop equalizer (deskeq.js) and party mode (party.js).
   makeEqStyles() returns a draw function with its own state (particles, history…), so each user gets one.
   draw(env, style, P, dt) draws one frame onto env.ctx, inside a W × H area whose bottom is the floor:
     env: { ctx, W, H, N, vals, peaks, pal, hot, playing, AU, synthT, kick, bass }
          kick = a beat was detected this frame, bass = raw bass 0…1 (Bubbles / Fountain / Heartbeat sync to these)
          vals / peaks = N columns 0…1 (already mirrored if P.mirror), AU = { an, td } for the Wave style
     P:   { inten, mirror, a (overall alpha), maxH (how high it may reach), pt(i) (palette position of column i) }
   Some styles erase parts of the canvas (destination-out), so draw onto a canvas that holds only the eq. */

// Beat (kick) detector for the styles, fed the raw bass 0…1 every frame. A kick is the bass jumping:
// either a sharp one-frame jump, or the bass climbing clearly above its own recent average (a kick that
// rises over two or three frames). A short gap after each kick stops one drum hit counting twice.
function makeBeatDetector() {
  let prev = 0, avg = 0, last = -1e9;
  return function beat(bass, t) {
    const rise = bass - prev;
    avg += (bass - avg) * 0.06;
    const kick = t - last > 160 && bass > 0.32 && (rise > 0.12 || (rise > 0.04 && bass > avg * 1.4 + 0.08));
    prev = bass;
    if (kick) last = t;
    return kick;
  };
}

function makeEqStyles() {
  let ctx, W = 0, H = 0, N = 0, vals = new Float32Array(0), peaks = new Float32Array(0), pal, hot, playing = false, AU = {}, synthT = 0;
  let kick = false, bass = 0;             // this frame: a beat was just detected / the raw bass level 0…1 (from the host)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isPlaying = () => playing;

  // ---- styles (Settings → Desktop equalizer → Style). Each draws one frame from vals / peaks.
  // helpers: a left → right palette gradient, and a smooth curve through points
  function hGrad(alpha, mirror, heat = 0) {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let k = 0; k <= 8; k++) {
      const x = k / 8, pt = mirror ? Math.abs(x - 0.5) * 2 : x;
      g.addColorStop(x, `rgba(${heat ? hot(pt, heat) : pal(pt)}, ${alpha})`);
    }
    return g;
  }
  function curve(path, pts) {
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) path.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    path.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    return path;
  }
  function colPoints(arr, P, scale = 1) {   // one point per column, plus the two screen edges
    const slot = W / N, y = i => H - Math.max(1.5, arr[i] * P.maxH * scale);
    const pts = [[0, y(0)]];
    for (let i = 0; i < N; i++) pts.push([i * slot + slot / 2, y(i)]);
    pts.push([W, y(N - 1)]);
    return pts;
  }
  function fadeTop(P, keep = 0.15) {        // the fill fades out towards the top (the canvas holds only the eq)
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(0, H - P.maxH * 1.05, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, `rgba(0,0,0,${keep})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
  }
  function glowStroke(path, P, lw) {        // wide soft glow → bright thin core
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (P.inten > 0.05) {
      ctx.strokeStyle = hGrad(P.a * 0.1 * P.inten, P.mirror); ctx.lineWidth = lw * 7; ctx.stroke(path);
      ctx.strokeStyle = hGrad(P.a * 0.25 * P.inten, P.mirror); ctx.lineWidth = lw * 3; ctx.stroke(path);
    }
    ctx.strokeStyle = hGrad(P.a * 0.95, P.mirror, 0.35); ctx.lineWidth = lw; ctx.stroke(path);
  }
  const smooth = (arr, r) => Float32Array.from(arr, (_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k++) { s += arr[k]; n++; }
    return s / n;
  });

  const WAVE = { pk: 0.1, v: new Float32Array(0) };
  const RIDGE = { hist: [], acc: 0 };                                   // ridges: recent snapshots of the spectrum
  const FOUNT = { p: [], acc: new Float32Array(0) };                    // fountain: sparks in flight
  const BUB = { b: [], acc: new Float32Array(0) };                      // bubbles
  const CITY = { n: 0, b: [] };                                         // city: the buildings (laid out per column count)
  const ECG = { pts: new Float32Array(0), acc: 0 };                    // heartbeat: the scrolling trace
  const hash = n => { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  const dropAt = (arr, j) => { arr[j] = arr[arr.length - 1]; arr.pop(); };   // order doesn't matter: O(1) removal
  function cityLayout() {
    if (CITY.n === N) return;
    CITY.n = N; CITY.b = [];
    let i = 0, seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (i < N) {
      const w = Math.min(N - i, 2 + Math.floor(rnd() * 3));
      CITY.b.push({ i0: i, w, base: 0.08 + rnd() * 0.18, ant: rnd() < 0.25, seed: Math.floor(rnd() * 1e6), h: 0 });
      i += w;
    }
  }
  const STYLES = {
    bars(P) { drawBars(P); },

    // a glowing line tracing the spectrum, a soft fill under it and the falling peaks as a faint dotted line
    line(P) {
      const pts = colPoints(vals, P), path = curve(new Path2D(), pts);
      const fill = curve(new Path2D(), pts); fill.lineTo(W, H); fill.lineTo(0, H); fill.closePath();
      ctx.fillStyle = hGrad(P.a * 0.32, P.mirror); ctx.fill(fill);
      fadeTop(P, 0.25);
      glowStroke(path, P, 2.6);
      ctx.setLineDash([2, 5]); ctx.strokeStyle = hGrad(P.a * 0.45, P.mirror, 0.5); ctx.lineWidth = 1.4;
      ctx.stroke(curve(new Path2D(), colPoints(peaks, P))); ctx.setLineDash([]);
    },

    // the live sound wave (oscilloscope), drawn as a glowing ribbon whose height follows how loud it is
    wave(P, dt) {
      const M = clamp(Math.round(W / 6), 120, 420);
      if (WAVE.v.length !== M) WAVE.v = new Float32Array(M);
      const target = new Float32Array(M);
      if (AU.an && isPlaying()) {
        const td = AU.td; AU.an.getByteTimeDomainData(td);
        const half = td.length >> 1;
        let start = 0;                                            // trigger on a rising zero crossing: a steady picture
        for (let i = 1; i < half; i++) if (td[i - 1] < 128 && td[i] >= 128) { start = i; break; }
        const per = half / M;
        let mx = 0;
        for (let j = 0; j < M; j++) {
          let s = 0; const a = start + Math.floor(j * per), b = start + Math.floor((j + 1) * per);
          for (let k = a; k < Math.max(a + 1, b); k++) s += td[k] - 128;
          target[j] = s / Math.max(1, b - a) / 128;
          mx = Math.max(mx, Math.abs(target[j]));
        }
        WAVE.pk = Math.max(mx, Math.max(0.04, WAVE.pk * 0.995));
        for (let j = 0; j < M; j++) target[j] /= WAVE.pk;
      } else if (isPlaying()) {
        for (let j = 0; j < M; j++) target[j] = Math.sin(j * 0.09 + synthT / 140) * 0.6 + Math.sin(j * 0.23 - synthT / 90) * 0.3;
      }
      let energy = 0;
      for (let i = 0; i < N; i++) energy += vals[i];
      energy = clamp(energy / Math.max(1, N) * 1.6, 0, 1);
      const cy = H - P.maxH * 0.5 - 2, amp = P.maxH * 0.46 * (0.3 + 0.7 * energy);
      const top = [], bot = [];
      for (let j = 0; j < M; j++) {
        WAVE.v[j] += (target[j] - WAVE.v[j]) * 0.5;
        const taper = Math.sqrt(Math.sin(Math.PI * j / (M - 1))), x = j / (M - 1) * W, v = WAVE.v[j] * amp * taper;
        top.push([x, cy - v]); bot.push([x, cy + v * 0.45]);
      }
      const ribbon = curve(new Path2D(), top);
      for (let j = M - 1; j >= 0; j--) ribbon.lineTo(bot[j][0], bot[j][1]);
      ribbon.closePath();
      ctx.fillStyle = hGrad(P.a * 0.14, P.mirror); ctx.fill(ribbon);
      ctx.strokeStyle = hGrad(P.a * 0.35, P.mirror); ctx.lineWidth = 1.2; ctx.stroke(curve(new Path2D(), bot));
      glowStroke(curve(new Path2D(), top), P, 2.4);
    },

    // retro LED columns: dots light up from the bottom, hotter towards the top, a peak dot falls slowly
    dots(P) {
      const slot = W / N, d = clamp(slot * 0.62, 3, 10), gap = d * 0.42, step = d + gap;
      const rows = Math.max(3, Math.floor(P.maxH / step)), x0 = (slot - d) / 2, rr = d * 0.3;
      for (let i = 0; i < N; i++) {
        const pt = P.pt(i), x = i * slot + x0, lit = Math.round(vals[i] * rows), pk = Math.round(peaks[i] * rows);
        ctx.fillStyle = `rgba(${pal(pt)}, ${P.a * 0.05})`;        // the unlit matrix, barely there
        ctx.beginPath();
        for (let r = lit; r < rows; r++) ctx.roundRect(x, H - (r + 1) * step + gap, d, d, rr);
        ctx.fill();
        for (let r = 0; r < lit; r++) {
          const h = r / Math.max(1, rows - 1);
          ctx.fillStyle = `rgba(${hot(pt, h * 0.55)}, ${P.a * (0.45 + 0.5 * h)})`;
          ctx.beginPath(); ctx.roundRect(x, H - (r + 1) * step + gap, d, d, rr); ctx.fill();
        }
        if (pk > lit && pk > 0) {
          ctx.fillStyle = `rgba(${hot(pt, 0.6)}, ${P.a * 0.9})`;
          ctx.beginPath(); ctx.roundRect(x, H - pk * step + gap, d, d, rr); ctx.fill();
        }
      }
    },

    // soft layered hills: a slow wide back range (the peaks), a middle one and a sharp front one
    hills(P) {
      const layers = [[peaks, 5, 1.0, 0.16, 0.2], [vals, 3, 0.8, 0.2, 0.35], [vals, 1, 0.55, 0.3, 0.6]];
      const ridges = [];
      for (const [src, r, sc, alpha] of layers) {
        const pts = colPoints(smooth(src, r), P, sc), path = curve(new Path2D(), pts);
        ridges.push(path);
        const fill = curve(new Path2D(), pts); fill.lineTo(W, H); fill.lineTo(0, H); fill.closePath();
        ctx.fillStyle = hGrad(P.a * alpha, P.mirror); ctx.fill(fill);
      }
      fadeTop(P, 0.35);
      ctx.lineJoin = 'round';
      ridges.forEach((path, k) => {
        ctx.strokeStyle = hGrad(P.a * layers[k][4], P.mirror, 0.3 + k * 0.15); ctx.lineWidth = 1 + k * 0.6; ctx.stroke(path);
      });
    },

    // bars growing up and down from a waterline, the lower half a fading reflection
    reflect(P) {
      const slot = W / N, bw = Math.max(2, slot * 0.52), cy = H - P.maxH * 0.42, r = Math.min(bw / 2, 3);
      for (let i = 0; i < N; i++) {
        const v = vals[i], pt = P.pt(i), h = Math.max(1.5, v * P.maxH * 0.55), x = i * slot + (slot - bw) / 2;
        let g = ctx.createLinearGradient(0, cy - h, 0, cy);
        g.addColorStop(0, `rgba(${hot(pt, 0.35)}, ${P.a * (0.5 + v * 0.5)})`); g.addColorStop(1, `rgba(${pal(pt)}, ${P.a * 0.75})`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, cy - h, bw, h, [r, r, 0, 0]); ctx.fill();
        const hr = h * 0.7;
        g = ctx.createLinearGradient(0, cy + 2, 0, cy + 2 + hr);
        g.addColorStop(0, `rgba(${pal(pt)}, ${P.a * 0.32})`); g.addColorStop(1, `rgba(${pal(pt)}, 0)`);
        ctx.fillStyle = g; ctx.fillRect(x, cy + 2, bw, hr);
      }
      ctx.fillStyle = hGrad(P.a * 0.5, P.mirror, 0.4); ctx.fillRect(0, cy, W, 1);
    },

    // segmented VU-meter blocks, coloured by height (bottom → top runs through the palette), white peak blocks
    blocks(P) {
      const slot = W / N, bw = Math.max(3, slot * 0.78), bh = clamp(P.maxH / 26, 3, 7), gap = Math.max(1.5, bh * 0.4), step = bh + gap;
      const rows = Math.max(4, Math.floor(P.maxH / step)), x0 = (slot - bw) / 2;
      for (let r = 0; r < rows; r++) {
        const h = r / (rows - 1);
        ctx.fillStyle = `rgba(${hot(h, h * 0.25)}, ${P.a * (0.55 + 0.4 * h)})`;
        ctx.beginPath();
        for (let i = 0; i < N; i++) if (Math.round(vals[i] * rows) > r) ctx.rect(i * slot + x0, H - (r + 1) * step + gap, bw, bh);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255, 255, 255, ${P.a * 0.7})`;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const pk = Math.round(peaks[i] * rows);
        if (pk > Math.round(vals[i] * rows)) ctx.rect(i * slot + x0, H - pk * step + gap, bw, bh);
      }
      ctx.fill();
    },

    // hollow glowing neon-tube bars
    neon(P) {
      const slot = W / N, bw = Math.max(3, slot * 0.6), r = Math.min(bw / 2, 4), path = new Path2D();
      for (let i = 0; i < N; i++) {
        const h = Math.max(3, vals[i] * P.maxH);
        path.roundRect(i * slot + (slot - bw) / 2, H - h, bw, h + r + 2, [r, r, 0, 0]);
      }
      ctx.fillStyle = hGrad(P.a * 0.07, P.mirror); ctx.fill(path);
      glowStroke(path, P, 1.6);
    },

    // stacked ridge lines: the newest at the front, the last moments rolling back into the distance.
    // Each ridge hides the ones behind it (the canvas holds only the eq, so erasing under it is safe).
    ridges(P, dt) {
      const L = 8;
      if (RIDGE.hist.length && RIDGE.hist[0].length !== N) RIDGE.hist = [];
      RIDGE.acc += dt;
      if (RIDGE.acc > 70 || !RIDGE.hist.length) { RIDGE.acc = 0; RIDGE.hist.unshift(smooth(vals, 1)); RIDGE.hist.length = Math.min(RIDGE.hist.length, L); }
      const amp = P.maxH * 0.5, gapY = P.maxH * 0.5 / (L - 1), slot = W / N;
      ctx.lineJoin = 'round';
      for (let k = RIDGE.hist.length - 1; k >= 0; k--) {
        const arr = RIDGE.hist[k], base = H - 2 - k * gapY, fade = 1 - k / L;
        const pts = [[0, base - arr[0] * amp]];
        for (let i = 0; i < N; i++) pts.push([i * slot + slot / 2, base - arr[i] * amp]);
        pts.push([W, base - arr[N - 1] * amp]);
        const fill = curve(new Path2D(), pts); fill.lineTo(W, H); fill.lineTo(0, H); fill.closePath();
        ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fill(fill);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hGrad(P.a * (0.25 + 0.7 * fade), P.mirror, 0.2 + 0.3 * fade); ctx.lineWidth = 1 + fade * 1.2;
        ctx.stroke(curve(new Path2D(), pts));
      }
    },

    // sparks shooting up as high as their band, falling back under gravity
    fountain(P, dt) {
      const slot = W / N, g = 0.0016;                                   // px / ms²
      if (FOUNT.acc.length !== N) FOUNT.acc = new Float32Array(N);
      if (kick) for (let i = 0; i < N; i++) {                          // a beat throws an extra, higher volley
        const v = vals[i];
        if (Math.random() < v * 0.8 && FOUNT.p.length < 900) {
          const h = Math.min(1.15, v * (1.1 + bass * 0.3)) * P.maxH;
          FOUNT.p.push({ x: i * slot + slot / 2 + (Math.random() - 0.5) * slot * 0.8, y: H, vx: (Math.random() - 0.5) * 0.04, vy: -Math.sqrt(2 * g * h), pt: P.pt(i), s: 2.5 + Math.random() * 2 });
        }
      }
      if (isPlaying()) for (let i = 0; i < N; i++) {
        const v = vals[i];
        FOUNT.acc[i] = Math.min(2, FOUNT.acc[i] + dt * 0.03 * v * v * (0.5 + P.inten));
        while (FOUNT.acc[i] >= 1 && FOUNT.p.length < 900) {
          FOUNT.acc[i] -= 1;
          const h = v * P.maxH * (0.75 + Math.random() * 0.35);
          FOUNT.p.push({ x: i * slot + slot / 2 + (Math.random() - 0.5) * slot * 0.8, y: H, vx: (Math.random() - 0.5) * 0.03, vy: -Math.sqrt(2 * g * h), pt: P.pt(i), s: 2 + Math.random() * 2 });
        }
      }
      for (let j = FOUNT.p.length - 1; j >= 0; j--) {
        const q = FOUNT.p[j];
        q.vy += g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.y > H + 4) { dropAt(FOUNT.p, j); continue; }
        const up = clamp((H - q.y) / P.maxH, 0, 1);
        ctx.fillStyle = `rgba(${hot(q.pt, 0.2 + up * 0.5)}, ${P.a * (0.45 + 0.5 * up)})`;
        ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
      }
      ctx.fillStyle = hGrad(P.a * 0.35, P.mirror, 0.3); ctx.fillRect(0, H - 2, W, 2);
    },

    // bubbles on the beat: every kick pops a burst straight out of the floor from the loud bands (the bass ones
    // most), launched upwards; every bubble already in the air swells, flashes and jumps with it. Between beats
    // only a light trickle, so the bursts are what you see.
    bubbles(P, dt) {
      const slot = W / N, t = performance.now(), boost = 0.7 + P.inten * 0.8;   // Intensity: more, bigger, brighter
      const blow = (i, burst) => {
        if (BUB.b.length >= 450) return;
        const v = vals[i], r = (3 + v * clamp(slot * 0.7, 5, 14)) * (burst ? 1.25 : 0.85);
        BUB.b.push({ x: i * slot + slot / 2 + (Math.random() - 0.5) * slot, y: burst ? H - r * 0.4 : H + r, r, kv: burst ? 0.1 + bass * 0.15 + Math.random() * 0.06 : 0, vy: 0.025 + Math.random() * 0.025 + v * 0.035, ph: Math.random() * 6.28, top: H - P.maxH * (0.6 + Math.random() * 0.5) * (0.6 + v * 0.4), pt: P.pt(i) });
      };
      if (BUB.acc.length !== N) BUB.acc = Float32Array.from({ length: N }, () => Math.random());   // staggered start
      if (kick) for (let i = 0; i < N; i++) {
        const v = vals[i], w = P.pt(i) < 0.3 ? 1.4 : 1;                // bass bands blow hardest
        if (Math.random() < v * v * 0.75 * w * boost) blow(i, true);
      }
      if (isPlaying()) for (let i = 0; i < N; i++) {
        BUB.acc[i] += dt * 0.0003 * vals[i] * vals[i] * boost;   // only a light trickle between beats
        if (BUB.acc[i] >= 1) { BUB.acc[i] = 0; blow(i, false); }
      }
      BUB.pulse = Math.max((BUB.pulse || 0) * Math.pow(0.88, dt / 16.7), kick ? 0.6 + bass * 0.4 : 0);
      const swell = 1 + 0.18 * BUB.pulse, lift = 1 + 1.1 * BUB.pulse, flash = 1 + 0.3 * BUB.pulse;
      ctx.fillStyle = hGrad(P.a * (0.15 + 0.15 * BUB.pulse), P.mirror, 0.3); ctx.fillRect(0, H - 3, W, 3);   // froth that flares on the beat
      for (let j = BUB.b.length - 1; j >= 0; j--) {
        const q = BUB.b[j];
        q.y -= (q.vy * lift + q.kv) * dt;
        q.kv *= Math.pow(0.9, dt / 16.7);                                 // the launch settles into the drift
        if (q.y < q.top) { dropAt(BUB.b, j); continue; }
        const life = clamp((q.y - q.top) / (P.maxH * 0.45), 0, 1), x = q.x + Math.sin(t / 400 + q.ph) * 3, qr = q.r * swell;
        const al = P.a * life * flash, col = pal(q.pt), rim = hot(q.pt, 0.45);
        ctx.beginPath(); ctx.arc(x, q.y, qr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col}, ${Math.min(1, al * 0.22)})`; ctx.fill();
        if (P.inten > 0.05) { ctx.strokeStyle = `rgba(${col}, ${Math.min(1, al * 0.25 * P.inten)})`; ctx.lineWidth = 5; ctx.stroke(); }   // soft glow
        ctx.strokeStyle = `rgba(${rim}, ${Math.min(1, al)})`; ctx.lineWidth = 1.6; ctx.stroke();
        const s = Math.max(1.5, qr * 0.32);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, al * 0.85)})`;
        ctx.beginPath(); ctx.arc(x - qr * 0.38, q.y - qr * 0.38, s / 2, 0, Math.PI * 2); ctx.fill();   // the shine
      }
    },

    // a night skyline: buildings rise with their bands, more windows light up the louder it gets
    city(P) {
      cityLayout();
      const slot = W / N, blink = Math.floor(performance.now() / 700) % 2;
      const ww = clamp(slot * 0.2, 2, 4), wh = ww * 1.3, gx = ww * 2.3, gy = wh * 2.1;
      for (const b of CITY.b) {
        let s = 0;
        for (let k = b.i0; k < b.i0 + b.w; k++) s += vals[k];
        const target = b.base + (s / b.w) * 0.85;
        b.h += (target - b.h) * (target > b.h ? 0.35 : 0.08);
        const x = b.i0 * slot + 1.5, w = b.w * slot - 3, h = Math.max(6, b.h * P.maxH), y = H - h, pt = P.pt(b.i0 + (b.w >> 1));
        ctx.fillStyle = `rgba(${pal(pt)}, ${P.a * 0.16})`; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = `rgba(${hot(pt, 0.4)}, ${P.a * 0.8})`; ctx.fillRect(x, y, w, 1.5);
        if (b.ant) {
          const ah = 4 + h * 0.12;
          ctx.fillRect(x + w / 2 - 0.75, y - ah, 1.5, ah);
          if (blink) { ctx.fillStyle = `rgba(255, 90, 90, ${P.a * 0.9})`; ctx.fillRect(x + w / 2 - 1.5, y - ah - 2, 3, 3); }
        }
        // windows, counted up from the ground so they stay put while the building grows
        const cols = Math.max(1, Math.floor((w - 2) / gx)), rows = Math.floor((h - 6) / gy), ox = x + (w - cols * gx) / 2 + (gx - ww) / 2;
        const chance = 0.12 + clamp(b.h, 0, 1) * 0.7;
        ctx.fillStyle = `rgba(${hot(pt, 0.65)}, ${P.a * 0.85})`;
        ctx.beginPath();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (hash(b.seed + r * 131 + c * 977) < chance) ctx.rect(ox + c * gx, H - 4 - (r + 1) * gy, ww, wh);
        }
        ctx.fill();
      }
    },

    // soft shimmering curtains of light, swaying and shifting colour
    aurora(P) {
      const slot = W / N, t = performance.now() / 1000, sm = smooth(vals, 2), w = slot * 1.7;
      for (let i = 0; i < N; i++) {
        const v = sm[i], h = Math.max(4, v * P.maxH * 1.05) * (0.85 + 0.15 * Math.sin(t * 1.3 + i * 0.4));
        const x = i * slot + slot / 2 + Math.sin(t * 0.7 + i * 0.25) * slot * 0.4;
        const pt = clamp(P.pt(i) + Math.sin(t * 0.3 + i * 0.05) * 0.12, 0, 1);
        const g = ctx.createLinearGradient(0, H - h, 0, H);
        g.addColorStop(0, `rgba(${pal(pt)}, 0)`);
        g.addColorStop(0.35, `rgba(${hot(pt, 0.2)}, ${P.a * 0.3 * (0.5 + v)})`);
        g.addColorStop(1, `rgba(${pal(pt)}, ${P.a * 0.08})`);
        ctx.fillStyle = g; ctx.fillRect(x - w / 2, H - h, w, h);
      }
    },

    // a heart-monitor trace scrolling across the screen. Every kick (the host's beat detector, on the raw
    // bass) writes a heartbeat spike straight into the newest end of the trace, the same frame it's heard,
    // as tall as the kick is strong. Between beats the line hums gently with the bass.
    heartbeat(P, dt) {
      const step = 3, M = Math.ceil(W / step) + 1;
      if (ECG.pts.length !== M) ECG.pts = new Float32Array(M);
      ECG.acc += dt * 0.16;                                              // px per ms
      while (ECG.acc >= step) {
        ECG.acc -= step;
        ECG.pts.copyWithin(0, 1);
        ECG.pts[M - 1] = isPlaying() ? (Math.random() - 0.5) * 0.03 + bass * 0.04 : 0;
      }
      if (kick) {
        const k = 0.4 + bass * 0.6, shape = [0.15, 0.25, -0.3, 1, -0.6, 0.12, 0.3, 0.2, 0.06];
        for (let j = 0; j < shape.length; j++) ECG.pts[M - shape.length + j] = shape[j] * k;
      }
      const cy = H - P.maxH * 0.42, amp = P.maxH * 0.55, path = new Path2D();
      path.moveTo(0, cy - ECG.pts[0] * amp);
      for (let j = 1; j < M; j++) path.lineTo(j * step, cy - ECG.pts[j] * amp);
      glowStroke(path, P, 1.8);
      const hx = Math.min(W - 3, (M - 1) * step), hy = cy - ECG.pts[M - 1] * amp, g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      g.addColorStop(0, `rgba(255, 255, 255, ${P.a})`); g.addColorStop(1, `rgba(${pal(P.mirror ? 0 : 1)}, 0)`);
      ctx.fillStyle = g; ctx.fillRect(hx - 14, hy - 14, 28, 28);
    },

    // thin laser rays fanning up and outwards from the bottom, one per band
    lasers(P) {
      const slot = W / N, glow = new Path2D();
      ctx.lineCap = 'round'; ctx.lineWidth = 1.3;
      for (let i = 0; i < N; i++) {
        const v = vals[i];
        if (v < 0.04) continue;
        const x = i * slot + slot / 2, ang = -Math.PI / 2 + (x / W - 0.5) * 0.9, L = v * P.maxH * 1.1, pt = P.pt(i);
        const ex = x + Math.cos(ang) * L, ey = H + Math.sin(ang) * L;
        glow.moveTo(x, H); glow.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(${hot(pt, 0.45)}, ${P.a * (0.35 + 0.6 * v)})`;
        ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = `rgba(255, 255, 255, ${P.a * 0.8 * v})`; ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      }
      if (P.inten > 0.05) { ctx.strokeStyle = hGrad(P.a * 0.12 * P.inten, P.mirror); ctx.lineWidth = 6; ctx.stroke(glow); }
    },
  };

  // the classic: bars with a soft glow behind them and falling peak caps
  function drawBars(P) {
    const { inten, maxH, mirror, a } = P;
    const slot = W / N, bw = Math.max(2, slot * 0.68), r = Math.min(bw / 2, 4);
    for (let i = 0; i < N; i++) {
      const v = vals[i];
      const h = Math.max(2, v * maxH);
      const x = i * slot + (slot - bw) / 2, y = H - h;
      const pt = mirror ? Math.abs(i - (N - 1) / 2) / ((N - 1) / 2) : i / (N - 1);
      const col = pal(pt);
      // soft glow behind the bar
      if (inten > 0.05) {
        const gg = ctx.createLinearGradient(0, y, 0, H);
        gg.addColorStop(0, `rgba(${col}, 0)`);
        gg.addColorStop(1, `rgba(${col}, ${a * 0.22 * inten})`);
        ctx.fillStyle = gg;
        ctx.fillRect(x - bw * 0.6, y - 6, bw * 2.2, h + 6);
      }
      // the bar: strongest at the bottom, see-through towards the top
      const g = ctx.createLinearGradient(0, y, 0, H);
      g.addColorStop(0, `rgba(${hot(pt, 0.3)}, ${a * (0.35 + v * 0.5)})`);
      g.addColorStop(0.5, `rgba(${col}, ${a * 0.45})`);
      g.addColorStop(1, `rgba(${col}, ${a * 0.85})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, h + r, [r, r, 0, 0]);
      ctx.fill();
      // falling peak cap
      const py = H - Math.max(2, peaks[i] * maxH) - 5;
      ctx.fillStyle = `rgba(${hot(pt, 0.5)}, ${a * 0.9})`;
      ctx.fillRect(x, py, bw, 2.5);
    }
  }

  return function draw(env, style, P, dt) {
    ({ ctx, W, H, N, vals, peaks, pal, hot, playing, AU, synthT } = env);
    kick = !!env.kick; bass = env.bass || 0;
    if (!N) return;
    ctx.globalCompositeOperation = 'lighter';
    (STYLES[style] || STYLES.bars)(P, dt);
  };
}
