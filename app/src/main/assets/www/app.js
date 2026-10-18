const $ = s => document.querySelector(s), au = $('#au'), A = {};
/* icons: Material Symbols Rounded from m3.js; transport icons are filled */
const ICN = { play: 'play_arrow', pause: 'pause', next: 'skip_next', prev: 'skip_previous', heart: 'favorite', dots: 'more_vert' };
const ic = (n, fill) => mi(ICN[n] || n, fill ?? ['play', 'pause', 'next', 'prev'].includes(n));
const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3a3f4a"/><path d="M58 30v32a10 10 0 1 1-6-9V30h18v8H58z" fill="#c9cfdc"/></svg>');
/* a song without cover art gets its initials on a square tinted from its title */
const phCache = {};
const phFor = s => {
  const t = String((s && s.title) || '').trim();
  if (!t) return PH;
  if (phCache[t]) return phCache[t];
  let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const ini = t.split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).slice(0, 2).map(w => w.match(/[a-z0-9]/i)[0].toUpperCase()).join('') || '#';
  return (phCache[t] = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${h} 38% 30%)"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Google Sans Flex,Roboto,Arial,sans-serif" font-weight="700" font-size="38" fill="hsl(${h} 70% 88%)">${ini.replace(/[<&>]/g, '')}</text></svg>`));
};
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';

/* ---------- IndexedDB ---------- */
const db = new Promise((res, rej) => {
  const q = indexedDB.open('nortest', 1);
  q.onupgradeneeded = () => {
    const d = q.result;
    d.createObjectStore('songs', { keyPath: 'id' });
    d.createObjectStore('playlists', { keyPath: 'id' });
    d.createObjectStore('meta', { keyPath: 'k' });
  };
  q.onsuccess = () => res(q.result);
  q.onerror = rej;
});
const tx = async (s, m, f) => {
  const d = await db;
  return new Promise((res, rej) => {
    const t = d.transaction(s, m), q = f(t.objectStore(s));
    t.oncomplete = () => res(q && q.result);
    t.onerror = rej;
  });
};
const all = s => tx(s, 'readonly', o => o.getAll());
const put = (s, v) => (s === 'songs' && v && v.device) ? devPut(v) : tx(s, 'readwrite', o => o.put(v));
const del = (s, k) => tx(s, 'readwrite', o => o.delete(k));
const meta = async k => (await tx('meta', 'readonly', o => o.get(k)))?.v;
const save = (k, v) => put('meta', { k, v });

/* ---------- State ---------- */
let songs = [], pls = [], queue = [], qi = -1, hist = [], cur = null, url = '', ctx, F = {};
let S = { bass: 0, mid: 0, treb: 0, vol: 1, speed: 1, blur: 24, accent: '#1ed760', sort: 'added', shuf: false, rep: 0, showOut: true, hideMini: false, sink: '' };
let sleepT, sleepMin = 0;
let view = 'library', sub = null, lastList = [], covers = {};
const byId = id => songs.find(s => s.id === id);
const cover = s => s && s.cover ? (covers[s.id] ||= URL.createObjectURL(s.cover)) : s && s.art ? s.art : s ? phFor(s) : PH;
const dropCover = id => { if (covers[id]) { URL.revokeObjectURL(covers[id]); delete covers[id]; } };

/* ---------- Music on the phone (Android app only) ----------
   The Nortest app lists every music file on the phone. Those songs are mixed into
   `songs` with device:true and play straight from the phone (nothing is copied);
   they never go into IndexedDB or backups. Favorites, edits and lyrics for them are
   kept in meta 'devov'. On the website NN is null and none of this runs. */
const NN = window.NortestNative && window.NortestNative.deviceSongs ? window.NortestNative : null;
const DEVB = location.origin + '/devicemusic/';
let dev = [], devOv = {}, devPerm = '', devScan = false;
const own = () => songs.filter(s => !s.device);
const devKey = s => (s.title + '|' + s.artist.split(/\s*[;\/,&]\s*/)[0]).toLowerCase().replace(/[^a-z0-9|]+/g, '');
const devSong = r => {
  const id = 'dev:' + r.id, o = { title: r.t || 'Unknown song', artist: r.ar || 'Unknown Artist', album: r.al || 'Unknown Album' };
  return { id, device: true, mid: r.id, _o: o, ...o, lyrics: '', fav: false, added: (r.ad || 0) * 1000, dur: (r.d || 0) / 1000, src: DEVB + 'audio/' + r.id, art: DEVB + 'art/' + r.id, cover: null, ...(devOv[id] || {}) };
};
/* imported songs + phone songs (skipping hidden ones and copies of songs he already imported) */
const mergeDev = a => {
  const mine = a.filter(s => !s.device), seen = {};
  mine.forEach(s => (seen[devKey(s)] ??= []).push(s.dur || 0));
  return mine.concat(dev.filter(s => !s.hidden && !(seen[devKey(s)] || []).some(d => !d || !s.dur || Math.abs(d - s.dur) < 4)));
};
const devPut = s => {
  const o = {};
  ['fav', 'synced', 'lyrics', 'syncTried', 'hidden'].forEach(k => { if (s[k]) o[k] = s[k]; });
  ['title', 'artist', 'album'].forEach(k => { if (s[k] !== s._o[k]) o[k] = s[k]; });
  if (Object.keys(o).length) devOv[s.id] = o; else delete devOv[s.id];
  return save('devov', devOv);
};
const devRead = () => { try { dev = JSON.parse(NN.deviceSongs() || '[]').map(devSong); } catch (e) { dev = []; } };
function devRefresh() {
  if (!NN) return;
  devRead();
  songs = mergeDev(songs);
  if (cur && cur.device) cur = byId(cur.id) || cur;
  let ch = false;
  for (let i = queue.length; i--;) if (i !== qi && !byId(queue[i])) { queue.splice(i, 1); if (i < qi) qi--; ch = true; }
  if (ch) refreshQ();
  devScan = false;
  render();
}
window.__nortestDev = ev => {
  if (!NN) return;
  if (ev === 'perm') { devPerm = NN.musicPermission(); if (devPerm !== 'granted') { dev = []; songs = mergeDev(songs); } render(); }
  else if (ev === 'scan') { devScan = true; render(); }
  else if (ev === 'scandone') { if (devScan) { devScan = false; render(); } }
  else devRefresh();
};
const devBanner = () => {
  if (!NN || devPerm === 'granted') return '';
  const blocked = devPerm === 'blocked';
  return `<div class="devban"><span class="dvi">${mi('library_music', 1)}</span><div><b>${blocked ? 'Music access is off' : 'Add the music on your phone'}</b><p>${blocked ? 'Songs on your phone can\'t show here. Turn on <b>Music and audio</b> in Settings &gt; Permissions.' : 'Every song on your phone shows up here too. Nothing gets copied.'}</p><button class="btn pri" data-a="${blocked ? 'dset' : 'dallow'}">${blocked ? 'Open settings' : 'Allow music access'}</button></div></div>`;
};
/* filter chips: All / Imported / On this phone, plus Rescan and hidden songs */
const devTools = () => {
  if (!NN || devPerm !== 'granted') return '';
  const nh = dev.filter(s => s.hidden).length, v = S.src || 'all';
  return `<div class="chips" role="group" aria-label="Show">${[['all', 'All songs'], ['imp', 'Imported'], ['dev', 'On this phone']].map(([k, t]) => `<button class="chip ${v === k ? 'on' : ''}" data-a="dsrc" data-v="${k}" aria-pressed="${v === k}">${v === k ? mi('check') : ''}${t}</button>`).join('')}<button class="chip" data-a="drescan">${mi('history')}${devScan ? 'Scanning...' : 'Rescan'}</button>${nh ? `<button class="chip" data-a="dunhide">Show ${nh} hidden</button>` : ''}</div>`;
};
const srcOk = s => !NN || !S.src || S.src === 'all' || (S.src === 'dev' ? !!s.device : !s.device);
const match = (s, q) => (s.title + ' ' + s.artist + ' ' + s.album).toLowerCase().includes(q);
const cp = () => pls.find(x => x.id === sub);
const shuffle = a => { a = [...a]; for (let i = a.length; i > 1; i--) { const j = Math.floor(Math.random() * i);[a[i - 1], a[j]] = [a[j], a[i - 1]]; } return a; };

/* ---------- Rendering ---------- */
const row = id => {
  const s = byId(id);
  return `<div class="row ${cur && cur.id === id ? 'now' : ''}${s.device ? ' dev' : ''}" data-a="play" data-id="${id}"><img src="${cover(s)}" alt="" loading="lazy"><div class="rm"><b>${esc(s.title)}</b><span>${s.device ? '<small class="ph" title="On this phone">phone</small>' : ''}${esc(s.artist)}${s.album && s.album !== 'Unknown Album' ? ' &middot; ' + esc(s.album) : ''}</span></div><em class="dur">${s.dur ? fmt(s.dur) : ''}</em><button class="ib hrt ${s.fav ? 'on' : ''}" data-a="fav" aria-label="${s.fav ? 'Remove from favorites' : 'Add to favorites'}">${ic('heart', !!s.fav)}</button><button class="ib" data-a="dots" aria-label="More">${ic('dots')}</button></div>`;
};
const list = (ids, empty) => { lastList = ids; return ids.length ? `<div class="lst">${ids.map(row).join('')}</div>` : `<p class="empty">${empty || ''}</p>`; };
const card = (n, sb, img, key) => `<div class="card" data-a="opg" data-k="${esc(key)}"><img src="${img}" alt="" loading="lazy"><b>${esc(n)}</b><span>${sb}</span></div>`;
const groupMap = k => {
  const m = {};
  songs.forEach(s => (k === 'albums' ? [s.album] : s.artist.split(/\s*[;\/]\s*/)).forEach(n => (m[n] ??= []).push(s.id)));
  return m;
};
function groups(k) {
  const m = groupMap(k);
  if (sub && m[sub]) { const ids = m[sub]; return `<div class="dhead"><button class="ib" data-a="back" aria-label="Back">${mi('keyboard_arrow_down')}</button></div><div class="phead"><img src="${cover(byId(ids[0]))}" alt=""><div><small>${k === 'albums' ? 'Album' : 'Artist'}</small><h2>${esc(sub)}</h2><span>${nS(ids.length)}</span><div class="acts"><button class="btn pri" data-a="playall">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="shufall">${mi('shuffle')}Shuffle</button></div></div></div>` + list(ids); }
  sub = null;
  const e = Object.entries(m);
  return e.length ? `<div class="grid">${e.map(([n, ids]) => card(n, nS(ids.length), cover(byId(ids[0])), n)).join('')}</div>` : `<p class="empty">Upload songs to see ${k}.</p>`;
}
const pcover = p => cover(byId(p.songs.find(byId)));
function pHTML() {
  const p = cp();
  if (p) {
    const ids = p.songs.filter(byId);
    return `<div class="dhead"><button class="ib" data-a="back" aria-label="Back">${mi('keyboard_arrow_down')}</button></div><div class="phead"><img src="${pcover(p)}" alt=""><div><small>Playlist</small><h2>${esc(p.name)}</h2><span>${nS(ids.length)}</span><div class="acts"><button class="btn pri" data-a="pplay">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="pshuf">${mi('shuffle')}Shuffle</button><button class="btn tonal" data-a="padd">${mi('add')}Add songs</button><button class="btn text" data-a="pren">Rename</button><button class="btn text" data-a="pdel">Delete</button></div></div></div>` + list(ids, 'This playlist is empty. Use Add songs.');
  }
  sub = null;
  return `<div class="grid"><div class="card new" data-a="pnew"><div class="plus">${mi('add')}</div><b>New playlist</b><span>&nbsp;</span></div>${pls.map(p => card(p.name, nS(p.songs.filter(byId).length), pcover(p), p.id)).join('')}</div>`;
}
const qList = () => queue.length ? queue.map((id, i) => {
  const s = byId(id);
  return `<div class="row ${i === qi ? 'now' : ''}" data-a="qplay" data-i="${i}" data-id="${id}"><img src="${cover(s)}" alt=""><div class="rm"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div><button class="ib sm" data-a="qup" aria-label="Move up"><span class="rot180">${mi('keyboard_arrow_down')}</span></button><button class="ib sm" data-a="qdn" aria-label="Move down">${mi('keyboard_arrow_down')}</button><button class="ib sm" data-a="qrm" aria-label="Remove">${mi('add')}</button></div>`;
}).join('') : '<p class="empty">The queue is empty. Search above to add songs.</p>';
const qHTML = () => `<div class="qwrap"><label class="sbar in"><span class="sic">${mi('search')}</span><input class="qs" type="search" placeholder="Add songs to the queue"></label><div class="chips"><button class="chip" data-a="qshuf">${mi('shuffle')}Shuffle</button><button class="chip" data-a="qsave">${mi('playlist_play')}Save as playlist</button><button class="chip" data-a="qclr">Clear</button></div><div class="qres lst"></div><div class="qlist lst">${qList()}</div></div>`;
const addRows = (p, q) => songs.filter(s => match(s, q)).map(s => `<div class="row" data-id="${s.id}"><img src="${cover(s)}" alt=""><div class="rm"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div><button class="btn sm tonal" data-a="ptog">${p.songs.includes(s.id) ? 'Added' : 'Add'}</button></div>`).join('');

const sorters = { added: (a, b) => b.added - a.added, title: (a, b) => a.title.localeCompare(b.title), artist: (a, b) => a.artist.localeCompare(b.artist), album: (a, b) => a.album.localeCompare(b.album) };
const sortSel = () => `<select data-s="sort" aria-label="Sort">${[['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['plays', 'Most played']].map(([v, t]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const libBar = n => `${devTools()}<div class="lbar"><button class="btn pri" data-a="playall">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="shufall">${mi('shuffle')}Shuffle</button></div><div class="lmeta"><span>${n} song${n === 1 ? '' : 's'}</span>${sortSel()}</div>`;
/* "Recently played" carousel: hero item first, then smaller ones (multi-browse) */
const recent = () => {
  const ids = hist.filter(byId).slice(0, 12);
  if (ids.length < 2) return '';
  return `<section class="rsec"><h2 class="st">Recently played</h2><div class="cs">${ids.map((id, i) => { const s = byId(id); return `<div class="cs-item ${i === 0 ? 'hero' : ''}" data-a="rplay" data-id="${id}"><img src="${cover(s)}" alt="" loading="lazy"><div class="cs-t"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div></div>`; }).join('')}</div></section>`;
};
const TITLES = { library: 'Library', favorites: 'Favorites', albums: 'Albums', artists: 'Artists', queue: 'Queue', playlists: 'Playlists', history: 'History' };
function render() {
  const navV = view === 'artists' || view === 'history' ? 'library' : view;
  document.querySelectorAll('#nav button').forEach(b => { const on = b.dataset.v === navV; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  document.body.dataset.view = view;
  $('.sbar').style.display = view === 'library' ? '' : 'none';
  if (NN && devPerm === '') devPerm = NN.musicPermission();
  const q = $('#search').value.toLowerCase();
  const y = $('#view').scrollTop;
  let h;
  if (view === 'library') { const ids = songs.filter(s => match(s, q) && okSong(s)).sort(sorters[S.sort] || sorters.added).map(s => s.id); h = (q ? '' : `<div class="chips"><button class="chip" data-a="nav" data-v="artists">${mi('artist')}Artists</button><button class="chip" data-a="nav" data-v="history">${mi('history')}History</button></div>`) + devBanner() + (q || sub ? '' : recent()) + `<h2 class="st">Songs</h2>` + libBar(ids.length) + list(ids, devScan && !songs.length ? 'Looking for music on your phone...' : 'No songs yet. Tap Upload to add some, or drop audio files here.'); }
  else if (view === 'favorites') { const ids = songs.filter(s => s.fav).map(s => s.id); h = (ids.length ? `<div class="lbar"><button class="btn pri" data-a="playall">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="shufall">${mi('shuffle')}Shuffle</button></div>` : '') + list(ids, 'No favorites yet. Tap the heart on a song.'); }
  else if (view === 'history') h = (hist.length ? `<div class="chips"><button class="chip" data-a="hclr">Clear history</button></div>` : '') + list(hist.filter(byId), 'Nothing played yet.');
  else if (view === 'queue') h = qHTML();
  else if (view === 'playlists') h = pHTML();
  else h = groups(view);
  const backLib = !sub && (view === 'artists' || view === 'history') ? `<div class="dhead"><button class="ib" data-a="nav" data-v="library" aria-label="Back to Library">${mi('keyboard_arrow_down')}</button></div>` : '';
  $('#view').innerHTML = backLib + (sub ? '' : `<h1 class="pt">${TITLES[view] || view}</h1>`) + h;
  $('#view').scrollTop = y;
}
function refreshQ() {
  document.querySelectorAll('.qlist').forEach(e => e.innerHTML = qList());
  save('queue', queue); save('qi', qi);
}

/* ---------- Playback ---------- */
function initAudio() {
  if (ctx) return;
  ctx = new AudioContext();
  const src = ctx.createMediaElementSource(au);
  const f = (t, fr, q) => { const n = ctx.createBiquadFilter(); n.type = t; n.frequency.value = fr; if (q) n.Q.value = q; return n; };
  /* 5-band equalizer + bass boost; every player element goes through G[el] -> EQ */
  F.bands = EQF.map((fr, i) => f(i === 0 ? 'lowshelf' : i === EQF.length - 1 ? 'highshelf' : 'peaking', fr, 1.1));
  F.boost = f('lowshelf', 90);
  F.in = ctx.createGain();
  F.bands.reduce((a, n) => a.connect(n), F.in).connect(F.boost).connect(ctx.destination);
  G.main = ctx.createGain(); src.connect(G.main).connect(F.in);
  applyEQ(); applySink();
}
const EQF = [60, 230, 910, 3600, 14000];
const G = {};
const eqGains = () => Array.isArray(S.eq) && S.eq.length === 5 ? S.eq : [S.bass || 0, Math.round((S.bass || 0) / 2 + (S.mid || 0) / 2), S.mid || 0, Math.round((S.mid || 0) / 2 + (S.treb || 0) / 2), S.treb || 0];
const applyEQ = () => { if (!ctx) return; eqGains().forEach((g, i) => F.bands[i].gain.value = g); F.boost.gain.value = S.bboost ? 6 : 0; };
async function applySink() {
  try { if (S.sink) { const t = ctx && ctx.setSinkId ? ctx : au; await t.setSinkId(S.sink); } } catch (e) { }
  outLabel();
}
async function outLabel() {
  let n = 'System default';
  try {
    const d = (await navigator.mediaDevices.enumerateDevices()).filter(x => x.kind === 'audiooutput');
    const x = d.find(x => x.deviceId === S.sink) || d.find(x => x.deviceId === 'default') || d[0];
    if (x && x.label) n = x.label;
  } catch (e) { }
  document.querySelectorAll('.out').forEach(e => e.textContent = S.showOut ? 'Playing on: ' + n : '');
}
function start() { initAudio(); ctx.resume(); au.play().catch(() => { }); }
let back = [], fwd = [], nav = '', navAt = 0;

function load(i, play = true) {
  const s = byId(queue[i]);
  if (!s) return;
  if (cur && cur.id !== s.id) {          // remember where we came from
    if (nav === 'back') fwd.push(cur.id);
    else { back.push(cur.id); if (back.length > 200) back.shift(); if (nav !== 'fwd') fwd.length = 0; }
  }
  qi = i; cur = s;
  const old = url;
  url = s.blob ? URL.createObjectURL(s.blob) : (s.src || '');
  au.src = url;
  if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);     // revoke AFTER the new source is attached
  if (play) { hist = [s.id, ...hist.filter(x => x !== s.id)].slice(0, 100); save('hist', hist); start(); }
  ui();
}
const playList = (ids, id) => { if (!ids.length) return; queue = [...ids]; load(Math.max(0, queue.indexOf(id))); };

/* nearest queue position of a song (handles duplicates) */
const idxOf = id => {
  let b = -1;
  queue.forEach((x, i) => { if (x === id && (b < 0 || Math.abs(i - qi) < Math.abs(b - qi))) b = i; });
  return b;
};
/* pop a history stack until we find a song that's still in the queue */
const goTo = (stack, mode) => {
  while (stack.length) {
    const id = stack.pop(), j = idxOf(id);
    if (j >= 0 && byId(id) && (!cur || id !== cur.id)) {
      nav = mode;
      try { load(j); } finally { nav = ''; }
      return true;
    }
  }
  return false;
};
const gate = () => { const t = Date.now(); if (t - navAt < 250) return false; navAt = t; return true; };

/* shuffle that avoids recently played songs */
const pickShuffle = () => {
  const recent = new Set(back.slice(-Math.max(1, Math.floor(queue.length / 2))));
  const all = queue.map((_, i) => i).filter(i => i !== qi);
  const fresh = all.filter(i => !recent.has(queue[i]));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(Math.random() * pool.length)];
};

const next = () => {
  if (!queue.length || !gate()) return;
  if (goTo(fwd, 'fwd')) return;                       // came back with Previous? go forward again
  load(S.shuf && queue.length > 1 ? pickShuffle() : (qi + 1) % queue.length);
};
const prev = () => {
  if (!queue.length) return;
  if (au.currentTime > 3) { au.currentTime = 0; return; }   // restart first, like Spotify
  if (!gate()) return;
  if (goTo(back, 'back')) return;                     // the song you actually played before
  if (!S.shuf) load((qi - 1 + queue.length) % queue.length);
  else au.currentTime = 0;
};
function removeQ(i) {
  if (i < 0) return;
  queue.splice(i, 1);
  if (i < qi) qi--;
  else if (i === qi) {
    if (!queue.length) { qi = -1; cur = null; au.pause(); au.removeAttribute('src'); ui(); return; }
    return load(Math.min(qi, queue.length - 1), !au.paused);
  }
  refreshQ();
}
function moveQ(i, j) {
  if (j < 0 || j >= queue.length) return;
  [queue[i], queue[j]] = [queue[j], queue[i]];
  if (qi === i) qi = j; else if (qi === j) qi = i;
  refreshQ();
}
function ui() {
  const s = cur;
  $('#mT').textContent = s ? s.title : 'Nothing playing';
  $('#mA').textContent = s ? s.artist : '';
  $('#mArt').src = $('#bArt').src = cover(s);
  $('#bT').textContent = s ? s.title : '';
  $('#bA').textContent = s ? s.artist : '';
  $('#bAl').textContent = s ? s.album : '';
  $('#lt').textContent = s ? (s.lyrics || 'No lyrics were found in this file\'s metadata.') : '';
  $('#bH').classList.toggle('on', !!s && !!s.fav);
  $('#bH').innerHTML = ic('heart', !!s && !!s.fav);
  $('.bbg').style.backgroundImage = `url("${cover(s)}")`;
  applyColor();
  document.title = s ? s.title + ' - nortest' : 'nortest';
  pi(); media(); refreshQ();
  if (view !== 'queue') render();
  else document.querySelectorAll('#view .row.now').forEach(r => r.classList.toggle('now', !!s && r.dataset.id === s.id));
}
function pi() {
  const p = au.paused;
  ['#mpl', '#bpl'].forEach(i => $(i).innerHTML = ic(p ? 'play' : 'pause'));
  $('#big').classList.toggle('paused', p);
  $('#mini').classList.toggle('paused', p);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'paused' : 'playing';
}
function media() {
  if (!('mediaSession' in navigator) || !cur) return;
  const base = new URL('icons/', location.href).href;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: cur.title, artist: cur.artist, album: cur.album,
    artwork: cur.cover
      ? [{ src: cover(cur), sizes: '512x512', type: cur.cover.type || 'image/jpeg' }]
      : [{ src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }]
  });
}
/* lock screen / headphones / car controls (iOS shows prev+next instead of the 10s seek buttons when both are set) */
const posState = () => {
  try { if ('mediaSession' in navigator && au.duration && isFinite(au.duration)) navigator.mediaSession.setPositionState({ duration: au.duration, position: Math.min(au.currentTime, au.duration), playbackRate: au.playbackRate || 1 }); } catch (e) { }
};
const seekBy = d => { au.currentTime = Math.max(0, Math.min(au.duration || 0, au.currentTime + d)); posState(); };
if ('mediaSession' in navigator) {
  [['play', start], ['pause', () => au.pause()], ['nexttrack', next], ['previoustrack', prev],
  ['seekbackward', d => seekBy(-((d && d.seekOffset) || 10))], ['seekforward', d => seekBy((d && d.seekOffset) || 10)],
  ['seekto', d => { if (d.fastSeek && 'fastSeek' in au) au.fastSeek(d.seekTime); else au.currentTime = d.seekTime; posState(); }],
  ['stop', () => { au.pause(); au.currentTime = 0; posState(); }]
  ].forEach(([a, f]) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { } });
  ['seeked', 'ratechange', 'loadedmetadata', 'play', 'pause'].forEach(ev => au.addEventListener(ev, posState));
}
au.onplay = au.onpause = pi;
au.onended = () => {
  if (S.rep === 2) { au.currentTime = 0; start(); }
  else if (S.rep === 0 && !S.shuf && qi === queue.length - 1) pi();
  else next();
};
au.ontimeupdate = au.onloadedmetadata = () => {
  const pc = au.duration ? au.currentTime / au.duration * 100 : 0;
  $('#seek').value = pc; $('.sk').style.setProperty('--p', pc + '%'); $('#mProg i').style.width = pc + '%';
  $('#cur').textContent = fmt(au.currentTime);
  $('#dur').textContent = fmt(au.duration);
  posState();
};
$('#seek').oninput = e => { $('.sk').style.setProperty('--p', e.target.value + '%'); if (au.duration) au.currentTime = e.target.value / 100 * au.duration; };
$('#seek').addEventListener('wheel', e => { e.preventDefault(); au.currentTime += e.deltaY < 0 ? 5 : -5; }, { passive: false });

