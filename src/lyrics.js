'use strict';
/* Synced lyrics from LRCLIB (https://lrclib.net): free, open, no account or key.
   Only the song title / artist / album / duration are sent. Results are cached on disk. */

const fs = require('fs');

const UA = 'NotchMine/1.0 (Windows desktop notch widget)';
let cacheFile = null;
let cache = {};

function init(file) {
  cacheFile = file;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(cache);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete cache[k];
    try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* ignore */ }
  }, 1000);
}

// Strip the YouTube-style noise from titles: "(Official Video)", "[4K]", "| Album", "ft. X" …
function clean(s) {
  return String(s || '')
    .replace(/\s*[([{][^)\]}]*\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|remaster(ed)?|hd|hq|4k|mv|m\/v|full song|explicit)\b[^)\]}]*[)\]}]/gi, '')
    .replace(/\s*\|.*$/, '')
    .replace(/\s+[-–—]\s+(topic|official.*)$/i, '')
    .replace(/\s+(ft\.?|feat\.?|featuring)\s.+$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function candidates(title, artist) {
  const t = clean(title);
  const a = String(artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const out = [];
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);       // "Artist - Song" (common on YouTube)
  if (m) out.push({ artist: m[1].trim(), title: clean(m[2]) });
  out.push({ artist: a, title: t });
  if (m) out.push({ artist: m[2].trim(), title: clean(m[1]) });   // sometimes it's "Song - Artist"
  return out.filter(c => c.title);
}

function parseLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3]) / (s[3].length === 3 ? 1000 : 100) : 0;
      lines.push({ t: Number(s[1]) * 60 + Number(s[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Lrclib-Client': UA }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

function shape(rec) {
  if (!rec) return null;
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics) : null;
  const plain = rec.plainLyrics || null;
  if (!synced?.length && !plain) return null;
  return { synced: synced && synced.length ? synced : null, plain, instrumental: !!rec.instrumental, track: rec.trackName, artist: rec.artistName };
}

async function find({ title, artist, album, duration }) {
  const key = `${artist}|${title}`.toLowerCase();
  if (cache[key] !== undefined) return cache[key];
  let result = null;
  for (const c of candidates(title, artist)) {
    if (!c.artist) continue;
    const q = new URLSearchParams({ track_name: c.title, artist_name: c.artist });
    if (album) q.set('album_name', album);
    if (duration > 0) q.set('duration', String(Math.round(duration)));
    result = shape(await getJson(`https://lrclib.net/api/get?${q}`).catch(() => null));
    if (result) break;
  }
  if (!result) {
    // fuzzy search, prefer synced lyrics with a matching length
    for (const c of candidates(title, artist)) {
      const q = new URLSearchParams({ track_name: c.title });
      if (c.artist) q.set('artist_name', c.artist);
      const list = await getJson(`https://lrclib.net/api/search?${q}`).catch(() => null);
      if (Array.isArray(list) && list.length) {
        const scored = list
          .map(r => ({ r, s: (r.syncedLyrics ? 0 : 1000) + (duration > 0 && r.duration ? Math.abs(r.duration - duration) : 30) }))
          .sort((a, b) => a.s - b.s);
        if (!(duration > 0) || !scored[0].r.duration || Math.abs(scored[0].r.duration - duration) < 15) {
          result = shape(scored[0].r);
          if (result) break;
        }
      }
    }
  }
  cache[key] = result;   // remember misses too, so we don't keep asking
  save();
  return result;
}

module.exports = { init, find, clean };
