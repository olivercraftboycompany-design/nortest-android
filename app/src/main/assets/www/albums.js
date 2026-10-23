/* nortest 1.8.0 - Albums (from Cadence): the Albums view remembers when you last played an album
   (so it opens on "recent" by default), and looks up proper album art from Apple's public iTunes
   catalog for albums whose songs have no cover of their own. Everything else works like before:
   an album opens as a live list, so Play, Shuffle and the queue behave exactly like a playlist.
   Stored: localStorage nortest.albums.v1. */
(() => {
'use strict';
if (window.__albumsLoaded) return; window.__albumsLoaded = 1;
const KEY = 'nortest.albums.v1';
let store = {}; try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { }
store.t = store.t || {}; store.played = store.played || {}; store.ui = Object.assign({ sort: 'recent' }, store.ui || {});
let saveT = null;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { } }, 500); };
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const akey = s => norm(s.album) + '|' + norm(String(s.artist || '').split(/\s*[,;&/]\s*/)[0]);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* remember when each album was last played */
let lastAlbum = '';
function noteAlbum() {
  try {
    const sn = window.spNow ? window.spNow() : null;
    const s = sn && sn.playing ? (window.spSong ? window.spSong(sn.id) : null) : (!au.paused ? cur : null);
    if (!s || !s.album || s.album === 'Unknown Album') { lastAlbum = ''; return; }
    if (s.album + '|' + s.artist === lastAlbum) return;
    lastAlbum = s.album + '|' + s.artist;
    store.played[akey(s)] = Date.now(); persist();
  } catch (e) { }
}
au.addEventListener('play', noteAlbum);
setInterval(noteAlbum, 2000);

/* one-time album art lookup from Apple's public catalog (no key, CORS open) */
const looking = new Set();
function lookupArt(s) {
  const k = akey(s);
  if (store.t[k]) return store.t[k];
  if (looking.has(k)) return '';
  looking.add(k);
  (async () => {
    try {
      const term = (String(s.artist || '').split(/\s*[,;&/]\s*/)[0] || '') + ' ' + s.album;
      const r = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=album&limit=1&media=music');
      const j = await r.json();
      const x = j.results && j.results[0];
      if (x && x.artworkUrl100) { store.t[k] = x.artworkUrl100.replace('100x100bb', '600x600bb'); persist(); if (view === 'albums') render(); }
    } catch (e) { }
    looking.delete(k);
  })();
  return '';
}
const albArt = s => { const live = byId(s.id); return live && (live.cover || live.art) ? cover(live) : (lookupArt(s) || cover(live)); };
function groups() {
  const m = new Map();
  for (const s of songs) {
    if (!s.album || s.album === 'Unknown Album') continue;
    const k = akey(s);
    const g = m.get(k) || { key: k, name: s.album, artist: String(s.artist || '').split(/\s*[,;&/]\s*/)[0] || '', songs: [], art: '', at: 0 };
    g.songs.push(s.id); m.set(k, g);
  }
  return [...m.values()];
}
window.albumsHTML = sub => {
  const gs = groups();
  for (const g of gs) { g.at = store.played[g.key] || 0; const first = byId(g.songs[0]); g.art = first && (first.cover || first.art) ? cover(first) : (first ? lookupArt(first) : ''); }
  if (sub) {
    const g = gs.find(x => x.key === sub);
    if (!g) { sub = null; return window.albumsHTML(null); }
    const ids = S.sort && S.sort === 'title' ? [...g.songs] : g.songs;
    return `<div class="dhead"><button class="ib" data-a="back" aria-label="Back">${mi('keyboard_arrow_down')}</button></div><div class="phead"><img src="${g.art}" alt=""><div><small>Album</small><h2>${esc(g.name)}</h2><span>${esc(g.artist)} &middot; ${g.songs.length} song${g.songs.length === 1 ? '' : 's'}</span><div class="acts"><button class="btn pri" data-a="playall">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="shufall">${mi('shuffle')}Shuffle</button><button class="btn tonal" data-a="aljam"><span data-i="groups"></span>Listen Together</button></div></div></div>` + list(ids, 'No songs found for this album.');
  }
  const sorted = gs.sort((a, b) => store.ui.sort === 'title' ? a.name.localeCompare(b.name) : (b.at - a.at) || a.name.localeCompare(b.name));
  const chips = `<div class="chips">${[['recent', 'Recently played'], ['title', 'A to Z']].map(([v, t]) => `<button class="chip ${store.ui.sort === v ? 'on' : ''}" data-a="alsort" data-v="${v}">${store.ui.sort === v ? mi('check') : ''}${t}</button>`).join('')}</div>`;
  return chips + (sorted.length ? `<div class="grid">${sorted.map(g => card(g.name, g.artist, g.art, g.key)).join('')}</div>` : '<p class="empty">Albums show up here once your songs have album names.</p>');
};
Object.assign(A, {
  alsort: b => { store.ui.sort = b.dataset.v; persist(); render(); },
  aljam: () => { if (window.JAM && JAM.startList(lastList, null)) return; }
});
})();