/* ---------- Upload and metadata ---------- */
const tags = f => new Promise(r => window.jsmediatags ? jsmediatags.read(f, { onSuccess: x => r(x.tags), onError: () => r({}) }) : r({}));
const addFiles = async fs => {
  for (const f of fs) {
    const dur = await new Promise(r => { const a = new Audio(URL.createObjectURL(f)); a.onloadedmetadata = () => { r(a.duration); URL.revokeObjectURL(a.src); }; a.onerror = () => { r(0); URL.revokeObjectURL(a.src); }; });
    const t = await tags(f), l = t.lyrics;
    const c = t.picture ? new Blob([new Uint8Array(t.picture.data)], { type: t.picture.format }) : null;
    const s = {
      id: crypto.randomUUID(), title: t.title || f.name.replace(/\.[^.]+$/, ''), artist: t.artist || 'Unknown Artist',
      album: t.album || 'Unknown Album', lyrics: typeof l === 'string' ? l : (l && l.lyrics) || '',
      cover: c, blob: f, fav: false, added: Date.now(), dur
    };
    songs.push(s); await put('songs', s);
    render();
  }
};
$('#file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };

/* ---------- Modal and menu ---------- */
function nS(n) { return n + (n === 1 ? ' song' : ' songs'); }
const mod = h => { $('#mb').innerHTML = h; $('#mod').classList.remove('hid'); };
const closeMod = () => $('#mod').classList.add('hid');
/* ---------- Settings page (Material 3: grouped list items, switches, segmented buttons) ---------- */
const sw = (k, on) => `<label class="swt"><input type="checkbox" data-s="${k}" ${on ? 'checked' : ''}><i></i></label>`;
const seg = (id, val, opts) => `<div class="seg" role="group" data-seg="${id}">${opts.map(([v, t]) => `<button data-a="segset" data-k="${id}" data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${String(val) === String(v) ? mi('check') : ''}${t}</button>`).join('')}</div>`;
const slider = (k, l, min, max, st, unit) => `<div class="li col"><div class="lt"><b>${l}</b><span data-out="${k}">${unit(S[k])}</span></div><input type="range" data-s="${k}" min="${min}" max="${max}" step="${st}" value="${S[k]}"></div>`;
const UNITS = { bass: v => (v > 0 ? '+' : '') + v + ' dB', mid: v => (v > 0 ? '+' : '') + v + ' dB', treb: v => (v > 0 ? '+' : '') + v + ' dB', vol: v => Math.round(v * 100) + '%', speed: v => (+v).toFixed(2).replace(/0$/, '') + 'x' };
async function settings() {
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); } catch (e) { }
  const p = $('#setp'), wasOpen = !p.classList.contains('hid'), y = wasOpen ? p.scrollTop : 0;
  const ver = NN && NN.appVersion ? (() => { try { return NN.appVersion(); } catch (e) { return ''; } })() : '';
  const rs = window.tabRemote ? tabRemote.state() : 'off';
  const hidden = NN ? dev.filter(x => x.hidden) : [];
  p.innerHTML = `<header class="sh"><button class="ib" data-a="setx" aria-label="Back"><span class="rot90">${mi('keyboard_arrow_down')}</span></button><h1>Settings</h1></header>
<div class="sbody">
<section class="sg"><h2>Look</h2><div class="card-list">
  <div class="li col"><div class="lt"><b>Theme</b></div>${seg('theme', S.theme || 'system', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['amoled', 'Black']])}</div>
  <div class="li"><div class="lt"><b>Dynamic color</b><span>Colors come from the cover of the song that's playing</span></div>${sw('dyn', S.dyn !== false)}</div>
  <div class="li col"><div class="lt"><b>${S.dyn !== false ? 'Fallback color' : 'App color'}</b><span>${S.dyn !== false ? 'For songs without a cover' : 'The palette is built from this'}</span></div><div class="sws">${['#1ed760', '#4f7cff', '#b06cff', '#ff5d8f', '#ff8a3d', '#18b7c9'].map(c => `<button class="swc ${S.accent.toLowerCase() === c ? 'on' : ''}" data-a="swatch" data-c="${c}" style="background:${c}" aria-label="Color ${c}">${S.accent.toLowerCase() === c ? mi('check') : ''}</button>`).join('')}<input type="color" data-s="accent" value="${S.accent}" aria-label="Custom color"></div></div>
  <div class="li col"><div class="lt"><b>Player background</b></div>${seg('npbg', S.npbg || 'art', [['art', 'Blurred art'], ['tonal', 'Tonal'], ['solid', 'Solid']])}</div>
  <div class="li col"><div class="lt"><b>Grid columns</b><span>Albums, artists, playlists</span></div>${seg('cols', S.cols === 3 ? 3 : 2, [[2, '2'], [3, '3']])}</div>
  <div class="li col"><div class="lt"><b>Text size</b><span data-out="ts">${Math.round((S.ts || 1) * 100)}%</span></div><input type="range" data-n="ts" min="0.85" max="1.3" step="0.05" value="${S.ts || 1}"></div>
  ${typeof glassRow === 'function' ? glassRow() : ''}
  <div class="li"><div class="lt"><b>Reduce motion</b><span>No bounces, waves or spinning</span></div>${sw('rmotion', !!S.rmotion)}</div>
  ${typeof extraSettings === 'function' ? extraSettings() : ''}
  <div class="li"><div class="lt"><b>Mini player</b><span>Show the bar above the tabs</span></div>${sw('showMini', !S.hideMini)}</div>
  <div class="li"><div class="lt"><b>Reset look</b><span>Theme, colors and background back to default</span></div><button class="btn text" data-a="bgreset">Reset</button></div>
</div></section>
<section class="sg"><h2>Playback</h2><div class="card-list">
  <div class="li col"><div class="lt"><b>Crossfade</b><span data-out="xf">${NUM.xf(+S.xf || 0)}</span></div><input type="range" data-n="xf" min="0" max="12" step="1" value="${+S.xf || 0}"></div>
  ${slider('vol', 'Volume', 0, 1, 0.01, UNITS.vol)}
  <div class="li col"><div class="lt"><b>Speed</b></div>${seg('speed', S.speed, [[0.5, '0.5x'], [0.75, '0.75'], [1, '1x'], [1.25, '1.25'], [1.5, '1.5'], [2, '2x']])}</div>
  <div class="li col"><div class="lt"><b>Sleep timer</b><span>${sleepMin === 'end' ? 'Pauses when this song ends' : sleepMin ? 'Pauses ' + sleepMin + ' min after you set it' : 'Off'}</span></div>${seg('sleep', sleepMin, [[0, 'Off'], [15, '15'], [30, '30'], [45, '45'], [60, '60'], ['end', 'End']])}</div>
  <div class="li col"><div class="lt"><b>Tapping a song</b></div>${seg('tap', S.tap || 'now', [['now', 'Play now'], ['next', 'Play next'], ['queue', 'Add to queue']])}</div>
  <div class="li"><div class="lt"><b>Resume where you left off</b><span>Same song and spot when you open the app</span></div>${sw('resume', S.resume !== false)}</div>
  <div class="li"><div class="lt"><b>Swipe the cover</b><span>Left for next, right for previous</span></div>${sw('swipe', S.swipe !== false)}</div>
  ${wakeOK ? `<div class="li"><div class="lt"><b>Keep screen on</b><span>While music is playing</span></div>${sw('awake', !!S.awake)}</div>` : ''}
  <div class="li"><div class="lt"><b>Full screen</b><span>Hide the phone's status bar</span></div><button class="btn tonal" data-a="fs">Toggle</button></div>
  <div class="li col"><div class="lt"><b>Output device</b></div><select data-s="sink"><option value="">System default</option>${devs.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === S.sink ? 'selected' : ''}>${esc(d.label || 'Output ' + (i + 1))}</option>`).join('')}</select></div>
  <div class="li"><div class="lt"><b>Show where audio is playing</b><span>Under the song in the player</span></div>${sw('showOut', S.showOut)}</div>
