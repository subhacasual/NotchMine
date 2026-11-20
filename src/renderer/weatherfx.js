'use strict';
/* Weather effects, driven by the current weather (see weatherMood() / wxPrecip() in app.js):
   - the whole notch: rain (with little splashes) or snow falls across the pill (idle or playing music), and while it
     rains it keeps raining behind the whole open panel, on every page; lightning flashes in storms
   - the Home weather card: a live scene: snow, or twinkling stars on a clear night (rain is drawn panel-wide instead)
   One requestAnimationFrame loop drives both, and it stops completely when neither is on screen
   (game mode, full-screen fade, side-mode see-through, panel closed, reduced motion…). */

const WXFX = { raf: 0, last: 0, scenes: [] };
const wxReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

function wxScene(canvasId, opts) {
  const sc = { el: $(canvasId), ctx: null, w: 0, h: 0, dpr: 1, drops: [], splashes: [], stars: [], flash: 0, nextFlash: 0, bolt: null, on: false, sig: '', ...opts };
  sc.ctx = sc.el.getContext('2d');
  WXFX.scenes.push(sc);
  return sc;
}
// the notch's scene adapts to its size (see wxSize): on the 34 px pill few, short, slower drops; in the open panel
// sparser, longer ones and a lightning bolt. The card is always "big".
const WX_PILL = wxScene('wxPill', { density: 1 / 320, lenK: 0.55, splash: true, starsOn: false, boltOn: false, small: true });
const WX_CARD = wxScene('wxCard', { density: 1 / 1100, lenK: 1, splash: true, starsOn: true, boltOn: true, small: false });

// ---- when each scene runs
function wxPillWanted() {
  if (S.settings.wxPill === false || wxReduce.matches || document.hidden) return false;
  const p = wxPrecip();
  if (!p.kind) return false;
  if (S.mode === 'expanded') return p.kind === 'rain';            // the open panel: only rain falls all over it
  return !isGhost() && !isSideFaded() && !S.game;                 // pill (with or without music) and pop-ups
}
function wxCardWanted() {
  if (wxReduce.matches || document.hidden || S.mode !== 'expanded' || S.tab !== 'home') return false;
  const p = wxPrecip(), m = weatherMood();
  if (p.kind === 'rain' && WX_PILL.want) return false;            // it's already raining over the whole panel
  return !!(p.kind || m === 'night') && $('weatherCard').offsetWidth > 0;
}

function wxfxEnsure(reset) {
  if (reset) for (const sc of WXFX.scenes) { sc.drops.length = 0; sc.splashes.length = 0; sc.stars.length = 0; sc.sig = ''; }
  WX_PILL.want = wxPillWanted();
  WX_CARD.want = wxCardWanted();
  for (const sc of WXFX.scenes) if (!sc.want && sc.on) wxSceneOff(sc);
  if (!WXFX.raf && (WX_PILL.want || WX_CARD.want)) { WXFX.last = 0; WXFX.raf = requestAnimationFrame(wxFrame); }
}
function wxSceneOff(sc) {
  sc.on = false;
  sc.el.classList.remove('on');
  if (sc === WX_PILL) island.classList.remove('wx-fx');
  sc.flash = 0; sc.bolt = null;
  // clear after the fade-out so the drops don't vanish abruptly
  setTimeout(() => { if (!sc.on) sc.ctx.clearRect(0, 0, sc.el.width, sc.el.height); }, 650);
}

