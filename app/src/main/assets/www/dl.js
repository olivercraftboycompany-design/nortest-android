/* nortest 1.8.0 - offline downloads for imported (Spotify / YouTube) songs, ported from Cadence.
   A downloaded song is saved on the phone (IndexedDB "nortest-dl") and plays with no internet.
   The audio files come from the player's own audio relay, the same one Cadence uses; songs are
   matched to videos with nortest's own Spotify service. This module writes only its own keys
   (nortest.dlq = the download queue, nortest.dl.pins = saved "wrong song" picks), so nortest's
   own localStorage, the backup and the phone-music code stay untouched. */
(() => {
'use strict';
const AUDIO_BASE = 'https://carter-player-audio.sites.tab.bot';
const YTAPI = 'https://nortest-spotify.sites.tab.bot/yt?';
const DB_NAME = 'nortest-dl', STORE = 'songs', Q_KEY = 'nortest.dlq', PIN_KEY = 'nortest.dl.pins';
const YTK = 'nortest_spotify_yt';
let db = null;
const idx = new Map();        // key -> { size, vid, title, artist, at, q }
const prog = new Map();       // key -> 0..1 while downloading (-1 = preparing)
const queue = [];             // [{ k, t }]
const active = new Map();     // key -> AbortController
const CONC = 2, failed = new Set();
let persistAsked = false, objUrl = null;

let pins = {}; try { pins = JSON.parse(localStorage.getItem(PIN_KEY)) || {}; } catch (e) { pins = {}; }
const savePins = () => { try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch (e) { } };
const ytc = () => { try { return JSON.parse(localStorage.getItem(YTK)) || {}; } catch (e) { return {}; } };
const ytcSave = o => { try { const k = Object.keys(o); if (k.length > 3000) k.slice(0, k.length - 3000).forEach(x => delete o[x]); localStorage.setItem(YTK, JSON.stringify(o)); } catch (e) { } };
const online = () => navigator.onLine !== false;
const fmtMB = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.max(0, Math.round(b / 1e6)) + ' MB';
const key = t => (typeof t === 'string' ? t : (t && t.id) || '') + '';
const has = t => idx.has(key(t));
const stateOf = id => idx.has(id) ? 'done' : prog.has(id) ? 'ing' : queue.some(q => q.k === id) ? 'wait' : 'none';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode); const st = t.objectStore(STORE); let out;
    Promise.resolve(fn(st)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function getRec(k) { if (!db) return null; return tx('readonly', st => reqP(st.get(k))); }
async function putRec(rec) { return tx('readwrite', st => { st.put(rec); }); }
async function delRec(k) { return tx('readwrite', st => { st.delete(k); }); }
async function loadIndex() {
  idx.clear();
  await tx('readonly', st => new Promise(res => {
    const c = st.openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return res(); const v = cur.value; idx.set(v.k, { size: v.size, vid: v.vid, title: v.title, artist: v.artist, at: v.at, q: v.q || '' }); cur.continue(); };
    c.onerror = () => res();
  }));
}

/* ---------- matching a song to a video (nortest's own service, saved picks first) ---------- */
async function matchIds(t) {
  const k = key(t); if (!k) return [];
  if (pins[k]) return [pins[k]];
  const c = ytc(); if (c[k] && c[k].length) return c[k];
  try {
    const r = await fetch(YTAPI + new URLSearchParams({ t: t.title || '', a: t.artist === 'Unknown Artist' ? '' : (t.artist || ''), d: String(t.dur || 0) }));
    const j = await r.json();
    const v = ((j && j.videos) || []).map(x => x.id);
    if (v.length) { c[k] = v; ytcSave(c); }
    return v;
  } catch (e) { return []; }
}

/* ---------- downloading ---------- */
async function fetchSong(vid, t, signal, onProg) {
  const q = new URLSearchParams({ v: vid, title: t.title || '', artist: t.artist || '', album: t.album || '' });
  const r = await fetch(AUDIO_BASE + '/download?' + q, { signal });
  if (!r.ok) throw new Error('server ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  let blob;
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader(); const parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total) onProg(Math.min(0.99, got / total)); }
    if (total && got < total) throw new Error('incomplete');
    blob = new Blob(parts, { type: 'audio/mp4' });
  } else blob = new Blob([await r.arrayBuffer()], { type: 'audio/mp4' });
  if (blob.size < 50000) throw new Error('too small');
  try { blob._q = r.headers.get('x-vibe-q') || ''; } catch (e) { }
  const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
  if (String.fromCharCode.apply(null, head) !== 'ftyp') throw new Error('not audio');
  return blob;
}
function saveQueue() { try { localStorage.setItem(Q_KEY, JSON.stringify(queue.map(q => q.k).concat([...active.keys()]))); } catch (e) { } }
function enqueue(t) {
  if (!t || !t.stream) return false;
  const k = key(t); if (idx.has(k) || active.has(k) || queue.some(q => q.k === k)) return false;
  queue.push({ k, t }); return true;
}
function pump() {
  while (active.size < CONC && queue.length) {
    if (!online()) { toast('Offline — downloads will continue when you\'re back online'); break; }
    run(queue.shift());
  }
  saveQueue();
}
async function run(job) {
  const { k, t } = job; const ac = new AbortController();
  active.set(k, ac); prog.set(k, -1);
  try {
    if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => { }); }
    let ids = []; try { ids = await matchIds(t); } catch (e) { ids = []; }
    if (!ids || !ids.length) throw new Error('no match');
    let blob = null, vid = null, lastErr = null;
    for (const v of ids.slice(0, 3)) {
      try { blob = await fetchSong(v, t, ac.signal, p => { prog.set(k, p); }); vid = v; break; }
      catch (e) { if (ac.signal.aborted) throw e; lastErr = e; }
    }
    if (!blob) throw lastErr || new Error('failed');
    const rec = { k, vid, blob, size: blob.size, title: t.title || '', artist: t.artist || '', album: t.album || '', art: t.art || '', at: Date.now(), q: blob._q || '' };
    await putRec(rec);
    idx.set(k, { size: rec.size, vid, title: rec.title, artist: rec.artist, at: rec.at, q: rec.q });
    if (rec.art) fetch(rec.art, { mode: 'cors' }).catch(() => { }); // the offline cache keeps the cover too
  } catch (e) {
    if (!ac.signal.aborted) {
      failed.add(k);
      if (e && e.name === 'QuotaExceededError') { toast('Your phone is out of space for downloads'); queue.length = 0; }
    }
  } finally {
    active.delete(k); prog.delete(k);
    if (!queue.length && !active.size) finishedBatch();
    pump();
  }
}
function finishedBatch() {
  if (failed.size) { toast(failed.size + (failed.size === 1 ? ' song' : ' songs') + ' couldn\'t download — try again from the song menu', 3500); failed.clear(); }
  try { localStorage.removeItem(Q_KEY); } catch (e) { }
}
async function removeKey(k) { try { await delRec(k); } catch (e) { } idx.delete(k); }