</div></section>
<section class="sg"><h2>Equalizer</h2><div class="card-list">
  <div class="li col"><div class="lt"><b>Preset</b><span>${eqPreset() === 'custom' ? 'Custom' : ''}</span></div><div class="chips wrap">${[['flat', 'Flat'], ['bass', 'Bass boost'], ['vocal', 'Vocal'], ['treble', 'Treble'], ['rock', 'Rock'], ['pop', 'Pop']].map(([k, t]) => `<button class="chip ${eqPreset() === k ? 'on' : ''}" data-a="eqp" data-v="${k}">${eqPreset() === k ? mi('check') : ''}${t}</button>`).join('')}</div></div>
  <div class="li col"><div class="eqb">${eqGains().map((g, i) => `<label><span data-eqo="${i}">${(g > 0 ? '+' : '') + g} dB</span><input type="range" data-eq="${i}" min="-12" max="12" step="1" value="${g}" aria-label="${EQF[i]} Hz"><small>${EQF[i] >= 1000 ? EQF[i] / 1000 + 'k' : EQF[i]}</small></label>`).join('')}</div></div>
  <div class="li"><div class="lt"><b>Extra bass</b><span>+6 dB below 90 Hz</span></div>${sw('bboost', !!S.bboost)}</div>
  <div class="li"><div class="lt"><b>Reset equalizer</b></div><button class="btn text" data-a="eqreset">Reset</button></div>
