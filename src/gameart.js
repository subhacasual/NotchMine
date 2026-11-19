'use strict';
/* Game posters for game mode.
   1. Steam's own library cache on this PC (no network): the game's install folder gives its Steam
      app id (steamapps/appmanifest_*.acf), and Steam keeps the poster + hero image of every game in
      the library under <Steam>/appcache/librarycache/<appid>/.
   2. Optional, when that has nothing: the public Steam store (no account or key). Only the game's
      name (search) or its Steam app id (image) is sent. Downloads are kept in <userData>/game-art.
   Images are scaled down and handed to the UI as data URLs. */

const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');
const { execFile } = require('child_process');

let cacheDir = '';
let index = {};                        // exe -> appid (number) | 0 (looked up online, nothing found)
const mem = new Map();                 // exe -> Promise<{ poster, hero } | null>

function init(dir) {
  cacheDir = dir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) || {}; } catch { index = {}; }
}
function saveIndex() {
  try { fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(index)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- Steam on this PC
let steamRootP = null;
function steamRoot() {
  if (!steamRootP) {
    steamRootP = new Promise(resolve => {
      execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 4000 }, (err, out) => {
        const m = !err && /SteamPath\s+REG_SZ\s+(.+)/i.exec(out || '');
        resolve(m ? path.normalize(m[1].trim()) : '');
      });
    });
  }
  return steamRootP;
}
// <lib>\steamapps\common\<installdir>\... → the app id from that library's manifests
function steamAppId(exePath) {
  const m = /^(.*?)[\\/]steamapps[\\/]common[\\/]([^\\/]+)/i.exec(exePath || '');
  if (!m) return { appid: 0, lib: '' };
  const lib = m[1], dir = m[2].toLowerCase();
  try {
    const apps = path.join(lib, 'steamapps');
    for (const f of fs.readdirSync(apps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      const txt = fs.readFileSync(path.join(apps, f), 'utf8');
      const d = /"installdir"\s+"([^"]+)"/i.exec(txt);
      if (d && d[1].toLowerCase() === dir) return { appid: +/\d+/.exec(f)[0], lib };
    }
  } catch { /* ignore */ }
  return { appid: 0, lib };
}
// newer Steam: librarycache/<appid>/library_600x900.jpg (sometimes one folder deeper); older: <appid>_library_600x900.jpg
function findCached(cache, appid, name) {
  const dir = path.join(cache, String(appid));
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, name))) return path.join(dir, e.name, name);
    }
  } catch { /* ignore */ }
  const flat = path.join(cache, `${appid}_${name}`);
  return fs.existsSync(flat) ? flat : '';
}

// ---------------------------------------------------------------- images
function toDataUrl(img, width, quality) {
  if (!img || img.isEmpty()) return null;
  const s = img.getSize();
  const out = s.width > width ? img.resize({ width, quality: 'best' }) : img;
  return 'data:image/jpeg;base64,' + out.toJPEG(quality).toString('base64');
}
const fromFile = (p, width, q) => (p ? toDataUrl(nativeImage.createFromPath(p), width, q) : null);

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
}
const CDNS = ['https://shared.akamai.steamstatic.com/store_item_assets/steam/apps', 'https://cdn.cloudflare.steamstatic.com/steam/apps'];
async function download(appid, name) {
  const file = path.join(cacheDir, `${appid}_${name}`);
  if (fs.existsSync(file)) return file;
  for (const base of CDNS) {
    try {
      const res = await fetchWithTimeout(`${base}/${appid}/${name}`);
      if (!res.ok) continue;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return file;
    } catch { /* next */ }
  }
  return '';
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, '');
async function searchAppId(name) {
  const want = norm(name);
  if (want.length < 3) return 0;
  try {
    const q = new URLSearchParams({ term: name, l: 'english', cc: 'US' });
    const res = await fetchWithTimeout(`https://store.steampowered.com/api/storesearch/?${q}`);
    if (!res.ok) return null;
    const items = ((await res.json()).items || []).filter(i => i && i.id && i.name);
    const hit = items.find(i => norm(i.name) === want) || items.find(i => norm(i.name).startsWith(want) || want.startsWith(norm(i.name)));
    return hit ? hit.id : 0;
  } catch { return null; }                // offline: try again next time
}

// ---------------------------------------------------------------- the lookup
async function resolve({ exe, path: exePath, name, online }) {
  const { appid: localId, lib } = steamAppId(exePath);
  // 1) Steam's cache on this PC
  if (localId) {
    const roots = [...new Set([await steamRoot(), lib].filter(Boolean))];
    for (const r of roots) {
      const cache = path.join(r, 'appcache', 'librarycache');
      // the portrait poster: "library_600x900" (older Steam) or "library_capsule" (newer)
      const poster = findCached(cache, localId, 'library_600x900.jpg') || findCached(cache, localId, 'library_capsule.jpg');
      if (poster) return { poster: fromFile(poster, 240, 85), hero: fromFile(findCached(cache, localId, 'library_hero.jpg'), 820, 75) };
    }
  }
  if (!online) return null;
  // 2) the Steam store: by the known app id, else search the name once
  let appid = localId || index[exe];
  if (appid === undefined) {
    appid = await searchAppId(name);
    if (appid === null) return null;
    index[exe] = appid; saveIndex();                          // 0 = not on Steam: don't ask again
  }
  if (!appid) return null;
  const poster = await download(appid, 'library_600x900.jpg');
  if (!poster) return null;
  return { poster: fromFile(poster, 240, 85), hero: fromFile(await download(appid, 'library_hero.jpg'), 820, 75) };
}
function find(q) {
  const key = `${q.exe}|${q.online ? 1 : 0}`;
  if (!mem.has(key)) mem.set(key, resolve(q).catch(() => null));
  return mem.get(key);
}

module.exports = { init, find };
