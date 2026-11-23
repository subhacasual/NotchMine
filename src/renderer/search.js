'use strict';
/* NotchMine search box (search.html). The hotkey (Ctrl+Alt+Space by default) opens it from the notch.
   Everything is ranked here, in one list: apps from Start, your launchpad, NotchMine / Windows commands,
   files (Everything or the Windows index, from main.js), clipboard history, a calculator, unit conversion,
   websites and a web search. What you open is remembered so your usual picks come first. */

const api = window.notch;
const $ = id => document.getElementById(id);
const S = {
  apps: [], shortcuts: [], clip: [], hist: { counts: {}, picks: {}, recent: [] }, settings: {}, home: '',
  ev: null,                // Everything's status { running, installed, … }
  engine: '',              // where the last files came from: everything | windows | none
  q: '', filter: 'all', items: [], sel: 0, moved: false,
  files: [], filesQ: '', fileSeq: 0, fileT: 0,
  open: false,
};
const FILTERS = ['all', 'apps', 'files', 'clip'];
const ENGINE_NAMES = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', brave: 'Brave', ecosia: 'Ecosia' };

// ================================================================== matching
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function initials(text) {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s\-_.()&+]+/).filter(Boolean).map(w => w[0]).join('').toLowerCase();
}
// how well `text` matches the query: { s: score, hl: [[from, to], …] } or null
function match(text, q) {
  const t = text.toLowerCase();
  if (!q) return null;
  if (t === q) return { s: 1000, hl: [[0, q.length]] };
  if (t.startsWith(q)) return { s: 900 - Math.min(80, t.length - q.length), hl: [[0, q.length]] };
  const wb = new RegExp('(^|[\\s\\-_.()\\[\\]/\\\\&+])' + escRe(q)).exec(t);
  if (wb) { const i = wb.index + wb[1].length; return { s: 760 - Math.min(80, i), hl: [[i, i + q.length]] }; }
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const hl = [];
    let allStarts = true;
    for (const w of words) {
      const m = new RegExp('(^|[\\s\\-_.()\\[\\]/\\\\&+])' + escRe(w)).exec(t);
      if (m) { const i = m.index + m[1].length; hl.push([i, i + w.length]); continue; }
      allStarts = false;
      const i = t.indexOf(w);
      if (i < 0) return null;
      hl.push([i, i + w.length]);
    }
    return { s: allStarts ? 680 : 520, hl };
  }
  if (q.length >= 2 && !/\s/.test(q) && initials(text).startsWith(q)) return { s: 780, hl: [] };
  const i = t.indexOf(q);
  if (i >= 0) return { s: 560 - Math.min(80, i), hl: [[i, i + q.length]] };
  if (q.length >= 3) {                                   // the letters in order, close together ("chrm" → Chrome)
    const hl = [];
    let at = 0, gaps = 0, first = -1;
    for (const c of q) {
      const j = t.indexOf(c, at);
      if (j < 0) return null;
      if (first < 0) first = j;
      else if (j > at) gaps += j - at;
      hl.push([j, j + 1]);
      at = j + 1;
    }
    if (at - first > q.length * 3) return null;
    const wordStart = first === 0 || /[\s\-_.()\[\]/\\&+]/.test(t[first - 1]);
    return { s: Math.max(120, 330 - gaps * 12 - (wordStart ? 0 : first * 4) + (wordStart ? 30 : 0)), hl };
  }
  return null;
}
function highlight(text, hl) {
  if (!hl || !hl.length) return esc(text);
  const marks = new Array(text.length).fill(false);
  for (const [a, b] of hl) for (let i = a; i < b && i < text.length; i++) marks[i] = true;
  let out = '', on = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== on) { out += marks[i] ? '<b>' : '</b>'; on = marks[i]; }
    out += esc(text[i]);
  }
  return out + (on ? '</b>' : '');
}
// your usual picks: how often and how lately you opened it, and what you picked last time after typing this
function boost(key, ql) {
  let b = 0;
  const c = S.hist.counts[key];
  if (c) {
    const days = (Date.now() - (c.t || 0)) / 864e5;
    b += Math.min(220, 60 * Math.log2(1 + (c.n || 0))) * (days < 14 ? 1 : days < 60 ? 0.6 : 0.3);
  }
  if (ql && S.hist.picks[ql] === key) b += 450;
  return b;
}

// ================================================================== calculator
const DEG = Math.PI / 180;
const FN = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: x => Math.sin(x * DEG), cos: x => Math.cos(x * DEG), tan: x => Math.tan(x * DEG),
  asin: x => Math.asin(x) / DEG, acos: x => Math.acos(x) / DEG, atan: x => Math.atan(x) / DEG,
  ln: Math.log, log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)), log2: Math.log2, exp: Math.exp,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const TRIG = /\b(a?sin|a?cos|a?tan)\b/i;