</div></section>
<section class="sg"><h2>Library</h2><div class="card-list">
  <div class="li col"><div class="lt"><b>Sort songs by</b></div>${seg('sort', S.sort || 'added', [['added', 'Added'], ['title', 'Title'], ['artist', 'Artist'], ['plays', 'Plays']])}</div>
  ${NN ? `<div class="li"><div class="lt"><b>Music on this phone</b><span>${devPerm === 'granted' ? nS(dev.length) + ' found' : devPerm === 'blocked' ? 'Access is off' : 'Not allowed yet'}</span></div>${devPerm === 'granted' ? `<button class="btn tonal" data-a="drescan">${devScan ? 'Scanning...' : 'Rescan'}</button>` : `<button class="btn tonal" data-a="${devPerm === 'blocked' ? 'dset' : 'dallow'}">${devPerm === 'blocked' ? 'Open settings' : 'Allow'}</button>`}</div>
  <div class="li"><div class="lt"><b>Show phone songs</b><span>In the library, albums and artists lists</span></div>${sw('showPhone', !S.noPhone)}</div>
  <div class="li col"><div class="lt"><b>Hidden songs</b><span>${hidden.length ? hidden.length + ' hidden from your library' : 'None hidden'}</span></div>${hidden.length ? `<div class="hl-list">${hidden.map(x => `<div class="row" data-id="${x.id}"><img src="${cover(x)}" alt=""><div class="rm"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span></div><button class="btn sm tonal" data-a="dunhide1">Unhide</button></div>`).join('')}</div><button class="btn text" data-a="dunhide">Unhide all</button>` : ''}</div>` : ''}
  <div class="li col"><div class="lt"><b>Hide short clips</b><span data-out="minLen">${NUM.minLen(+S.minLen || 0)}</span></div><input type="range" data-n="minLen" min="0" max="120" step="5" value="${+S.minLen || 0}"></div>
  <div class="li"><div class="lt"><b>Songs in your library</b><span>${own().length} imported${NN ? ' + ' + songs.filter(x => x.device).length + ' on this phone' : ''}, ${pls.length} playlists</span></div><button class="btn tonal" data-a="upload">Upload</button></div>
  <div class="li"><div class="lt"><b>Clear play history</b><span>${nS(hist.length)} in History</span></div><button class="btn text" data-a="hclr2">Clear</button></div>
  <div class="li"><div class="lt"><b>Rebuild library</b><span>Reload everything from storage${NN ? ' and rescan the phone' : ''}</span></div><button class="btn text" data-a="rebuild">Rebuild</button></div>
