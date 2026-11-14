'use strict';
/* Album art for players that don't publish any (some browsers / sites, YouTube music videos, VLC …).
   Looks the song up in the public iTunes Search API: free, no account or key. Only the song title
   and artist are sent. Results (and misses) are remembered for the session. */

const { clean } = require('./lyrics');

const cache = new Map();          // "artist|title" -> data URL | null
const norm = s => clean(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const loose = (a, b) => !!a && !!b && (a.includes(b) || b.includes(a));

// "Artist - Song" (usual on YouTube) or plain title + channel/artist
function candidates(title, artist) {
  const t = clean(title);
  const a = String(artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const out = [];
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) out.push({ artist: m[1].trim(), title: clean(m[2]) }, { artist: m[2].trim(), title: clean(m[1]) });
  out.push({ artist: a, title: t });
  return out.filter(c => c.title);
}

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
}

async function lookup(c) {
  const q = new URLSearchParams({ term: `${c.artist} ${c.title}`.trim(), media: 'music', entity: 'song', limit: '8' });
  const res = await fetchWithTimeout(`https://itunes.apple.com/search?${q}`);
  if (!res.ok) return null;
  const data = await res.json();
  const want = norm(c.title), wantArtist = norm(c.artist);
  // only accept a real match: same song title, and the artist when we know one
  const hit = (data.results || []).find(r => loose(norm(r.trackName), want) && (!wantArtist || loose(norm(r.artistName), wantArtist)));
  if (!hit || !hit.artworkUrl100) return null;
  const img = await fetchWithTimeout(hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'));
  if (!img.ok) return null;
  const type = img.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  return `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
}

async function find({ title, artist }) {
  if (!title) return null;
  const key = `${artist}|${title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let result = null, failed = false;
  for (const c of candidates(title, artist)) {
    result = await lookup(c).catch(() => { failed = true; return null; });
    if (result) break;
  }
  if (result || !failed) cache.set(key, result);     // a network hiccup isn't a "no art" answer: try again next time
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { find };