// ---- particles
const rnd = (a, b) => a + Math.random() * (b - a);
function wxSpawnDrop(sc, p, anywhere) {
  const heavy = p.amt >= 0.9;
  const sp = (p.amt < 0.45 ? rnd(150, 220) : heavy ? rnd(360, 470) : rnd(260, 360)) * (sc.small ? 0.62 : 1);
  return {
    x: rnd(-0.15, 1.05) * sc.w, y: anywhere ? rnd(0, sc.h) : rnd(-0.4, 0) * sc.h - 4,
    sp, len: (p.amt < 0.45 ? rnd(4, 7) : heavy ? rnd(9, 15) : rnd(7, 11)) * sc.lenK + 2,
    a: rnd(0.3, p.amt < 0.45 ? 0.55 : 0.75) * (sc.small ? 1.25 : 1), w: Math.random() < 0.2 ? 1.4 : 1,
  };
}
function wxSpawnFlake(sc, anywhere) {
  return {
    x: rnd(0, 1) * sc.w, y: anywhere ? rnd(0, sc.h) : rnd(-0.3, 0) * sc.h - 3,
    sp: rnd(12, 30) * (sc.small ? 0.7 : 1), r: rnd(0.7, sc.small ? 1.5 : 2.1),
    a: rnd(0.5, 0.95), ph: rnd(0, Math.PI * 2), sw: rnd(0.6, 1.4),
  };
}
function wxSize(sc) {
  const dpr = window.devicePixelRatio || 1, w = sc.el.clientWidth, h = sc.el.clientHeight;
  if (w !== sc.w || h !== sc.h || dpr !== sc.dpr) {
    sc.w = w; sc.h = h; sc.dpr = dpr;
    sc.el.width = Math.max(1, Math.round(w * dpr));
    sc.el.height = Math.max(1, Math.round(h * dpr));
    sc.stars.length = 0;
    if (sc === WX_PILL) {
      const big = h > 80;                       // the open panel (or a tall side-mode column)
      sc.small = !big; sc.boltOn = big;
      sc.density = big ? 1 / 1500 : 1 / 320;
      sc.lenK = big ? 1 : 0.55;
    }
  }
  return w > 0 && h > 0;
}
// a jagged lightning bolt from the top of the card down most of the way
function wxMakeBolt(sc) {
  const pts = [];
  let x = rnd(0.3, 0.85) * sc.w, y = 0;
  const end = sc.h * rnd(0.55, 0.8);
  while (y < end) { pts.push([x, y]); y += rnd(10, 22); x += rnd(-12, 12); }
  pts.push([x, end]);
  return pts;
}

function wxFrame(t) {
  WXFX.raf = 0;
  const active = WXFX.scenes.filter(sc => sc.want);
  if (!active.length) return;
  WXFX.raf = requestAnimationFrame(wxFrame);
  const dt = WXFX.last ? Math.min(0.05, (t - WXFX.last) / 1000) : 0.016;
  WXFX.last = t;
  const p = wxPrecip(), night = weatherMood() === 'night';
  for (const sc of active) {
    if (!wxSize(sc)) continue;
    if (!sc.on) { sc.on = true; sc.el.classList.add('on'); if (sc === WX_PILL) island.classList.add('wx-fx'); }
    // weather changed: start the sky over, already full of drops
    const sig = `${p.kind}|${p.amt}`;
    if (sig !== sc.sig) { sc.sig = sig; sc.drops.length = 0; sc.splashes.length = 0; }
    // as the notch grows (pill → panel) or shrinks, add or drop particles so the rain keeps the same feel
    const n = p.kind ? Math.round(sc.w * sc.h * sc.density * (p.kind === 'snow' ? 0.8 : 1) * (0.35 + p.amt * 0.65)) : 0;
    while (sc.drops.length < n) sc.drops.push(p.kind === 'snow' ? wxSpawnFlake(sc, true) : wxSpawnDrop(sc, p, true));
    if (sc.drops.length > n) sc.drops.length = n;
    wxDraw(sc, p, night, dt, t);
  }
}