</div></section>
<section class="sg"><h2>Stats</h2><div class="card-list">${(() => { const st = stats(); return `
  <div class="li"><div class="lt"><b>${st.total} songs &middot; ${hm(st.sec)} listened</b><span>Listening time counts from version 1.4</span></div><button class="btn text" data-a="clrstats">Reset</button></div>
  <div class="li col"><div class="lt"><b>Top songs</b></div>${st.top.length ? `<ol class="top5">${st.top.map(([x, n]) => `<li><span>${esc(x.title)}</span><em>${n} ${n === 1 ? 'play' : 'plays'}</em></li>`).join('')}</ol>` : '<span class="mut">Play some songs first</span>'}</div>
  <div class="li col"><div class="lt"><b>Top artists</b></div>${st.topA.length ? `<ol class="top5">${st.topA.map(([a, n]) => `<li><span>${esc(a)}</span><em>${n} ${n === 1 ? 'play' : 'plays'}</em></li>`).join('')}</ol>` : '<span class="mut">Play some songs first</span>'}</div>`; })()}
</div></section>
<section class="sg"><h2>Backup &amp; restore</h2><div class="card-list"><div class="bk-slot"></div>
  <div class="li"><div class="lt"><b>Back up or restore</b><span>One .zip with your songs, playlists, favorites and settings</span></div><button class="btn tonal" data-a="backup">Open</button></div>