const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2 };
function calc(src) {
  let s = src.trim();
  if (!s || s.length > 200 || !/[\d)πa-z]/i.test(s)) return null;
  s = s.replace(/^=\s*/, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^')
    .replace(/(\d|\))\s*x\s*(?=[\d(.])/gi, '$1*')
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
  const pm = /^(.+?)\s*%\s*of\s+(.+)$/i.exec(s);
  if (pm) s = `(${pm[1]})/100*(${pm[2]})`;
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-zπ][a-z0-9]*)|([-+*/^%(),!]))/giy;
  let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] !== undefined) toks.push({ n: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ id: m[2].toLowerCase() });
    else toks.push({ op: m[3] });
  }
  if (re.lastIndex < s.trimEnd().length || !toks.length) return null;
  let i = 0, ops = 0;
  const peek = () => toks[i], isOp = o => toks[i] && toks[i].op === o;
  const fail = () => { throw new Error('no'); };
  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) { const o = toks[i++].op; ops++; const r = term(); v = o === '+' ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = power();
    for (;;) {
      if (isOp('*') || isOp('/')) { const o = toks[i++].op; ops++; const r = power(); v = o === '*' ? v * r : v / r; continue; }
      const t = peek();
      if (t && (t.n !== undefined || t.id || t.op === '(')) { ops++; v *= power(); continue; }   // implicit: 2pi, 3(4+1)
      if (t && t.id === 'mod') { i++; ops++; const r = power(); v %= r; continue; }
      return v;
    }
  }
  function power() {
    const b = unary();
    if (isOp('^')) { i++; ops++; return Math.pow(b, power()); }
    return b;
  }
  function unary() {
    if (isOp('-')) { i++; return -unary(); }
    if (isOp('+')) { i++; return unary(); }
    return postfix();
  }
  function postfix() {
    let v = primary();
    for (;;) {
      if (isOp('%')) { i++; ops++; v /= 100; continue; }
      if (isOp('!')) {
        i++; ops++;
        if (v < 0 || v > 170 || !Number.isInteger(v)) fail();
        let f = 1; for (let k = 2; k <= v; k++) f *= k; v = f; continue;
      }
      return v;
    }
  }
  function primary() {
    const t = toks[i++];
    if (!t) fail();
    if (t.n !== undefined) return t.n;
    if (t.op === '(') { const v = expr(); if (!isOp(')')) fail(); i++; return v; }
    if (t.id) {
      if (t.id in CONSTS) return CONSTS[t.id];
      const fn = FN[t.id];
      if (!fn) fail();
      ops++;
      if (isOp('(')) {
        i++;
        const args = [expr()];
        while (isOp(',')) { i++; args.push(expr()); }
        if (!isOp(')')) fail();
        i++;
        return fn(...args);
      }
      return fn(unary());
    }
    return fail();
  }
  try {
    const v = expr();
    if (i !== toks.length || !ops || !Number.isFinite(v)) return null;
    return { value: v, trig: TRIG.test(s) };
  } catch { return null; }
}
function fmtNum(n, sig = 12) {
  if (Object.is(n, -0)) n = 0;
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-6)) { const e = n.toExponential(8).replace(/\.?0+e/, 'e'); return { show: e, raw: e }; }
  const r = parseFloat(n.toPrecision(sig));
  return { show: r.toLocaleString('en-US', { maximumFractionDigits: 10 }), raw: String(r) };
}