function wxDraw(sc, p, night, dt, t) {
  const c = sc.ctx, { w, h } = sc;
  c.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  // stars on a clear night (card only): fixed points that twinkle
  if (sc.starsOn && night && !p.kind) {
    if (!sc.stars.length) for (let i = 0; i < Math.round(w * h / 1400); i++) sc.stars.push({ x: rnd(0, w), y: rnd(0, h * 0.75), r: rnd(0.4, 1.2), ph: rnd(0, 6.3), sp: rnd(0.6, 1.8) });
    for (const s of sc.stars) {
      c.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph));
      c.fillStyle = '#eef0ff';
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.fill();
    }
    c.globalAlpha = 1;
  }

  if (p.kind === 'rain') {
    const slant = p.amt >= 0.9 ? 0.26 : 0.13;            // wind: heavier rain falls at more of an angle
    c.lineCap = 'round';
    c.strokeStyle = 'rgb(170, 208, 255)';
    for (let i = 0; i < sc.drops.length; i++) {
      const d = sc.drops[i];
      d.y += d.sp * dt; d.x += d.sp * slant * dt;
      if (d.y - d.len > h) {
        if (sc.splash && d.x > 2 && d.x < w - 2 && Math.random() < 0.7) sc.splashes.push({ x: d.x, t: 0, a: d.a });
        sc.drops[i] = wxSpawnDrop(sc, p, false);
        continue;
      }
      c.globalAlpha = d.a; c.lineWidth = d.w;
      c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - d.len * slant, d.y - d.len); c.stroke();
    }
    // splashes: a tiny widening arc and two droplets at the bottom edge
    c.lineWidth = 1;
    for (let i = sc.splashes.length - 1; i >= 0; i--) {
      const s = sc.splashes[i];
      s.t += dt / 0.32;
      if (s.t >= 1) { sc.splashes.splice(i, 1); continue; }
      const r = 1.5 + s.t * 4.5;
      c.globalAlpha = s.a * (1 - s.t);
      c.beginPath(); c.ellipse(s.x, h - 0.5, r, r * 0.35, 0, Math.PI, 0); c.stroke();
      c.fillStyle = 'rgb(170, 208, 255)';
      const up = Math.sin(s.t * Math.PI) * 3.5;
      c.fillRect(s.x - r * 0.9, h - 1 - up, 1, 1);
      c.fillRect(s.x + r * 0.9, h - 1 - up * 0.8, 1, 1);
    }
  } else if (p.kind === 'snow') {
    c.fillStyle = '#ffffff';
    for (let i = 0; i < sc.drops.length; i++) {
      const f = sc.drops[i];
      f.y += f.sp * dt; f.ph += dt * f.sw;
      const x = f.x + Math.sin(f.ph) * 5 * f.sw;
      if (f.y - f.r > h) { sc.drops[i] = wxSpawnFlake(sc, false); continue; }
      c.globalAlpha = f.a;
      c.beginPath(); c.arc(x, f.y, f.r, 0, 6.283); c.fill();
    }
  }

  // lightning: every few seconds a double flash (and on the card a bolt)
  if (p.storm) {
    const now = performance.now();
    if (!sc.nextFlash) sc.nextFlash = now + rnd(1000, 2500);
    if (now >= sc.nextFlash) {
      sc.flash = 1; sc.flashT = now;
      sc.bolt = sc.boltOn ? wxMakeBolt(sc) : null;
      sc.nextFlash = now + rnd(4000, 5000);   // thunder every 4–5 s, at a random moment
    }
    if (sc.flash > 0) {
      const age = (now - sc.flashT) / 1000;
      // two quick pulses, then fade
      sc.flash = age < 0.08 ? 1 : age < 0.16 ? 0.25 : age < 0.24 ? 0.85 : Math.max(0, 0.85 - (age - 0.24) * 2.2);
      c.globalAlpha = sc.flash * (sc.small ? 0.32 : sc === WX_PILL ? 0.12 : 0.22);
      c.fillStyle = '#dcd6ff';
      c.fillRect(0, 0, w, h);
      if (sc.bolt && sc.flash > 0.2) {
        c.globalAlpha = Math.min(1, sc.flash * 1.1);
        c.strokeStyle = '#fff6c8'; c.lineWidth = 1.6; c.lineJoin = 'round';
        c.shadowColor = 'rgba(200, 190, 255, .9)'; c.shadowBlur = 10;
        c.beginPath(); sc.bolt.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
        c.shadowBlur = 0;
      }
      if (sc.flash <= 0) sc.bolt = null;
    }
  } else sc.flash = 0;
  c.globalAlpha = 1;
}

// safety net: catch any state change the hooks didn't (cheap: it only compares a few flags)
setInterval(() => wxfxEnsure(), 1500);
document.addEventListener('visibilitychange', () => wxfxEnsure());
if (wxReduce.addEventListener) wxReduce.addEventListener('change', () => wxfxEnsure());