</div></section>
<section class="sg"><h2>Remote control</h2><div class="card-list">
  <div class="li"><div class="lt"><b>Tab remote</b><span>Status: <b class="rs rs-${rs}">${rs}</b>${window.tabRemote && tabRemote.last() ? ' &middot; last command ' + new Date(tabRemote.last()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</span></div><button class="btn tonal" data-a="rreconnect">Reconnect</button></div>
  <div class="li"><div class="lt"><b>Send what's playing</b><span>Lets Tab see the current song</span></div><button class="btn text" data-a="rstatus">Send</button></div>
</div></section>
<section class="sg"><h2>Data</h2><div class="card-list">
  <div class="li"><div class="lt"><b>Storage used</b><span class="stor">Checking...</span></div></div>
  <div class="li"><div class="lt"><b>Export settings</b><span>Save your settings as a file</span></div><button class="btn text" data-a="sexport">Export</button></div>
  <div class="li"><div class="lt"><b>Import settings</b><span>From a nortest settings file</span></div><button class="btn text" data-a="simport">Import</button></div>
  <div class="li"><div class="lt"><b>Reset settings</b><span>Songs, playlists and favorites stay</span></div><button class="btn text danger" data-a="sreset">Reset</button></div>
</div></section>
<section class="sg"><h2>About</h2><div class="card-list">
  <div class="li"><div class="lt"><b>nortest${ver ? ' ' + esc(ver) : ''}</b><span>${NN ? 'Android app' : 'Website'}</span></div>${NN && NN.checkForUpdates ? '<button class="btn tonal" data-a="chkupd">Check for updates</button>' : ''}</div>
  <div class="li col keys-li"><div class="lt"><b>Keyboard shortcuts</b></div><div class="keys"><b>Space</b><span>Play / pause</span><b>Left / Right</b><span>Back / forward 10s</span><b>N / P</b><span>Next / previous</span><b>S / R</b><span>Shuffle / repeat</span><b>L</b><span>Lyrics</span><b>F</b><span>Favorite</span><b>M</b><span>Mute</span><b>Esc</b><span>Close panels</span></div></div>
</div></section>
</div>`;
  p.classList.remove('hid');
  p.querySelectorAll('input[type=range]').forEach(rangeFill);
  p.scrollTop = y;
  if (typeof bgVis === 'function') bgVis();
  if (!wasOpen) document.body.classList.add('set-open');
  if (window.onSettingsRendered) window.onSettingsRendered(p);
  try { navigator.storage.estimate().then(e => { const el = p.querySelector('.stor'); if (el) el.textContent = (e.usage / 1048576).toFixed(1) + ' MB' + (e.quota ? ' of ' + Math.round(e.quota / 1073741824) + ' GB available' : ''); }); } catch (e) { const el = p.querySelector('.stor'); if (el) el.textContent = 'Unknown'; }
}
const rangeFill = r => { const mn = +r.min || 0, mx = +r.max || 100; r.style.setProperty('--p', ((r.value - mn) / (mx - mn) * 100) + '%'); };
document.addEventListener('input', e => { if (e.target.type === 'range' && e.target.closest('#setp')) rangeFill(e.target); });
/* the Upload FAB shrinks to an icon while you scroll down */
(() => { let last = 0; $('#view').addEventListener('scroll', e => { const y = e.target.scrollTop; $('.fab').classList.toggle('small', y > 40 && y >= last - 2); last = y; }, { passive: true }); })();
const closeSettings = () => { $('#setp').classList.add('hid'); document.body.classList.remove('set-open'); };
/* dynamic color from the current cover (or the accent color) */
const applyColor = () => M3.apply(cur ? cover(cur) : '', { theme: S.theme || 'system', dynamic: S.dyn !== false, accent: S.accent });
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyColor);
function applyUI() {
  au.volume = S.vol; au.defaultPlaybackRate = au.playbackRate = S.speed; applyEQ();
  applyColor();
  $('#vol').value = S.vol; $('#vol').style.setProperty('--p', S.vol * 100 + '%'); modes();
  $('#mini').classList.toggle('hid', S.hideMini);
  document.body.classList.toggle('nomini', S.hideMini);
}
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.s) {
    const k = t.dataset.s;
    if (k === 'showMini') S.hideMini = !t.checked;
    else if (k === 'showPhone') { S.noPhone = !t.checked; render(); }
    else S[k] = t.type === 'checkbox' ? t.checked : ['bass', 'mid', 'treb', 'vol', 'speed', 'blur'].includes(k) ? +t.value : t.value;
    save('S', S); applyUI();
    const o = document.querySelector(`[data-out="${k}"]`); if (o && UNITS[k]) o.textContent = UNITS[k](S[k]);
    if (k === 'dyn') settings();
    if (k === 'bboost') applyEQ();
    if (k === 'sink') applySink(); else if (k === 'showOut') outLabel(); else if (k === 'sort' || k === 'src') render();
  } else if (t.id === 'sleep') {
    clearTimeout(sleepT); sleepMin = +t.value;
    if (sleepMin) sleepT = setTimeout(() => au.pause(), sleepMin * 60000);
  } else if (t.id === 'search') render();
  else if (t.id === 'ms') $('#mres').innerHTML = addRows(cp(), t.value.toLowerCase());
  else if (t.classList.contains('qs')) {
    const q = t.value.toLowerCase().trim();
    t.closest('.qwrap').querySelector('.qres').innerHTML = q ? songs.filter(s => match(s, q)).slice(0, 20).map(s => `<div class="row" data-id="${s.id}"><img src="${cover(s)}" alt=""><div class="rm"><div><b>${esc(s.title)}</b></div><span>${esc(s.artist)}</span></div><button class="btn sm" data-a="qnext">Play next</button><button class="btn sm" data-a="qadd">Add</button></div>`).join('') : '';
  }
});

/* ---------- Actions ---------- */
document.addEventListener('click', e => {
  if (e.target.id === 'mod') closeMod();
  const b = e.target.closest('[data-a]');
  if (!b || b.dataset.a !== 'dots') $('#menu').classList.add('hid');
  if (b) A[b.dataset.a]?.(b, b.closest('[data-id]')?.dataset.id, e);
});
Object.assign(A, {
  nav: b => { view = b.dataset.v; sub = null; $('#search').value = ''; render(); $('#view').scrollTop = 0; },
  back: () => { sub = null; render(); $('#view').scrollTop = 0; },
  opg: b => { sub = b.dataset.k; render(); $('#view').scrollTop = 0; },
  rplay: (b, id) => playList(hist.filter(byId), id),
  dsrc: b => { S.src = b.dataset.v; save('S', S); render(); },
  upload: () => $('#file').click(),
  fs: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  settings: () => settings(),
  setx: () => closeSettings(),
  mx: closeMod,
  eqreset: () => { S.bass = S.mid = S.treb = 0; save('S', S); applyEQ(); settings(); },
  play: (b, id) => { queue = [...lastList]; load(queue.indexOf(id)); },
  toggle: () => { if (cur) au.paused ? start() : au.pause(); },
  next, prev,
  b10: () => au.currentTime -= 10, f10: () => au.currentTime += 10,
  open: () => $('#big').classList.add('show'),
  close: () => { $('#big').classList.remove('show', 'lyr'); $('#qp').classList.remove('open'); },
  side: () => $('#big').classList.toggle('side'),
  lyr: () => { $('#big').classList.remove('side'); $('#big').classList.add('lyr'); },
  lyrx: () => $('#big').classList.remove('lyr'),
  qp: () => { $('#qp').innerHTML = `<div class="bar"><h3 style="flex:1">Queue</h3><button class="btn" data-a="qpx">Close</button></div>` + qHTML(); $('#qp').classList.add('open'); },
  qpx: () => $('#qp').classList.remove('open'),
  fav: async (b, id) => {
    const s = id ? byId(id) : cur;
    if (!s) return;
    s.fav = !s.fav; await put('songs', s);
    if (cur && cur.id === s.id) ui(); else render();
  },
  dots: (b, id) => {
    const s = byId(id), r = b.getBoundingClientRect(), m = $('#menu');
    const it = [['Play next', 'qnext'], ['Add to queue', 'qadd'],
    ...(queue.includes(id) ? [['Remove from queue', 'qrmid']] : []),
    [s.fav ? 'Remove from favorites' : 'Add to favorites', 'fav'], ['Edit details', 'edit'], ['Add to playlist', 'topl'],
    ...(view === 'playlists' && sub ? [['Remove from this playlist', 'prm']] : []), s.device ? ['Hide from library', 'dhide'] : ['Delete song', 'sdel']];
    const MI = { qnext: 'play_next', qadd: 'queue_music', qrmid: 'playlist_remove', fav: 'favorite', edit: 'edit', topl: 'playlist_add', prm: 'playlist_remove', dhide: 'eye_off', sdel: 'trash' };
    m.innerHTML = `<div class="mh"><img src="${cover(s)}" alt=""><div><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div></div>` + it.map(([t, a]) => `<button data-a="${a}" data-id="${id}" class="mx-${a}">${mi(MI[a] || 'add', a === 'fav' && s.fav)}<span>${t}</span></button>`).join('');
    m.classList.remove('hid');
    m.style.top = Math.max(8, Math.min(r.bottom, innerHeight - m.offsetHeight - 8)) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  },
  qadd: (b, id) => { queue.push(id); qi < 0 ? load(0, false) : refreshQ(); },
  qnext: (b, id) => { queue.splice(qi + 1, 0, id); qi < 0 ? load(0, false) : refreshQ(); },
  qrmid: (b, id) => removeQ(queue.indexOf(id)),
  qplay: b => load(+b.dataset.i),
  qrm: b => removeQ(+b.closest('[data-i]').dataset.i),
  qup: b => { const i = +b.closest('[data-i]').dataset.i; moveQ(i, i - 1); },
  qdn: b => { const i = +b.closest('[data-i]').dataset.i; moveQ(i, i + 1); },
  qclr: () => { queue = []; qi = -1; cur = null; au.pause(); au.removeAttribute('src'); ui(); },
  topl: (b, id) => mod(`<h3>Add to playlist</h3><div class="mlist">${pls.map(p => `<button class="btn wide" data-a="pin" data-p="${p.id}" data-id="${id}">${esc(p.name)}</button>`).join('')}<button class="btn wide pri" data-a="pnew" data-id="${id}">New playlist</button></div>`),
  pin: async b => {
    const p = pls.find(x => x.id === b.dataset.p);
    if (!p.songs.includes(b.dataset.id)) p.songs.push(b.dataset.id);
    await put('playlists', p); closeMod(); render();
  },
  pnew: (b, id) => mod(`<h3>New playlist</h3><input id="pn" placeholder="Playlist name"><div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn pri" data-a="pmake" ${id ? `data-id="${id}"` : ''}>Create</button></div>`),
  pmake: async (b, id) => {
    const p = { id: crypto.randomUUID(), name: $('#pn').value.trim() || 'Untitled playlist', songs: id ? [id] : [] };
    pls.push(p); await put('playlists', p); closeMod(); render();
  },
  prm: async (b, id) => { const p = cp(); p.songs = p.songs.filter(x => x !== id); await put('playlists', p); render(); },
  pplay: () => playList(cp().songs.filter(byId)),
  pshuf: () => playList(shuffle(cp().songs.filter(byId))),
  pdel: async () => { await del('playlists', sub); pls = pls.filter(p => p.id !== sub); sub = null; render(); },
  padd: () => mod(`<h3>Add songs</h3><input id="ms" placeholder="Search songs"><div id="mres" class="mlist">${addRows(cp(), '')}</div><div class="mrow"><button class="btn pri" data-a="mx">Done</button></div>`),
  ptog: async (b, id) => {
    const p = cp(), i = p.songs.indexOf(id);
    i < 0 ? p.songs.push(id) : p.songs.splice(i, 1);
    await put('playlists', p); b.textContent = i < 0 ? 'Added' : 'Add'; render();
  },
  sdel: async (b, id) => {
    if (!confirm('Delete this song from your library?')) return;
    songs = songs.filter(s => s.id !== id); await del('songs', id); dropCover(id);
    for (const p of pls) if (p.songs.includes(id)) { p.songs = p.songs.filter(x => x !== id); await put('playlists', p); }
    hist = hist.filter(x => x !== id); save('hist', hist);
    for (let i = queue.length; i--;) if (queue[i] === id) removeQ(i);
    render();
  }
});