// ================================================================== unit conversion
const UNITS = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, um: 1e-6, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  mass: { mg: 0.001, g: 1, kg: 1000, t: 1e6, oz: 28.349523125, lb: 453.59237, st: 6350.29318 },
  volume: { ml: 0.001, cl: 0.01, dl: 0.1, l: 1, m3: 1000, tsp: 0.00492892, tbsp: 0.0147868, floz: 0.0295735, cup: 0.24, pt: 0.473176, qt: 0.946353, gal: 3.78541 },
  area: { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 1e4, acre: 4046.8564224, in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, mi2: 2589988.110336 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444, 'ft/s': 0.3048 },
  data: { bit: 0.125, B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, mo: 2629746, yr: 31556952 },
  temp: { C: 1, F: 1, K: 1 },
};
const ALIAS = {
  millimeter: 'mm', millimetre: 'mm', centimeter: 'cm', centimetre: 'cm', meter: 'm', metre: 'm', kilometer: 'km', kilometre: 'km', kms: 'km',
  micrometer: 'um', 'µm': 'um', micron: 'um', inch: 'in', inches: 'in', '"': 'in', foot: 'ft', feet: 'ft', "'": 'ft', yard: 'yd', yards: 'yd',
  mile: 'mi', miles: 'mi', 'nautical mile': 'nmi',
  milligram: 'mg', gram: 'g', gm: 'g', kilogram: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', tonne: 't', ton: 't', tons: 't', tonnes: 't',
  ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb', stone: 'st', stones: 'st',
  milliliter: 'ml', millilitre: 'ml', centiliter: 'cl', deciliter: 'dl', liter: 'l', litre: 'l', liters: 'l', litres: 'l', ltr: 'l',
  teaspoon: 'tsp', tablespoon: 'tbsp', 'fl oz': 'floz', 'fluid ounce': 'floz', cups: 'cup', pint: 'pt', pints: 'pt', quart: 'qt', quarts: 'qt', gallon: 'gal', gallons: 'gal',
  'sq m': 'm2', sqm: 'm2', 'm²': 'm2', 'sq km': 'km2', 'km²': 'km2', 'sq ft': 'ft2', sqft: 'ft2', 'ft²': 'ft2', 'sq in': 'in2', 'sq yd': 'yd2', 'sq mi': 'mi2',
  'cm²': 'cm2', 'mm²': 'mm2', hectare: 'ha', hectares: 'ha', acres: 'acre',
  kmh: 'km/h', kph: 'km/h', 'km/hr': 'km/h', kmph: 'km/h', mps: 'm/s', knot: 'kn', knots: 'kn', kt: 'kn', kts: 'kn', fps: 'ft/s',
  bits: 'bit', b: 'B', byte: 'B', bytes: 'B', kb: 'KB', kilobyte: 'KB', mb: 'MB', megabyte: 'MB', gb: 'GB', gigabyte: 'GB', tb: 'TB', terabyte: 'TB', pb: 'PB',
  kib: 'KiB', mib: 'MiB', gib: 'GiB', tib: 'TiB',
  msec: 'ms', millisecond: 'ms', sec: 's', secs: 's', second: 's', seconds: 's', minute: 'min', minutes: 'min', mins: 'min',
  hour: 'h', hours: 'h', hr: 'h', hrs: 'h', day: 'd', days: 'd', week: 'wk', weeks: 'wk', w: 'wk', month: 'mo', months: 'mo', year: 'yr', years: 'yr', y: 'yr', yrs: 'yr',
  c: 'C', '°c': 'C', celsius: 'C', degc: 'C', centigrade: 'C', f: 'F', '°f': 'F', fahrenheit: 'F', degf: 'F', k: 'K', kelvin: 'K',
};
const UNIT_KIND = {};
for (const [kind, us] of Object.entries(UNITS)) for (const u of Object.keys(us)) UNIT_KIND[u] = kind;
function unitOf(raw) {
  let u = raw.trim().replace(/\s+/g, ' ');
  if (!u) return null;
  if (UNIT_KIND[u]) return u;                                         // exact (keeps MB vs Mb style case)
  const l = u.toLowerCase();
  if (ALIAS[l]) return ALIAS[l];
  if (UNIT_KIND[l]) return l;
  const single = l.replace(/s$/, '');
  if (ALIAS[single]) return ALIAS[single];
  if (UNIT_KIND[single]) return single;
  return null;
}
const DEFAULT_TO = {
  m: 'ft', km: 'mi', mi: 'km', cm: 'in', mm: 'in', in: 'cm', ft: 'm', yd: 'm', nmi: 'km',
  kg: 'lb', lb: 'kg', g: 'oz', oz: 'g', st: 'kg', t: 'lb',
  C: 'F', F: 'C', K: 'C', l: 'gal', gal: 'l', ml: 'floz', floz: 'ml', cup: 'ml', pt: 'ml', qt: 'l',
  'km/h': 'mph', mph: 'km/h', 'm/s': 'km/h', kn: 'km/h', m2: 'ft2', ft2: 'm2', ha: 'acre', acre: 'ha', km2: 'mi2', mi2: 'km2',
  GB: 'GiB', GiB: 'GB', TB: 'TiB', MB: 'MiB', h: 'min', min: 's', d: 'h', wk: 'd', yr: 'd',
};
function convert(v, from, to) {
  const kind = UNIT_KIND[from];
  if (!kind || UNIT_KIND[to] !== kind || from === to) return null;
  if (kind === 'temp') {
    const c = from === 'C' ? v : from === 'F' ? (v - 32) * 5 / 9 : v - 273.15;
    return to === 'C' ? c : to === 'F' ? c * 9 / 5 + 32 : c + 273.15;
  }
  return v * UNITS[kind][from] / UNITS[kind][to];
}
const unitLabel = u => ({ C: '°C', F: '°F', K: 'K', m2: 'm²', km2: 'km²', cm2: 'cm²', mm2: 'mm²', ft2: 'ft²', in2: 'in²', yd2: 'yd²', mi2: 'mi²', m3: 'm³', floz: 'fl oz', um: 'µm' }[u] || u);
function units(q) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?|-?\.\d+)\s*([^\d\s].*?)(?:\s+(?:to|in|into|as|=|->|→)\s+(.+?))?\s*$/i.exec(q);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  const from = unitOf(m[2]);
  if (!from || !Number.isFinite(v)) return null;
  const to = m[3] ? unitOf(m[3]) : DEFAULT_TO[from];
  if (!to) return null;
  const r = convert(v, from, to);
  if (r === null || !Number.isFinite(r)) return null;
  const f = fmtNum(r, 7);
  return { show: `${f.show} ${unitLabel(to)}`, raw: f.raw, from: `${fmtNum(v).show} ${unitLabel(from)}`, to };
}