/* ---------- playing a downloaded song ---------- */
async function playLocal(t, play) {
  const k = key(t);
  let rec = null; try { rec = await getRec(k); } catch (e) { }
  if (!rec || !rec.blob) { idx.delete(k); return false; }
  // play from a copy in memory, not the stored file itself (same reason Cadence does this)
  let blob = rec.blob;
  try { const buf = await rec.blob.arrayBuffer(); if (buf && buf.byteLength === rec.blob.size) blob = new Blob([buf], { type: rec.blob.type || 'audio/mp4' }); } catch (e) { }
  if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) { } }
  objUrl = URL.createObjectURL(blob);
  au.src = objUrl;
  if (play) au.play().catch(() => { }); else au.load();
  return true;
}
function skipOffline(i, play) {
  const n = queue.length;
  for (let k = 1; k <= n; k++) {
    let p = i + k;
    if (p >= n) { if (S.rep !== 1) break; p -= n; }
    const s = byId(queue[p]);
    if (s && s.stream && has(s)) { toast('Offline — playing your downloads'); setTimeout(() => load(p, play), 50); return; }
  }
  try { au.pause(); } catch (e) { }
  try { setPlaying(false); } catch (e) { }
  toast('Offline — download songs to play them without internet');
}

/* ---------- actions and UI ---------- */
const menuItems = id => {
  const s = stateOf(id);
  if (s === 'done') return [['Remove download', 'dlrm', 'close']];
  if (s === 'ing' || s === 'wait') return [['Stop download', 'dlstop', 'close']];
  return [['Download for offline', 'dlget', 'download']];
};
Object.assign(A, {
  dlget: (b, id) => {
    $('#menu').classList.add('hid');
    const s = byId(id); if (!s || !s.stream) return;
    if (!online()) { toast('Downloads need internet'); return; }
    failed.delete(key(s));
    if (enqueue(s)) { pump(); toast('Downloading ' + s.title + '…'); }
  },
  dlrm: (b, id) => { $('#menu').classList.add('hid'); removeKey(id).then(() => toast('Download removed')); },
  dlstop: (b, id) => {
    $('#menu').classList.add('hid');
    const i = queue.findIndex(q => q.k === id); if (i >= 0) queue.splice(i, 1);
    const ac = active.get(id); if (ac) ac.abort();
    saveQueue(); toast('Download stopped');
  },
  dlall: () => {
    if (!online()) { toast('Downloads need internet'); return; }
    const p = cp(); const ids = (p && (p.songs || p.tracks)) || [];
    let n = 0;
    for (const id of ids) { const s = byId(id); if (s && s.stream && enqueue(s)) n++; }
    pump();
    if (n) toast('Downloading ' + n + (n === 1 ? ' song…' : ' songs…'));
    else if (!active.size) toast('Everything here is already downloaded');
  }
});
/* a Download all button on each playlist page, with live state */
const plStats = () => {
  const p = cp(); const ids = (p && (p.songs || p.tracks)) || [];
  let N = 0, n = 0, ing = 0, bytes = 0;
  for (const id of ids) { const s = byId(id); if (!s || !s.stream) continue; N++; const st = stateOf(id); if (st === 'done') { n++; bytes += (idx.get(id) || {}).size || 0; } else if (st === 'ing' || st === 'wait') ing++; }
  return { N, n, ing, bytes };
};
setInterval(() => {
  try {
    if (view === 'playlists' && sub) {
      const acts = document.querySelector('#view .phead .acts');
      if (acts && !acts.querySelector('#plDl')) {
        const b = document.createElement('button');
        b.className = 'btn tonal'; b.id = 'plDl'; b.setAttribute('data-a', 'dlall');
        acts.insertBefore(b, acts.firstChild);
      }
      const b = document.querySelector('#plDl');
      if (b) {
        const st = plStats();
        let txt = 'Download all';
        if (st.ing) txt = 'Downloading…';
        else if (st.N && st.n >= st.N) txt = 'Downloaded · ' + fmtMB(st.bytes);
        else if (st.n) txt = 'Download all · ' + st.n + ' of ' + st.N + ' saved';
        b.innerHTML = mi('download', 1) + txt;
      }
    } else {
      const b = document.querySelector('#plDl'); if (b) b.remove();
    }
  } catch (e) { }
}, 800);
/* a download paused by closing the app picks back up on the next start */
try {
  const saved = JSON.parse(localStorage.getItem(Q_KEY)) || [];
  localStorage.removeItem(Q_KEY);
  for (const k of saved) { const s = byId(k); if (s && s.stream) enqueue(s); }
} catch (e) { }
openDB().then(d => { db = d; return loadIndex(); }).then(() => pump()).catch(() => { });
window.DL = { has, online, stateOf, menuItems, enqueue, pump, playLocal, skipOffline, totalBytes: () => { let b = 0; for (const v of idx.values()) b += v.size || 0; return b; } };
})();
