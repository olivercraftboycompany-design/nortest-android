const $ = s => document.querySelector(s), au = $('#au'), A = {};
const IC = {
  play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  next: 'M6 18l8.5-6L6 6zM16 6h2v12h-2z', prev: 'M6 6h2v12H6zm3.5 6L18 18V6z',
  heart: 'M12 21s-8-5.4-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.6-8 11-8 11z',
  dots: 'M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24"><path d="${IC[n]}"/></svg>`;
const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4b5bff"/><stop offset="1" stop-color="#b24bff"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="18" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="4"/></svg>');
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
const put = (s, v) => tx(s, 'readwrite', o => o.put(v));
const del = (s, k) => tx(s, 'readwrite', o => o.delete(k));
const meta = async k => (await tx('meta', 'readonly', o => o.get(k)))?.v;
const save = (k, v) => put('meta', { k, v });

/* ---------- State ---------- */
let songs = [], pls = [], queue = [], qi = -1, hist = [], cur = null, url = '', ctx, F = {};
let S = { bass: 0, mid: 0, treb: 0, vol: 1, speed: 1, blur: 24, accent: '#1ed760', sort: 'added', shuf: false, rep: 0, showOut: true, hideMini: false, sink: '' };
let sleepT, sleepMin = 0;
let view = 'library', sub = null, lastList = [], covers = {};
const byId = id => songs.find(s => s.id === id);
const cover = s => s && s.cover ? (covers[s.id] ||= URL.createObjectURL(s.cover)) : PH;
const match = (s, q) => (s.title + ' ' + s.artist + ' ' + s.album).toLowerCase().includes(q);
const cp = () => pls.find(x => x.id === sub);
const shuffle = a => { a = [...a]; for (let i = a.length; i > 1; i--) { const j = Math.floor(Math.random() * i);[a[i - 1], a[j]] = [a[j], a[i - 1]]; } return a; };

/* ---------- Rendering ---------- */
const row = id => {
  const s = byId(id);
  return `<div class="row ${cur && cur.id === id ? 'now' : ''}" data-a="play" data-id="${id}"><img src="${cover(s)}" alt=""><div class="rm"><div><b>${esc(s.title)}</b><i>${esc(s.album)}</i></div><span>${esc(s.artist)}</span></div><em class="dur">${s.dur ? fmt(s.dur) : ''}</em><button class="ib hrt ${s.fav ? 'on' : ''}" data-a="fav" aria-label="Favorite">${ic('heart')}</button><button class="ib" data-a="dots" aria-label="More">${ic('dots')}</button></div>`;
};
const list = (ids, empty) => { lastList = ids; return ids.length ? ids.map(row).join('') : `<p class="empty">${empty || ''}</p>`; };
const card = (n, sb, img, key) => `<div class="card" data-a="opg" data-k="${esc(key)}"><img src="${img}" alt=""><b>${esc(n)}</b><span>${sb}</span></div>`;
const groupMap = k => {
  const m = {};
  songs.forEach(s => (k === 'albums' ? [s.album] : s.artist.split(/\s*[;\/]\s*/)).forEach(n => (m[n] ??= []).push(s.id)));
  return m;
};
function groups(k) {
  const m = groupMap(k);
  if (sub && m[sub]) return `<div class="bar"><button class="btn" data-a="back">Back</button><h2>${esc(sub)}</h2></div>` + list(m[sub]);
  sub = null;
  const e = Object.entries(m);
  return e.length ? `<div class="grid">${e.map(([n, ids]) => card(n, ids.length + ' songs', cover(byId(ids[0])), n)).join('')}</div>` : `<p class="empty">Upload songs to see ${k}.</p>`;
}
const pcover = p => cover(byId(p.songs.find(byId)));
function pHTML() {
  const p = cp();
  if (p) {
    const ids = p.songs.filter(byId);
    return `<div class="bar"><button class="btn" data-a="back">Back</button></div><div class="phead"><img src="${pcover(p)}" alt=""><div><h2>${esc(p.name)}</h2><span>${ids.length} songs</span><div class="acts"><button class="btn pri" data-a="pplay">Play</button><button class="btn" data-a="pshuf">Shuffle</button><button class="btn" data-a="padd">Add songs</button><button class="btn" data-a="pren">Rename</button><button class="btn" data-a="pdel">Delete playlist</button></div></div></div>` + list(ids, 'This playlist is empty. Use Add songs.');
  }
  sub = null;
  return `<div class="grid"><div class="card new" data-a="pnew"><div class="plus">+</div><b>New playlist</b></div>${pls.map(p => card(p.name, p.songs.filter(byId).length + ' songs', pcover(p), p.id)).join('')}</div>`;
}
const qList = () => queue.length ? queue.map((id, i) => {
  const s = byId(id);
  return `<div class="row ${i === qi ? 'now' : ''}" data-a="qplay" data-i="${i}" data-id="${id}"><img src="${cover(s)}" alt=""><div class="rm"><div><b>${esc(s.title)}</b></div><span>${esc(s.artist)}</span></div><button class="btn sm" data-a="qup">Up</button><button class="btn sm" data-a="qdn">Down</button><button class="btn sm" data-a="qrm">Remove</button></div>`;
}).join('') : '<p class="empty">The queue is empty. Search above to add songs.</p>';
const qHTML = () => `<div class="qwrap"><div class="bar"><input class="qs" placeholder="Search songs to add to the queue"><button class="btn" data-a="qshuf">Shuffle</button><button class="btn" data-a="qsave">Save as playlist</button><button class="btn" data-a="qclr">Clear</button></div><div class="qres"></div><div class="qlist">${qList()}</div></div>`;
const addRows = (p, q) => songs.filter(s => match(s, q)).map(s => `<div class="row" data-id="${s.id}"><img src="${cover(s)}" alt=""><div class="rm"><div><b>${esc(s.title)}</b></div><span>${esc(s.artist)}</span></div><button class="btn sm" data-a="ptog">${p.songs.includes(s.id) ? 'Added' : 'Add'}</button></div>`).join('');

const sorters = { added: (a, b) => b.added - a.added, title: (a, b) => a.title.localeCompare(b.title), artist: (a, b) => a.artist.localeCompare(b.artist), album: (a, b) => a.album.localeCompare(b.album) };
const libBar = n => `<div class="bar"><button class="btn pri" data-a="playall">Play all</button><button class="btn" data-a="shufall">Shuffle all</button><span style="flex:1;color:var(--mu)">${n} songs</span><select data-s="sort" style="width:auto">${[['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['plays', 'Most played']].map(([v, t]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
function render() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  $('#search').style.display = view === 'library' ? '' : 'none';
  const q = $('#search').value.toLowerCase();
  let h;
  if (view === 'library') { const ids = songs.filter(s => match(s, q)).sort(sorters[S.sort] || sorters.added).map(s => s.id); h = libBar(ids.length) + list(ids, 'No songs found. Use Upload songs or drop audio files here.'); }
  else if (view === 'favorites') h = list(songs.filter(s => s.fav).map(s => s.id), 'No favorites yet. Tap the heart on a song.');
  else if (view === 'history') h = (hist.length ? '<div class="bar"><button class="btn" data-a="hclr">Clear history</button></div>' : '') + list(hist.filter(byId), 'Nothing played yet.');
  else if (view === 'queue') h = qHTML();
  else if (view === 'playlists') h = pHTML();
  else h = groups(view);
  $('#view').innerHTML = (sub ? '' : `<h1 class="pt">${view}</h1>`) + h;
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
  const f = (t, fr) => { const n = ctx.createBiquadFilter(); n.type = t; n.frequency.value = fr; return n; };
  F.bass = f('lowshelf', 120); F.mid = f('peaking', 1000); F.treb = f('highshelf', 6000);
  src.connect(F.bass).connect(F.mid).connect(F.treb).connect(ctx.destination);
  applyEQ(); applySink();
}
const applyEQ = () => { if (ctx) ['bass', 'mid', 'treb'].forEach(k => F[k].gain.value = S[k]); };
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
  url = URL.createObjectURL(s.blob);
  au.src = url;
  if (old) URL.revokeObjectURL(old);     // revoke AFTER the new source is attached
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
  $('.bbg').style.backgroundImage = `url(${cover(s)})`;
  document.title = s ? s.title + ' - nortest' : 'nortest';
  pi(); media(); refreshQ();
  if (view !== 'queue') render();
}
function pi() {
  const p = au.paused;
  ['#mpl', '#bpl'].forEach(i => $(i).innerHTML = ic(p ? 'play' : 'pause'));
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
  $('#seek').value = pc; $('#seek').style.setProperty('--p', pc + '%'); $('#mProg i').style.width = pc + '%';
  $('#cur').textContent = fmt(au.currentTime);
  $('#dur').textContent = fmt(au.duration);
  posState();
};
$('#seek').oninput = e => { e.target.style.setProperty('--p', e.target.value + '%'); if (au.duration) au.currentTime = e.target.value / 100 * au.duration; };
$('#seek').addEventListener('wheel', e => { e.preventDefault(); au.currentTime += e.deltaY < 0 ? 5 : -5; }, { passive: false });

/* ---------- Upload and metadata ---------- */
const tags = f => new Promise(r => window.jsmediatags ? jsmediatags.read(f, { onSuccess: x => r(x.tags), onError: () => r({}) }) : r({}));
const addFiles = async fs => {
  for (const f of fs) {
    const dur = await new Promise(r => { const a = new Audio(URL.createObjectURL(f)); a.onloadedmetadata = () => { r(a.duration); URL.revokeObjectURL(a.src); }; a.onerror = () => r(0); });
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
const mod = h => { $('#mb').innerHTML = h; $('#mod').classList.remove('hid'); };
const closeMod = () => $('#mod').classList.add('hid');
async function settings() {
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput'); } catch (e) { }
  const sl = (k, l, min, max, st) => `<label>${l}<input type="range" data-s="${k}" min="${min}" max="${max}" step="${st}" value="${S[k]}"></label>`;
  mod(`<h3>Settings</h3>${sl('bass', 'Bass (dB)', -12, 12, 1)}${sl('mid', 'Mid (dB)', -12, 12, 1)}${sl('treb', 'Treble (dB)', -12, 12, 1)}${sl('vol', 'Volume', 0, 1, 0.01)}${sl('speed', 'Playback speed', 0.5, 2, 0.05)}${sl('blur', 'Glass blur (px)', 0, 50, 1)}
  <label>Accent color<input type="color" data-s="accent" value="${S.accent}"></label>
  <label>Sleep timer<select id="sleep">${[[0, 'Off'], [15, '15 minutes'], [30, '30 minutes'], [60, '60 minutes']].map(([v, t]) => `<option value="${v}" ${v === sleepMin ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
  <label>Output device<select data-s="sink"><option value="">System default</option>${devs.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === S.sink ? 'selected' : ''}>${esc(d.label || 'Output ' + (i + 1))}</option>`).join('')}</select></label>
  <label class="chk"><input type="checkbox" data-s="showOut" ${S.showOut ? 'checked' : ''}>Show where audio is playing</label>
  <label class="chk"><input type="checkbox" data-s="hideMini" ${S.hideMini ? 'checked' : ''}>Hide mini player</label>
  <div class="mrow"><button class="btn" data-a="eqreset">Reset EQ</button><button class="btn pri" data-a="mx">Done</button></div>`);
}
function applyUI() {
  au.volume = S.vol; au.defaultPlaybackRate = au.playbackRate = S.speed; applyEQ();
  const rs = document.documentElement.style;
  rs.setProperty('--acc', S.accent); rs.setProperty('--bl', `blur(${S.blur}px) saturate(160%)`);
  $('#vol').value = S.vol; $('#vol').style.setProperty('--p', S.vol * 100 + '%'); modes();
  $('#mini').classList.toggle('hid', S.hideMini);
  document.body.classList.toggle('nomini', S.hideMini);
}
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.s) {
    const k = t.dataset.s;
    S[k] = t.type === 'checkbox' ? t.checked : ['bass', 'mid', 'treb', 'vol', 'speed', 'blur'].includes(k) ? +t.value : t.value;
    save('S', S); applyUI();
    if (k === 'sink') applySink(); else if (k === 'showOut') outLabel(); else if (k === 'sort') render();
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
  nav: b => { view = b.dataset.v; sub = null; $('#search').value = ''; render(); },
  back: () => { sub = null; render(); },
  opg: b => { sub = b.dataset.k; render(); },
  upload: () => $('#file').click(),
  fs: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  settings,
  mx: closeMod,
  eqreset: () => { S.bass = S.mid = S.treb = 0; save('S', S); applyEQ(); settings(); },
  play: (b, id) => { queue = [...lastList]; load(queue.indexOf(id)); },
  toggle: () => { if (cur) au.paused ? start() : au.pause(); },
  next, prev,
  b10: () => au.currentTime -= 10, f10: () => au.currentTime += 10,
  open: () => $('#big').classList.add('show'),
  close: () => { $('#big').classList.remove('show', 'lyr'); $('#qp').classList.remove('open'); },
  side: () => $('#big').classList.toggle('side'),
  lyr: () => $('#big').classList.add('lyr'),
  lyrx: () => $('#big').classList.remove('lyr'),
  qp: () => { $('#qp').innerHTML = `<div class="bar"><h3 style="flex:1">Queue</h3><button class="btn" data-a="qpx">Close</button></div>` + qHTML(); $('#qp').classList.add('open'); },
  qpx: () => $('#qp').classList.remove('open'),
  fav: async (b, id) => {
    const s = id ? byId(id) : cur;
    if (!s) return;
    s.fav = !s.fav; await put('songs', s); render(); ui();
  },
  dots: (b, id) => {
    const s = byId(id), r = b.getBoundingClientRect(), m = $('#menu');
    const it = [['Play next', 'qnext'], ['Add to queue', 'qadd'],
    ...(queue.includes(id) ? [['Remove from queue', 'qrmid']] : []),
    [s.fav ? 'Remove from favorites' : 'Add to favorites', 'fav'], ['Edit details', 'edit'], ['Add to playlist', 'topl'],
    ...(view === 'playlists' && sub ? [['Remove from this playlist', 'prm']] : []), ['Delete song', 'sdel']];
    m.innerHTML = it.map(([t, a]) => `<button data-a="${a}" data-id="${id}">${t}</button>`).join('');
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
    songs = songs.filter(s => s.id !== id); await del('songs', id);
    for (const p of pls) if (p.songs.includes(id)) { p.songs = p.songs.filter(x => x !== id); await put('playlists', p); }
    hist = hist.filter(x => x !== id); save('hist', hist);
    for (let i = queue.length; i--;) if (queue[i] === id) removeQ(i);
    render();
  }
});

/* ---------- Extras ---------- */
function modes() {
  $('#bShuf').classList.toggle('pri', S.shuf);
  $('#bRep').classList.toggle('pri', S.rep > 0);
  $('#bRep').textContent = 'Repeat: ' + ['off', 'all', 'one'][S.rep];
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#mod').classList.contains('hid')) closeMod();
    else if ($('#qp').classList.contains('open')) A.qpx();
    else if ($('#big').classList.contains('lyr')) A.lyrx();
    else A.close();
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
  const k = { ' ': A.toggle, ArrowRight: A.f10, ArrowLeft: A.b10, n: next, p: prev, s: A.shuf, r: A.rep, l: A.lyr, f: () => A.fav({}), m: () => { au.muted = !au.muted; } }[e.key];
  if (k) { e.preventDefault(); k(); }
});

/* ---------- Init ---------- */
(async () => {
  $('#nav').innerHTML = ['library', 'favorites', 'albums', 'artists', 'queue', 'playlists', 'history'].map(v => `<button data-a="nav" data-v="${v}">${v}</button>`).join('');
  $('#mp').innerHTML = $('#bp').innerHTML = ic('prev');
  $('#mn').innerHTML = $('#bn').innerHTML = ic('next');
  $('#bH').innerHTML = ic('heart');
  songs = await all('songs'); pls = await all('playlists');
  S = { ...S, ...(await meta('S')) };
  hist = (await meta('hist')) || [];
  queue = ((await meta('queue')) || []).filter(byId);
  qi = (await meta('qi')) ?? -1;
  applyUI(); render(); outLabel();
  if (queue.length && qi >= 0 && qi < queue.length) load(qi, false); else { qi = -1; ui(); }
})();