// ================================================================== websites typed as an address
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json|xml|exe|msi|zip|rar|7z|png|jpe?g|gif|webp|svg|mp[34]|mkv|avi|mov|wav|flac|js|ts|py|cs|cpp|h|java|html?|css|lnk|ini|log|bat|ps1|iso)$/i;
function asUrl(q) {
  const t = q.trim();
  if (/\s/.test(t) || t.length < 4) return null;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(t)) return 'http://' + t;
  const m = /^([\w-]+\.)+([a-z]{2,24})(:\d+)?(\/\S*)?$/i.exec(t);
  if (!m || FILE_EXT.test(t.replace(/[/?#].*$/, ''))) return null;
  return 'https://' + t;
}

// ================================================================== commands (NotchMine + Windows)
const COMMANDS = [
  { name: 'party', title: 'Party mode', icon: 'sparkle', kw: 'party lights disco club light show' },
  { name: 'deskeq', title: 'Desktop equalizer on / off', icon: 'mixer', kw: 'equalizer eq visualizer bars desktop' },
  { name: 'taskbar', title: 'Switch taskbar (NotchMine / Windows)', icon: 'tray', kw: 'taskbar dock' },
  { name: 'hide', title: 'Hide / show the notch', icon: 'x', kw: 'hide notch show' },
  { name: 'nmsettings', title: 'NotchMine settings', icon: 'gear', kw: 'notchmine settings preferences options' },
  { name: 'mic', title: 'Mute / unmute the microphone', icon: 'micOff', kw: 'mic microphone mute meeting' },
  { name: 'mute', title: 'Mute / unmute sound', icon: 'mute', kw: 'mute sound volume audio silence' },
  { name: 'playpause', title: 'Play / pause music', icon: 'play', kw: 'play pause music media resume' },
  { name: 'next', title: 'Next track', icon: 'chevR', kw: 'next skip track song' },
  { name: 'prev', title: 'Previous track', icon: 'chevL', kw: 'previous back track song' },
  { name: 'lock', title: 'Lock the PC', icon: 'lock', kw: 'lock screen computer pc away' },
  { name: 'screenshot', title: 'Take a screenshot', icon: 'screenshot', kw: 'screenshot snip capture print screen' },
  { name: 'taskmgr', title: 'Task Manager', icon: 'activity', kw: 'task manager processes kill' },
  { name: 'settings', title: 'Windows Settings', icon: 'gear', kw: 'windows settings control panel' },
  { name: 'wifi', title: 'Wi-Fi networks', icon: 'wifi', kw: 'wifi wi-fi wireless network internet' },
  { name: 'bluetooth', title: 'Bluetooth', icon: 'bluetooth', kw: 'bluetooth devices headphones pair' },
  { name: 'sound', title: 'Sound settings', icon: 'volume', kw: 'sound audio output speakers' },
  { name: 'display', title: 'Display settings', icon: 'sun', kw: 'display screen resolution brightness monitor scale' },
  { name: 'notifications', title: 'Notification centre', icon: 'bell', kw: 'notifications action center centre' },
  { name: 'explorer', title: 'File Explorer', icon: 'folder', kw: 'files explorer folders' },
  { name: 'downloads', title: 'Downloads folder', icon: 'download', kw: 'downloads folder' },
  { name: 'terminal', title: 'Terminal', icon: 'terminal', kw: 'terminal cmd powershell command prompt console shell' },
  { name: 'recycle', title: 'Recycle Bin', icon: 'trash', kw: 'recycle bin trash deleted' },
  { name: 'updates', title: 'Windows Update', icon: 'download', kw: 'windows update updates' },
  { name: 'installed', title: 'Installed apps', icon: 'grid', kw: 'installed apps uninstall programs remove' },
  { name: 'personalize', title: 'Wallpaper & personalisation', icon: 'image', kw: 'wallpaper background personalize personalise theme' },
];

// ================================================================== building the list
const JUNK = /\b(uninstall|uninstaller|readme|read me|help|documentation|release notes|website|license|licence|manual)\b/i;
const HOME_DIRS = /^[a-z]:\\users\\[^\\]+\\(desktop|documents|downloads|pictures|videos|music|onedrive[^\\]*)(\\|$)/i;
function prettyDir(dir) {
  if (S.home && dir.toLowerCase().startsWith(S.home.toLowerCase())) return '~' + dir.slice(S.home.length);
  return dir;
}
// developer and package folders: thousands of files nobody opens by hand
const DEV_DIRS = /\\(site-packages|dist-packages|pkgs|miniconda3?|anaconda3?|\.?venv|__pycache__|\.cache|\.nuget|\.gradle|\.m2|\.cargo|\.rustup|\.npm|vendor|bower_components|obj|\.vs|\.vscode|\.idea|go\\pkg|discovery_cache|typeshed|windowsapps|\.cursor|cache\\uv|cache\\pycache)\\/i;
function fileType(f) {
  if (f.folder) return 'Folder';
  if (/\.lnk$/i.test(f.name)) return 'Shortcut';
  const m = /\.([a-z0-9]{1,6})$/i.exec(f.name);
  return m ? m[1].toUpperCase() : 'File';
}
const fileTitle = f => (/\.lnk$/i.test(f.name) ? f.name.slice(0, -4) : f.name);     // Windows never shows ".lnk" either
function scoreFile(f, ql) {
  const base = f.name.replace(/\.[^.]+$/, '');
  const m = match(fileTitle(f), ql) || match(base, ql);
  let s = m ? m.s : 260;
  const p = f.path.toLowerCase();
  if (p.includes('\\appdata\\')) s -= 160;
  if (DEV_DIRS.test(p)) s -= 220;
  if (/\\(program files|program files \(x86\)|programdata)\\/.test(p)) s -= 70;
  if (HOME_DIRS.test(p)) s += 70;
  // shallow beats deep (D:\Projects over …\a\b\c\projects); hidden tool folders (.claude, .config…) count against it
  const depth = Math.max(0, f.path.split('\\').filter(Boolean).length - 1);
  s -= Math.min(120, depth * 10);
  if (/\\\.[^\\]+\\/.test(f.path + '\\')) s -= 60;
  if (/\\programdata\\/.test(p)) s -= 80;
  if (f.folder) s += depth <= 2 ? 60 : 20;
  if (f.mtime) s += Math.max(0, 60 - (Date.now() - f.mtime) / 864e5);
  if (/\.(tmp|log|dat|db|cache|etl|bak|lock|old|dmp)$/i.test(f.name) || /^(~\$|\.)/.test(f.name)) s -= 120;
  return { s, hl: m ? m.hl : null };
}
const appItem = a => ({ key: 'app:' + a.id, kind: 'app', title: a.n, tag: 'App', icon: { key: 'app:' + a.id, letter: a.n }, run: { kind: 'app', id: a.id } });
function shortcutSub(t) {
  if (/^https?:/i.test(t)) { try { return new URL(t).hostname.replace(/^www\./, ''); } catch { return t; } }
  return t;
}
function build() {
  const q = S.q.trim(), ql = q.toLowerCase(), f = S.filter;
  const special = [], pool = [];
  if (!q) return emptyList();

  let isMath = false;
  if (f === 'all') {
    const c = calc(q);
    if (c) {
      isMath = true;
      const n = fmtNum(c.value);
      special.push({ key: 'calc:', kind: 'calc', big: true, title: '= ' + n.show, sub: q + (c.trig ? '  ·  angles in degrees' : ''), tag: 'Copy',
        icon: { glyph: 'calc', accent: true }, run: { kind: 'copy', text: n.raw } });
    } else {
      const u = units(q);
      if (u) {
        isMath = true;
        special.push({ key: 'unit:', kind: 'unit', big: true, title: u.show, sub: `${u.from}  →  ${unitLabel(u.to)}`, tag: 'Copy',
          icon: { glyph: 'sliders', accent: true }, run: { kind: 'copy', text: u.raw } });
      }
    }
    const url = asUrl(q);
    if (url) special.push({ key: 'url:' + url, kind: 'url', title: 'Open ' + url.replace(/^https?:\/\//i, ''), sub: url, tag: 'Website', icon: { glyph: 'globe', accent: true }, run: { kind: 'url', url } });
  }
  if (f === 'all' || f === 'apps') {
    for (const a of S.apps) {
      const m = match(a.n, ql);
      if (!m) continue;
      let s = m.s + 300;
      if (JUNK.test(a.n) && !JUNK.test(ql)) s -= 380;
      pool.push({ ...appItem(a), score: s, hl: m.hl });
    }
    for (const x of S.shortcuts) {
      const m = match(x.name, ql);
      if (!m) continue;
      pool.push({ key: 'sc:' + x.id, kind: 'shortcut', title: x.name, sub: shortcutSub(x.target), tag: 'Launchpad', score: m.s + 300, hl: m.hl,
        icon: x.icon ? { src: x.icon, letter: x.name } : { letter: x.name }, run: { kind: 'shortcut', id: x.id } });
    }
    for (const c of COMMANDS) {
      let m = match(c.title, ql), s = m ? m.s : 0;
      if (!m) {
        const kw = c.kw.split(' ').some(w => w.startsWith(ql)) || (ql.length > 3 && c.kw.includes(ql));
        if (!kw) continue;
        s = 600; m = { hl: [] };
      }
      pool.push({ key: 'cmd:' + c.name, kind: 'command', title: c.title, tag: 'Command', score: s + 140, hl: m.hl, icon: { glyph: c.icon }, run: { kind: 'command', name: c.name } });
    }
  }
  if ((f === 'all' || f === 'files') && S.filesQ === q && !isMath) {
    const appNames = new Set(S.apps.map(a => a.n.toLowerCase()));
    const files = [];
    for (const x of S.files) {
      const title = fileTitle(x);
      if (/\.lnk$/i.test(x.name) && appNames.has(title.toLowerCase())) continue;   // a desktop shortcut to an app that's already listed
      if (f === 'all' && DEV_DIRS.test(x.path)) continue;                          // package caches: only under the Files filter
      const r = scoreFile(x, ql);
      files.push({ key: 'file:' + x.path.toLowerCase(), kind: 'file', title, sub: prettyDir(x.dir), tag: fileType(x), score: r.s, hl: r.hl,
        icon: { key: 'file:' + x.path, letter: x.name }, run: { kind: 'file', path: x.path }, path: x.path, same: x.name.toLowerCase() });
    }
    // the same file name in many folders (copies, package caches): the two best ones
    files.sort((a, b) => b.score - a.score);
    const seen = {};
    for (const it of files) if ((seen[it.same] = (seen[it.same] || 0) + 1) <= 2) pool.push(it);
  }
  if ((f === 'all' || f === 'clip') && S.settings.searchClipboard !== false && ql.length >= 2) {
    for (const t of S.clip) {
      const tl = t.toLowerCase(), i = tl.indexOf(ql);
      if (i < 0) continue;
      const line = t.replace(/\s+/g, ' ').trim();
      pool.push({ key: 'clip:' + t.slice(0, 80), kind: 'clip', title: line.slice(0, 120), sub: `Clipboard · ${t.length} characters`, tag: 'Copy',
        score: 300 + (i === 0 ? 100 : 0), hl: line.toLowerCase().indexOf(ql) >= 0 ? [[line.toLowerCase().indexOf(ql), line.toLowerCase().indexOf(ql) + ql.length]] : [],
        icon: { glyph: 'clipboard' }, run: { kind: 'copy', text: t } });
    }
  }
  for (const it of pool) it.score += boost(it.key, ql);
  pool.sort((a, b) => b.score - a.score);

  let list = pool;
  if (f === 'all') {
    const cap = { app: 6, shortcut: 3, command: 3, file: 8, clip: 3 }, n = {};
    list = pool.filter(it => (n[it.kind] = (n[it.kind] || 0) + 1) <= cap[it.kind]).slice(0, 12);
  } else list = pool.slice(0, 60);

  const out = [...special, ...list];
  if (f !== 'clip') {
    const name = ENGINE_NAMES[S.settings.searchEngine] || 'Google';
    const web = { key: 'web:', kind: 'web', title: `Search ${name} for “${q}”`, tag: 'Web', icon: { glyph: 'search', accent: true }, run: { kind: 'web', q } };
    // a question ("capital of india"): the web answer is what you're after, so it comes first
    if (f === 'all' && !special.length && isQuestion(q)) out.unshift(web);
    else out.push(web);
  }
  return out;
}
// ================================================================== the answer page (questions → the search engine's results)
// Main lays a small browser view over #pv. It opens by itself for questions after you pause typing, or when you
// move to the "Search … for" row. Settings → Search can switch it off.
const QWORDS = /^(what|what's|whats|who|who's|whom|whose|when|where|where's|why|how|how's|which|is|are|was|were|do|does|did|can|could|should|will|would|define|definition|meaning|capital|population|weather|time in|distance|height of|age of|net worth|price of|news|translate|tell me)/i;
const isQuestion = q => /\?\s*$/.test(q) || QWORDS.test(q.trim());
const PV = { on: false, q: '', t: 0 };
function previewWanted() {
  if (S.settings.searchPreview === false || S.filter !== 'all' || !S.open) return false;
  const q = S.q.trim();
  if (q.length < 3) return false;
  if (S.items.some(i => i.kind === 'calc' || i.kind === 'unit' || i.kind === 'url')) return false;
  const sel = S.items[S.sel];
  if (sel && sel.kind === 'web' && (S.moved || S.sel === 0)) return true;      // on the web row
  if (isQuestion(q)) return true;
  if (q.split(/\s+/).length >= 3) {                                          // a phrase nothing on the PC matches well
    const best = S.items.find(i => i.kind !== 'web');
    return !best || (best.score || 0) < 900;
  }
  return false;
}
function previewOff() {
  clearTimeout(PV.t);
  if (!PV.on) return;
  PV.on = false;
  renderFoot();
  $('box').classList.remove('with-pv');
  $('pv').hidden = true;
  api.searchPreview(null);
}
function syncPreview() {
  clearTimeout(PV.t);
  if (!previewWanted()) { previewOff(); return; }
  const q = S.q.trim();
  const go = () => {
    const fresh = !PV.on || PV.q !== q;
    PV.on = true; PV.q = q;
    $('box').classList.add('with-pv');
    $('pv').hidden = false;
    if (fresh) { $('pvTxt').textContent = `Asking ${ENGINE_NAMES[S.settings.searchEngine] || 'Google'}…`; $('pv').classList.remove('err'); }
    if (fresh) renderFoot();
    requestAnimationFrame(() => {
      if (!PV.on) return;
      const r = $('pv').getBoundingClientRect();
      api.searchPreview({ q, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
    });
  };
  if (PV.on && PV.q === q) go();                     // same question: just keep the page lined up with the box
  else PV.t = setTimeout(go, PV.on ? 450 : 650);     // wait until you stop typing
}
api.on('search-preview-state', st => {
  if (!st) return;
  const name = ENGINE_NAMES[S.settings.searchEngine] || 'Google';
  $('pv').classList.toggle('err', !!st.error);
  if (st.error) $('pvTxt').textContent = `Couldn't reach ${name}. Check your internet connection.`;
  else if (st.loading) $('pvTxt').textContent = `Asking ${name}…`;
});

// before you type: what you opened lately (or, in a filter, everything in it)
function emptyList() {
  const f = S.filter;
  if (f === 'apps') return [...S.apps].sort((a, b) => a.n.localeCompare(b.n)).filter(a => !JUNK.test(a.n)).slice(0, 300).map(appItem);
  if (f === 'clip') {
    return S.clip.map(t => ({ key: 'clip:' + t.slice(0, 80), kind: 'clip', title: t.replace(/\s+/g, ' ').trim().slice(0, 120), sub: `${t.length} characters`, tag: 'Copy',
      icon: { glyph: 'clipboard' }, run: { kind: 'copy', text: t } }));
  }
  const rec = (S.hist.recent || []).filter(r => r && r.run && (f === 'all' || r.kind === 'file'));
  const TAGS = { app: 'App', file: 'File', command: 'Command', shortcut: 'Launchpad', clip: 'Copy', url: 'Website', web: 'Web' };
  const item = r => {
    const sc = r.kind === 'shortcut' && S.shortcuts.find(x => 'sc:' + x.id === r.key);   // launchpad pictures aren't kept in the history
    return { ...r, recent: true, icon: sc && sc.icon ? { src: sc.icon } : r.icon, tag: r.tag || TAGS[r.kind] || '' };
  };
  if (f === 'files') return rec.slice(0, 20).map(item);
  // All: recent things grouped by kind, newest first in each, a few of each
  const out = [];
  for (const g of RECENT_GROUPS) {
    const list = rec.filter(r => g.kinds.includes(r.kind)).slice(0, g.max);
    for (const r of list) out.push({ ...item(r), section: g.title });
  }
  return out;
}
const RECENT_GROUPS = [
  { title: 'Recent files & folders', kinds: ['file'], max: 5 },
  { title: 'Recent apps', kinds: ['app', 'shortcut'], max: 4 },
  { title: 'Recent web searches', kinds: ['web', 'url'], max: 4 },
  { title: 'Recent commands', kinds: ['command', 'clip'], max: 3 },
];

// ================================================================== drawing
const iconCache = new Map();          // key → data URL | null
function iconHtml(ic) {
  if (!ic) return '<span class="ic"></span>';
  if (ic.glyph) return `<span class="ic glyph${ic.accent ? ' accent' : ''}">${icon(ic.glyph)}</span>`;
  const src = ic.src || (ic.key && iconCache.get(ic.key));
  if (src) return `<span class="ic"><img src="${esc(src)}" alt=""></span>`;
  const l = (ic.letter || '?').trim();
  return `<span class="ic letter" data-ik="${esc(ic.key || '')}" style="background:${avatarColor(l)}">${esc((l[0] || '?').toUpperCase())}</span>`;
}
function wantIcon(key) {
  if (!key || iconCache.has(key)) return;
  iconCache.set(key, null);
  api.searchIcon(key).then(url => {
    if (!url) return;
    iconCache.set(key, url);
    document.querySelectorAll(`.ic.letter[data-ik="${CSS.escape(key)}"]`).forEach(el => {
      el.className = 'ic';
      el.removeAttribute('style');
      el.innerHTML = `<img src="${esc(url)}" alt="">`;
    });
  }).catch(() => {});
}
function render() {
  const prevKey = S.items[S.sel] && S.items[S.sel].key;
  S.items = build();
  if (S.moved && prevKey) {
    const i = S.items.findIndex(it => it.key === prevKey);
    S.sel = i >= 0 ? i : 0;
    if (i < 0) S.moved = false;
  } else S.sel = 0;
  const list = $('list');
  let html = '';
  if (!S.q.trim() && S.filter === 'all') html += tipsHtml();      // what you can type, every time the box opens
  if (!S.q.trim() && S.filter === 'files' && !S.items.length) html += '<div class="sec-h">Type a file or folder name</div>';
  if (!S.q.trim() && S.filter === 'clip' && !S.items.length) html += '<div class="sec-h">Nothing copied yet</div>';
  let section = '';
  html += S.items.map((it, i) => `${it.section && it.section !== section ? `<div class="sec-h">${esc((section = it.section))}</div>` : ''}
    <div class="row${it.big ? ' big' : ''}${i === S.sel ? ' sel' : ''}" data-i="${i}" role="option" aria-selected="${i === S.sel}"${it.kind === 'file' ? ' draggable="true"' : ''}>
      ${iconHtml(it.icon)}
      <span class="tx"><span class="t">${highlight(it.title, it.hl)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</span>
      <span class="tag">${esc(it.tag || '')}</span>
    </div>`).join('');
  list.innerHTML = html;
  for (const it of S.items) if (it.icon && it.icon.key && !it.icon.src) wantIcon(it.icon.key);
  scrollSel();
  renderFoot();
  syncPreview();
}
function tipsHtml() {
  return `<div class="tips">
    <div class="tip"><span>Apps &amp; files</span><code>chrome · invoice 2024 · ext:pdf tax</code></div>
    <div class="tip"><span>Maths</span><code>18% of 2450 · sqrt(2)*pi</code></div>
    <div class="tip"><span>Units</span><code>5 km to mi · 72 f to c · 4 GB in MB</code></div>
    <div class="tip"><span>Commands</span><code>party · lock · bluetooth · mute</code></div>
    <div class="tip"><span>Questions</span><code>capital of india · how tall is mount everest</code></div>
  </div>`;
}
function select(i, { scroll = true } = {}) {
  if (!S.items.length) return;
  const n = S.items.length;
  S.sel = ((i % n) + n) % n;
  S.moved = true;
  document.querySelectorAll('.row').forEach(r => {
    const on = Number(r.dataset.i) === S.sel;
    r.classList.toggle('sel', on);
    r.setAttribute('aria-selected', on);
  });
  if (scroll) scrollSel();
  renderFoot();
  syncPreview();
}
function scrollSel() {
  const r = document.querySelector('.row.sel');
  if (r) r.scrollIntoView({ block: 'nearest' });
}
function renderFoot() {
  const src = $('src');
  const ev = S.ev;
  const filesWanted = S.settings.searchFiles !== false;
  if (!filesWanted) { src.className = 'src'; src.innerHTML = '<span class="dot"></span>File search is off'; }
  else if (S.engine === 'everything' || (ev && ev.running)) { src.className = 'src fast'; src.innerHTML = '<span class="dot"></span>Files by Everything'; }
  else if (ev && ev.installed) { src.className = 'src slow'; src.innerHTML = '<span class="dot"></span>Everything isn\'t running · <a data-ev="start">Start it</a>'; }
  else if (ev) { src.className = 'src slow'; src.innerHTML = '<span class="dot"></span>Windows index · <a data-ev="get">Get Everything</a> for instant file search'; }
  else { src.className = 'src'; src.innerHTML = '<span class="dot"></span>'; }
  const it = S.items[S.sel];
  const keys = [];
  if (it) {
    const verb = it.recent && it.kind === 'web' ? 'Ask again' : ({ copy: 'Copy', web: PV.on ? 'Open in browser' : 'Search', url: 'Open', command: 'Run' }[it.run.kind] || 'Open');
    keys.push(`<span><kbd>↵</kbd>${verb}</span>`);
    if (it.kind === 'file') keys.push('<span><kbd>Ctrl ↵</kbd>Show in folder</span>');
    if (it.recent) keys.push('<span><kbd>Del</kbd>Forget</span>');
  }
  keys.push('<span><kbd>Tab</kbd>Filter</span>');
  $('keys').innerHTML = keys.join('');
}

// ================================================================== files (asked from main.js, newest answer wins)
function askFiles() {
  clearTimeout(S.fileT);
  const q = S.q.trim();
  if (q.length < 2 || !['all', 'files'].includes(S.filter) || S.settings.searchFiles === false || calc(q) || units(q)) return;
  if (S.filesQ === q) return;
  S.fileT = setTimeout(async () => {
    const seq = ++S.fileSeq;
    const r = await api.searchFiles(q);
    if (seq !== S.fileSeq || S.q.trim() !== q) return;
    S.files = (r && Array.isArray(r.items)) ? r.items : [];
    S.filesQ = q;
    if (r && r.engine) S.engine = r.engine;
    render();
  }, S.filter === 'files' ? 25 : 60);
}

// ================================================================== actions
function runItem(it, alt) {
  if (!it) return;
  if (it.recent && it.kind === 'web' && !alt) {                // a recent question: ask it again, here in the box
    $('q').value = it.run.q;
    S.q = it.run.q;
    S.moved = false;
    render();
    askFiles();
    return;
  }
  const plain = { key: it.key, kind: it.kind, title: it.title, sub: it.sub || '', tag: it.tag || '', run: it.run, icon: it.icon && !it.icon.src ? it.icon : (it.icon ? { letter: it.icon.letter } : null) };
  api.searchRun(plain, S.q, alt);
}
function setFilter(f) {
  S.filter = FILTERS.includes(f) ? f : 'all';
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.f === S.filter));
  S.moved = false;
  render();
  askFiles();
}

$('q').addEventListener('input', e => {
  S.q = e.target.value;
  S.moved = false;
  render();
  askFiles();
});
$('q').addEventListener('keydown', e => {
  const it = S.items[S.sel];
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); select(S.sel + 1); break;
    case 'ArrowUp': e.preventDefault(); select(S.sel - 1); break;
    case 'PageDown': e.preventDefault(); select(Math.min(S.items.length - 1, S.sel + 6)); break;
    case 'PageUp': e.preventDefault(); select(Math.max(0, S.sel - 6)); break;
    case 'Tab': {
      e.preventDefault();
      const i = FILTERS.indexOf(S.filter);
      setFilter(FILTERS[(i + (e.shiftKey ? -1 : 1) + FILTERS.length) % FILTERS.length]);
      break;
    }
    case 'Enter':
      e.preventDefault();
      if (!it) break;
      if (e.ctrlKey && it.kind === 'file') runItem(it, 'reveal');
      else runItem(it);
      break;
    case 'Escape':
      e.preventDefault();
      if (S.q) { e.target.value = ''; S.q = ''; S.moved = false; render(); }
      else if (S.filter !== 'all') setFilter('all');
      else api.searchHide();
      break;
    case 'Delete':
      if (!S.q && it && it.recent) {
        e.preventDefault();
        api.searchForget(it.key);
        S.hist.recent = (S.hist.recent || []).filter(r => r.key !== it.key);
        delete S.hist.counts[it.key];
        render();
      }
      break;
    case 'C': case 'c':
      if (e.ctrlKey && e.shiftKey && it && it.kind === 'file') { e.preventDefault(); runItem(it, 'copypath'); }
      break;
  }
});
$('chips').addEventListener('mousedown', e => e.preventDefault());       // keep the typing focus
$('chips').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (b) setFilter(b.dataset.f); });
$('list').addEventListener('mousedown', e => e.preventDefault());
$('list').addEventListener('mousemove', e => {
  const r = e.target.closest('.row');
  if (r && Number(r.dataset.i) !== S.sel) select(Number(r.dataset.i), { scroll: false });
});
$('list').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (!r) return;
  const it = S.items[Number(r.dataset.i)];
  runItem(it, e.ctrlKey && it && it.kind === 'file' ? 'reveal' : '');
});
$('list').addEventListener('dragstart', e => {
  const r = e.target.closest('.row');
  const it = r && S.items[Number(r.dataset.i)];
  e.preventDefault();
  if (it && it.kind === 'file') api.searchDrag(it.path);
});
$('foot').addEventListener('mousedown', e => e.preventDefault());
$('foot').addEventListener('click', e => {
  const a = e.target.closest('a[data-ev]');
  if (a) api.searchEverything(a.dataset.ev);
});
// a click on the see-through part of the window closes it, like clicking anywhere else
document.addEventListener('mousedown', e => { if (!e.target.closest('#box')) api.searchHide(); });

