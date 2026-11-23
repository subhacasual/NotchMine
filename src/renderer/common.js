'use strict';
/* Helpers shared by the notch (index.html) and the settings window (settings.html). Loaded before either's scripts. */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// accent colours (rgb triplets, as CSS --accent wants them)
const DEFAULT_ACCENT = '167, 139, 250';
const ACCENTS = {
  purple: DEFAULT_ACCENT, blue: '10, 132, 255', teal: '64, 200, 224', green: '48, 209, 88',
  orange: '255, 159, 10', pink: '255, 55, 135', red: '255, 69, 58',
};
function hexToRgbStr(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}

// visualizer colour presets (Settings → Appearance → Visualizer colours)
const VIZ_PRESETS = {
  rainbow: ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#40c8e0', '#0a84ff', '#bf5af2'],
  sunset: ['#ff5f6d', '#ff9966', '#ffc371'],
  ocean: ['#00c6ff', '#0072ff', '#7b5cff'],
  neon: ['#ff00cc', '#7a5cff', '#00f0ff'],
  fire: ['#ff2a00', '#ff7b00', '#ffd000'],
  aurora: ['#30d0c0', '#7b5cff', '#ff3787'],
};

// a stable colour for an app's letter tile
function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 55%, 42%)`;
}

// WMO weather code → icon
function wxIcon(code, day) {
  if (code === 0) return day ? 'wxClear' : 'wxClearN';
  if (code === 1 || code === 2) return day ? 'wxPartly' : 'wxPartlyN';
  if (code === 45 || code === 48) return 'wxFog';
  if (code >= 95) return 'wxStorm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'wxSnow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'wxRain';
  return 'wxCloud';
}