/* ---------- Extras ---------- */
function modes() {
  $('#bShuf').classList.toggle('on', !!S.shuf);
  $('#bShuf').setAttribute('aria-pressed', !!S.shuf);
  $('#bRep').classList.toggle('on', S.rep > 0);
}
$('#vol').oninput = e => { S.vol = +e.target.value; au.volume = S.vol; e.target.style.setProperty('--p', S.vol * 100 + '%'); save('S', S); };
Object.assign(A, {
  playall: () => playList(lastList),
  shufall: () => playList(shuffle(lastList)),
  shuf: () => { S.shuf = !S.shuf; save('S', S); modes(); },
  rep: () => { S.rep = (S.rep + 1) % 3; save('S', S); modes(); },
  hclr: () => { hist = []; save('hist', hist); render(); },
  qshuf: () => {
    const c = queue[qi];
    queue = shuffle(queue.filter((_, i) => i !== qi));
    if (c) { queue.unshift(c); qi = 0; }
    refreshQ();
  },
  qsave: async () => {
    if (!queue.length) return;
    const p = { id: crypto.randomUUID(), name: 'Queue ' + new Date().toLocaleDateString(), songs: [...queue] };
    pls.push(p); await put('playlists', p);
    A.qpx(); view = 'playlists'; sub = null; render();
  },
  edit: (b, id) => {
    const s = byId(id);
    mod(`<h3>Edit details</h3><label>Title<input id="e_t" value="${esc(s.title)}"></label><label>Artist (separate several with ;)<input id="e_a" value="${esc(s.artist)}"></label><label>Album<input id="e_al" value="${esc(s.album)}"></label><label>Lyrics<textarea id="e_l">${esc(s.lyrics)}</textarea></label><div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn pri" data-a="esave" data-id="${id}">Save</button></div>`);
  },
  esave: async (b, id) => {
    const s = byId(id);
    s.title = $('#e_t').value.trim() || s.title;
    s.artist = $('#e_a').value.trim() || 'Unknown Artist';
    s.album = $('#e_al').value.trim() || 'Unknown Album';
    s.lyrics = $('#e_l').value;
    await put('songs', s); closeMod();
    cur && cur.id === id ? ui() : render();
  },
  pren: () => mod(`<h3>Rename playlist</h3><input id="pn" value="${esc(cp().name)}"><div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn pri" data-a="prsave">Save</button></div>`),
  prsave: async () => { const p = cp(); p.name = $('#pn').value.trim() || p.name; await put('playlists', p); closeMod(); render(); }
});
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('audio/'))); });
/* Back (Android back gesture via the app shell, or Esc): close the top-most open layer; false = nothing was open */
window.__nortestBack = () => {
  const open = s => { const e = $(s); return e && !e.classList.contains('hid'); };
  if (open('#menu')) { $('#menu').classList.add('hid'); const sc = $('#scrim'); if (sc) sc.classList.add('hid'); return true; }
  if (open('#mod')) { closeMod(); return true; }
  if ($('#qp').classList.contains('open')) { A.qpx(); return true; }
  if ($('#big').classList.contains('show')) {
    if ($('#big').classList.contains('lyr')) A.lyrx(); else A.close();
    return true;
  }
  if (open('#setp')) { closeSettings(); return true; }
  if (sub) { sub = null; render(); return true; }
  if (view === 'artists' || view === 'history') { view = 'library'; render(); return true; }
  return false;
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { window.__nortestBack(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
  const k = { ' ': A.toggle, ArrowRight: A.f10, ArrowLeft: A.b10, n: next, p: prev, s: A.shuf, r: A.rep, l: A.lyr, f: () => A.fav({}), m: () => { au.muted = !au.muted; } }[e.key];
  if (k) { e.preventDefault(); k(); }
});


/* ---------- Settings + M3 helpers ---------- */
Object.assign(A, {
  segset: b => {
    const k = b.dataset.k, v = b.dataset.v;
    if (k === 'theme') { S.theme = v; save('S', S); applyColor(); }
    else if (k === 'speed') { S.speed = +v; save('S', S); applyUI(); }
    else if (k === 'sleep') {
      clearTimeout(sleepT); sleepEnd = v === 'end'; sleepMin = sleepEnd ? 'end' : +v;
      if (+v) sleepT = setTimeout(() => { au.pause(); sleepMin = 0; }, +v * 60000);
    }
    else if (['tap', 'artShape', 'npbg', 'sort'].includes(k)) { S[k] = v; save('S', S); applyUI(); render(); }
    else if (k === 'cols') { S.cols = +v; save('S', S); applyUI(); }
    settings();
  },
  dunhide1: async (b, id) => {
    const d = dev.find(x => x.id === id); if (!d) return;
    d.hidden = false; await devPut(d);
    songs = mergeDev(songs); render(); settings();
  },
  rreconnect: () => { if (window.tabRemote) tabRemote.connect(); setTimeout(settings, 1500); settings(); },
  rstatus: () => { if (window.tabRemote) { tabRemote.status(); try { NN && NN.toast('Sent'); } catch (e) { } } },
  chkupd: () => { try { NN.checkForUpdates(); } catch (e) { } }
});
/* icons written into the page markup */
const hydrate = (root = document) => root.querySelectorAll('[data-i]').forEach(e => { if (!e.firstChild) e.innerHTML = mi(e.dataset.i); });
hydrate();
/* bottom-sheet menu gets a scrim; tapping it just closes the menu */
new MutationObserver(() => $('#scrim').classList.toggle('hid', $('#menu').classList.contains('hid'))).observe($('#menu'), { attributes: true, attributeFilter: ['class'] });
$('#scrim').addEventListener('click', e => { e.stopPropagation(); $('#menu').classList.add('hid'); });
/* a cover that fails to load (e.g. a phone song without art) shows the initials square */
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG' || t.dataset.ph) return;
  t.dataset.ph = '1';
  const id = t.closest('[data-id]')?.dataset.id, s = id ? byId(id) : (t.id === 'mArt' || t.id === 'bArt') ? cur : null;
  t.src = s ? phFor(s) : PH;
  if (s && s.device && s.art && !s.cover) s.art = '';   /* remember: no art for this one */
}, true);
document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.dataset.ph && !e.target.src.startsWith('data:')) delete e.target.dataset.ph; }, true);
/* a song that can't be played (file deleted or unreadable): say so and move on instead of getting stuck */
let badAt = 0, badRun = 0;
au.addEventListener('error', () => {
  const s = cur;
  if (!s || !au.getAttribute('src')) return;
  if (s.device && !s._retry && au.src.startsWith(DEVB)) return;          /* the phone-song fallback below tries first */
  try { NN ? NN.toast('Can\'t play ' + s.title) : console.warn('Cannot play', s.title); } catch (e) { }
  badRun = Date.now() - badAt < 4000 ? badRun + 1 : 1; badAt = Date.now();
  if (queue.length > 1 && badRun < Math.min(queue.length, 5)) setTimeout(() => { if (cur === s) next(); }, 600);
});
/* ---------- Music on the phone: actions + style ---------- */
Object.assign(A, {
  dallow: () => NN && NN.requestMusicAccess(),
  dset: () => NN && NN.openMusicSettings(),
  drescan: () => { if (!NN) return; devScan = true; render(); NN.rescanDeviceMusic(); },
  dhide: async (b, id) => {
    const s = byId(id); if (!s || !s.device) return;
    s.hidden = true; await devPut(s);
    const d = dev.find(x => x.id === id); if (d) d.hidden = true;
    songs = mergeDev(songs);
    for (let i = queue.length; i--;) if (queue[i] === id && i !== qi) { queue.splice(i, 1); if (i < qi) qi--; }
    refreshQ(); render();
  },
  dunhide: async () => {
    dev.forEach(s => { if (s.hidden) { s.hidden = false; devPut(s); } });
    songs = mergeDev(songs); render();
    if (!$('#setp').classList.contains('hid')) settings();
  }
});
if (NN) {
  /* a phone song that won't stream (very old WebView): load it into memory instead */
  au.addEventListener('error', () => {
    const s = cur;
    if (!s || !s.device || s._retry || !au.src.startsWith(DEVB)) return;
    s._retry = true;
    fetch(s.src).then(r => r.ok ? r.blob() : Promise.reject(r.status)).then(b => {
      if (cur !== s) return;
      const t = au.currentTime;
      url = URL.createObjectURL(b); au.src = url; au.currentTime = t; start();
    }).catch(() => { try { NN.toast('Could not play ' + s.title); } catch (e) { } if (cur === s && queue.length > 1) next(); });
  });
}


/* ---------- Playback extras: crossfade, tap action, resume, end-of-song sleep, listening time ---------- */
/* Crossfade: near the end of a song a second (hidden) player keeps the old song's tail and fades it out,
   while the main player (the one Media Session, the remote and the queue follow) starts the next song and fades in. */
const xf = { el: null, busy: false, url: '' };
const xfGhost = () => {
  if (xf.el) return xf.el;
  const g = new Audio(); g.preload = 'auto'; g.crossOrigin = au.crossOrigin; xf.el = g;
  if (ctx) { const s2 = ctx.createMediaElementSource(g); G.ghost = ctx.createGain(); s2.connect(G.ghost).connect(F.in); }
  return g;
};
const ramp = (gain, from, to, sec) => { if (!gain || !ctx) return; const t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(from, t); gain.gain.linearRampToValueAtTime(to, t + sec); };
const nextIsSame = () => S.rep === 2 || (S.rep === 3 && !repOnceUsed);
const atQueueEnd = () => (S.rep === 0 || S.rep === 3) && !S.shuf && qi === queue.length - 1;
function crossfade() {
  const sec = +S.xf || 0, d = au.duration;
  if (!sec || xf.busy || au.paused || !ctx || !isFinite(d) || d < sec * 2 + 4 || queue.length < 2 || nextIsSame() || atQueueEnd()) return;
  xf.busy = true;
  const g = xfGhost(), oldUrl = url, t = au.currentTime;
  g.src = au.currentSrc || au.src; g.volume = au.volume; g.playbackRate = au.playbackRate;
  const go = () => {
    g.currentTime = t; g.play().catch(() => { });
    ramp(G.ghost, 1, 0, sec); ramp(G.main, 0, 1, sec);
    url = '';                       /* the ghost owns the old blob URL now; load() must not revoke it */
    next();
    clearTimeout(xf.tm);
    xf.tm = setTimeout(() => { g.pause(); g.removeAttribute('src'); g.load(); if (oldUrl && oldUrl.startsWith('blob:') && oldUrl !== url) URL.revokeObjectURL(oldUrl); xf.busy = false; }, sec * 1000 + 300);
  };
  if (g.readyState >= 1) go(); else { g.addEventListener('loadedmetadata', go, { once: true }); setTimeout(() => { if (!g.currentTime && xf.busy && g.paused) { xf.busy = false; } }, 3000); }
}
au.addEventListener('timeupdate', () => {
  const sec = +S.xf || 0;
  if (sec && !xf.busy && au.duration && au.duration - au.currentTime <= sec && au.duration - au.currentTime > 0.5) crossfade();
});
/* a manual skip during a fade: drop the ghost right away */
['seeking'].forEach(ev => au.addEventListener(ev, () => { if (xf.busy && xf.el && au.currentTime > 2) { xf.el.pause(); ramp(G.main, 1, 1, 0.01); } }));
au.addEventListener('pause', () => { if (xf.busy && xf.el) xf.el.pause(); });

/* what a tap on a song does */
const _playTap = A.play;
A.play = (b, id) => {
  const m = S.tap || 'now';
  if (m === 'next' && cur) { A.qnext(b, id); try { NN && NN.toast('Playing next'); } catch (e) { } }
  else if (m === 'queue' && cur) { A.qadd(b, id); try { NN && NN.toast('Added to queue'); } catch (e) { } }
  else _playTap(b, id);
};