// ================================================================== open / close
function layout(offset) {
  const box = $('box'), wrap = $('wrap');
  const W = wrap.clientWidth, bw = Math.min(660, W - 24);
  document.documentElement.style.setProperty('--box-w', bw + 'px');
  const left = Math.round(Math.max(12, Math.min(W - bw - 12, (offset || W / 2) - bw / 2)));
  box.style.left = left + 'px';
  $('earL').style.left = (left - 15.5) + 'px';
  $('earR').style.left = (left + bw - 0.5) + 'px';
}
api.on('search-open', p => {
  S.apps = Array.isArray(p.apps) ? p.apps : [];
  S.shortcuts = Array.isArray(p.shortcuts) ? p.shortcuts : [];
  S.clip = Array.isArray(p.clipboard) ? p.clipboard : [];
  S.hist = p.history || { counts: {}, picks: {}, recent: [] };
  S.settings = p.settings || {};
  S.home = p.home || '';
  if (typeof p.everything === 'boolean' && !S.ev) S.ev = { running: p.everything };
  const root = document.documentElement;
  root.dataset.theme = S.settings.theme || 'midnight';
  root.dataset.island = p.island ? '1' : '0';
  if (p.accent) root.style.setProperty('--accent', p.accent);
  S.q = ''; S.filter = 'all'; S.sel = 0; S.moved = false; S.files = []; S.filesQ = ''; S.fileSeq++;
  $('q').value = '';
  S.open = true;
  document.querySelectorAll('#chips button').forEach(b => b.classList.toggle('on', b.dataset.f === 'all'));
  layout(p.offset);
  render();
  S.open = true;
  const box = $('box');
  box.classList.remove('open'); $('wrap').classList.remove('open');
  void box.offsetWidth;                                  // restart the grow animation
  requestAnimationFrame(() => { box.classList.add('open'); $('wrap').classList.add('open'); });
  $('q').focus();
});
api.on('search-close', () => {
  S.open = false;
  clearTimeout(PV.t);
  PV.on = false; PV.q = '';
  $('box').classList.remove('with-pv');
  $('pv').hidden = true;
  $('box').classList.remove('open');
  $('wrap').classList.remove('open');
});
api.on('search-status', st => { S.ev = st || { running: false }; renderFoot(); });
api.on('search-apps', list => { if (Array.isArray(list)) { S.apps = list; if (S.open) render(); } });
api.on('search-accent', rgb => { if (typeof rgb === 'string') document.documentElement.style.setProperty('--accent', rgb); });
window.addEventListener('focus', () => $('q').focus());

hydrateIcons();