/* resume where you left off (song + position), kept in localStorage */
const POSK = 'nortest_pos';
let posT = 0;
au.addEventListener('timeupdate', () => {
  if (S.resume === false || !cur || Date.now() - posT < 3000) return;
  posT = Date.now();
  try { localStorage.setItem(POSK, JSON.stringify({ id: cur.id, t: Math.floor(au.currentTime) })); } catch (e) { }
});
const resumePos = () => {
  if (S.resume === false || !cur) return;
  try {
    const p = JSON.parse(localStorage.getItem(POSK) || 'null');
    if (p && p.id === cur.id && p.t > 3) { const set = () => { if (au.duration && p.t < au.duration - 3) au.currentTime = p.t; }; au.readyState >= 1 ? set() : au.addEventListener('loadedmetadata', set, { once: true }); }
  } catch (e) { }
};

/* sleep timer "end of song": pause when the current song finishes */
let sleepEnd = false;
au.addEventListener('ended', () => { if (sleepEnd) { sleepEnd = false; sleepMin = 0; setTimeout(() => au.pause(), 0); } }, true);
au.addEventListener('timeupdate', () => { if (sleepEnd && au.duration && au.duration - au.currentTime < 0.6) { sleepEnd = false; sleepMin = 0; au.pause(); } });

/* listening time for Stats */
const LTK = 'nortest_listen_s';
let ltLast = 0;
au.addEventListener('timeupdate', () => {
  const n = Date.now();
  if (!au.paused && ltLast && n - ltLast < 2000) { try { localStorage.setItem(LTK, String((+localStorage.getItem(LTK) || 0) + (n - ltLast) / 1000)); } catch (e) { } }
  ltLast = n;
});

/* keep the screen on while music plays (Screen Wake Lock) */
let wl = null;
const wakeOK = 'wakeLock' in navigator;
const wake = async () => {
  try {
    if (S.awake && !au.paused && !document.hidden) { if (!wl) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); } }
    else if (wl) { await wl.release(); wl = null; }
  } catch (e) { wl = null; }
};
['play', 'pause', 'ended'].forEach(ev => au.addEventListener(ev, wake));
document.addEventListener('visibilitychange', wake);

/* swipe the big cover left / right for next / previous */
(() => {
  let x0 = 0, y0 = 0, t0 = 0;
  const art = $('.artw');
  art.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); }, { passive: true });
  art.addEventListener('touchend', e => {
    if (S.swipe === false) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Date.now() - t0 < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const side = $('#big').classList.contains('side') && innerHeight > innerWidth;   /* rotated player: axes swap */
      (side ? dy : dx) < 0 ? next() : prev();
      $('#bArt').animate([{ transform: `translateX(${dx < 0 ? -40 : 40}px)`, opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,0,0,1)' });
    }
  }, { passive: true });
})();

/* ---------- Look extras: art shape, grid columns, player background, text size, reduce motion ---------- */
function applyLook() {
  const h = document.documentElement, b = document.body;
  h.dataset.art = S.artShape || 'cookie';
  h.dataset.npbg = S.npbg || 'art';
  h.classList.toggle('rm-motion', !!S.rmotion);
  h.style.setProperty('--cols', S.cols === 3 ? 3 : 2);
  h.style.setProperty('--ts', S.ts || 1);
  b.classList.toggle('cols3', S.cols === 3);
  wake();
}
const _applyUILook = applyUI;
applyUI = function () { _applyUILook(); applyLook(); };

/* library filters: hide phone songs, hide short clips */
const _srcOk = srcOk;
const okSong = s => _srcOk(s) && !(S.noPhone && s.device) && !(S.minLen && s.dur && s.dur < S.minLen);

/* ---------- Stats + data ---------- */
const stats = () => {
  const plays = (window.nortestPlays && nortestPlays()) || {};
  const top = Object.entries(plays).filter(([id]) => byId(id)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => [byId(id), n]);
  const ar = {};
  Object.entries(plays).forEach(([id, n]) => { const s = byId(id); if (s) s.artist.split(/\s*[;\/]\s*/).forEach(a => ar[a] = (ar[a] || 0) + n); });
  const topA = Object.entries(ar).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const sec = +localStorage.getItem(LTK) || 0;
  return { top, topA, sec, total: songs.length };
};
const hm = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
const setImport = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json', hidden: true });
document.body.appendChild(setImport);
setImport.onchange = async () => {
  const f = setImport.files[0]; setImport.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), v = j && j.nortestSettings;
    if (!v || typeof v !== 'object') throw new Error('not a nortest settings file');
    S = { ...S, ...v }; save('S', S); applyUI(); render(); settings();
    try { NN && NN.toast('Settings imported'); } catch (e) { }
  } catch (e) { alert('That file is not a nortest settings file.'); }
};
const EQP = { flat: [0, 0, 0, 0, 0], bass: [6, 4, 0, 0, 1], vocal: [-2, 0, 3, 4, 1], treble: [0, 0, 0, 3, 6], rock: [4, 2, -1, 3, 4], pop: [-1, 2, 4, 2, -1] };
const eqPreset = () => { const g = eqGains().join(','); return Object.keys(EQP).find(k => EQP[k].join(',') === g) || 'custom'; };
Object.assign(A, {
  eqp: b => { S.eq = [...EQP[b.dataset.v]]; save('S', S); applyEQ(); settings(); },
  eqreset: () => { S.eq = [0, 0, 0, 0, 0]; S.bass = S.mid = S.treb = 0; S.bboost = false; save('S', S); applyEQ(); settings(); },
  swatch: b => { S.accent = b.dataset.c; save('S', S); applyUI(); settings(); },
  clrstats: () => { if (!confirm('Reset your listening time?')) return; localStorage.removeItem(LTK); settings(); },
  rebuild: async () => {
    songs = mergeDev(await all('songs')); pls = await all('playlists');
    if (NN) { try { NN.rescanDeviceMusic(); } catch (e) { } }
    queue = queue.filter(byId); if (qi >= queue.length) qi = queue.length - 1;
    refreshQ(); render(); settings();
    try { NN && NN.toast('Library rebuilt'); } catch (e) { }
  },
  sexport: () => download('nortest-settings.json', JSON.stringify({ nortestSettings: S, exported: new Date().toISOString() }, null, 2)),
  simport: () => setImport.click(),
  sreset: async () => {
    if (!confirm('Reset all settings to default? Your songs, playlists and favorites stay.')) return;
    const keep = { sort: S.sort, src: S.src, shuf: S.shuf, rep: S.rep };
    S = { bass: 0, mid: 0, treb: 0, vol: 1, speed: 1, blur: 24, accent: '#1ed760', sort: 'added', shuf: false, rep: 0, showOut: true, hideMini: false, sink: '', ...keep };
    save('S', S); applyUI(); render(); settings();
  },
  hclr2: () => { if (!confirm('Clear your play history?')) return; hist = []; save('hist', hist); render(); settings(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.eq != null) {
    const g = eqGains().slice(); g[+t.dataset.eq] = +t.value; S.eq = g; save('S', S); applyEQ();
    const o = document.querySelector(`[data-eqo="${t.dataset.eq}"]`); if (o) o.textContent = (t.value > 0 ? '+' : '') + t.value + ' dB';
  } else if (t.dataset.n) {
    const k = t.dataset.n; S[k] = +t.value; save('S', S); applyUI();
    if (k === 'minLen') render();
    const o = document.querySelector(`[data-out="${k}"]`); if (o) o.textContent = NUM[k](S[k]);
  }
});
const NUM = { xf: v => v ? v + ' s' : 'Off', minLen: v => v ? 'Under ' + v + ' s hidden' : 'Off', ts: v => Math.round(v * 100) + '%' };

/* ---------- Init ---------- */
(async () => {
  const NAVI = {"library": "library_music", "favorites": "favorite", "albums": "album", "playlists": "playlist_play", "queue": "queue_music"};
  $('#nav').innerHTML = Object.keys(NAVI).map(v => `<button data-a="nav" data-v="${v}"><span class="ind">${mi(NAVI[v])}${mi(NAVI[v], 1)}</span><span class="lb">${TITLES[v]}</span></button>`).join('');
  $('#mp').innerHTML = $('#bp').innerHTML = ic('prev');
  $('#mn').innerHTML = $('#bn').innerHTML = ic('next');
  $('#bH').innerHTML = ic('heart');
  if (NN) { devOv = (await meta('devov')) || {}; devPerm = NN.musicPermission(); devRead(); }
  songs = mergeDev(await all('songs')); pls = await all('playlists');
  S = { ...S, ...(await meta('S')) };
  hist = (await meta('hist')) || [];
  queue = ((await meta('queue')) || []).filter(byId);
  qi = (await meta('qi')) ?? -1;
  applyUI(); render(); outLabel();
  if (queue.length && qi >= 0 && qi < queue.length) { load(qi, false); resumePos(); } else { qi = -1; ui(); }
})();
