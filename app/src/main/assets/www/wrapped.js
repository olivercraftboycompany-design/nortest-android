/* nortest 1.8.0 - Wrapped: a listening log and your year in music (from Cadence).
   Every real listen (seconds actually heard, not the time a song sat loaded) goes into its own
   storage: IndexedDB "nortest-listens", nothing else touched. A song counts as a play once 30 s
   of it were heard. Radio is logged per station. The story lives on the Wrapped view (chip in the
   Library); pick any year on the page, and ?wrapped=preview shows a demo story for empty years.
   Stored: IndexedDB nortest-listens (store "listens"). */
(() => {
'use strict';
if (window.__wrappedLoaded) return; window.__wrappedLoaded = 1;
const DBN = 'nortest-listens', ST = 'listens', PLAY_MIN = 30;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- storage ---------- */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(ST)) r.result.createObjectStore(ST, { keyPath: 'k' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST); let out;
    const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const allRecs = () => tx('readonly', s => s.getAll()).then(a => a || []);
const putMany = recs => recs.length ? tx('readwrite', s => recs.forEach(r => s.put(r))) : Promise.resolve();

/* ---------- what is playing right now: audio element, Spotify streams, radio ---------- */
function ctx() {
  try {
    if (view === 'playlists' && sub) { const p = pls.find(x => x.id === sub); return { pl: sub, plName: p ? p.name : '' }; }
    if (view === 'favorites') return { pl: 'favorites', plName: 'Favorites' };
    if (view === 'queue') return { pl: 'queue', plName: 'Queue' };
    if (view === 'history') return { pl: 'history', plName: 'History' };
    if ((view === 'albums' || view === 'artists') && sub) return { pl: view === 'albums' ? 'al|' + sub : 'ar|' + sub, plName: sub };
  } catch (e) { }
  return { pl: '', plName: '' };
}
function nowPlaying() {
  try {
    const rn = window.nortestRadioNow ? window.nortestRadioNow() : null;
    if (rn) { const rau = document.getElementById('rau'); if (rau && !rau.paused) return { kind: 'radio', id: 'r|' + rn.id, title: rn.name, artist: rn.call || 'Radio', album: 'Radio station', dur: 0, pl: '', plName: '' }; }
  } catch (e) { }
  try {
    const sn = window.spNow ? window.spNow() : null;
    if (sn && sn.playing) { const s = window.spSong ? window.spSong(sn.id) : null; return { kind: 'song', id: sn.id, title: (s && s.title) || sn.title || 'Stream', artist: (s && s.artist) || sn.artist || '', album: (s && s.album) || '', dur: sn.dur || (s && s.dur) || 0, pl: ctx().pl, plName: ctx().plName }; }
  } catch (e) { }
  try { if (!au.paused && cur) return { kind: 'song', id: cur.id, title: cur.title, artist: cur.artist, album: cur.album || '', dur: cur.dur || 0, pl: ctx().pl, plName: ctx().plName }; } catch (e) { }
  return null;
}

/* ---------- the log: seconds actually heard ---------- */
let lastKey = '', lastPos = 0, lastWall = 0, sess = null;
const key = (m, now) => m.kind + '|' + m.id + '|' + (m.pl || '') + '|' + Math.floor(now / 36e5);
const newSess = (m, now) => ({ k: key(m, now), kind: m.kind, id: m.id, title: m.title, artist: m.artist, album: m.album, dur: m.dur, pl: m.pl, plName: m.plName, sec: 0, ts: now, end: now });
function flush() { if (sess && sess.sec >= 1) putMany([Object.assign({}, sess)]).catch(() => { }); sess = null; }
function tick(pos) {
  try {
    const m = nowPlaying(), now = Date.now();
    if (!m) { flush(); lastKey = ''; lastPos = 0; return; }
    const k = key(m, now);
    if (!sess || k !== lastKey) { flush(); lastKey = k; sess = newSess(m, now); lastPos = pos; lastWall = now; return; }
    const d = m.kind === 'radio' ? (now - lastWall) / 1000 : pos - lastPos;
    const wall = (now - lastWall) / 1000;
    lastPos = pos; lastWall = now;
    if (d > 0 && d <= wall + 1 && wall > 0 && wall < 12) sess.sec += d;
    sess.end = now;
  } catch (e) { }
}
au.addEventListener('timeupdate', () => tick(au.currentTime));
['pause', 'ended'].forEach(ev => au.addEventListener(ev, flush));
document.addEventListener('visibilitychange', flush);
setInterval(() => {
  try {
    const sn = window.spNow ? window.spNow() : null;
    if (sn && sn.playing) { tick(sn.pos); return; }
    const rn = window.nortestRadioNow ? window.nortestRadioNow() : null;
    const rau = rn && document.getElementById('rau');
    if (rn && rau && !rau.paused) { tick(rau.currentTime); return; }
    if (au.paused) tick(NaN);
  } catch (e) { }
}, 1000);

/* ---------- computing a year ---------- */
const splitArtists = a => String(a || '').split(/\s*[,;&/]\s*|\s+feat\.?\s+|\s+x\s+|\s+&\s+/i).map(s => s.trim()).filter(Boolean);
function compute(recs, year) {
  const f = new Date(year, 0, 1).getTime(), t2 = new Date(year + 1, 0, 1).getTime();
  const rs = recs.filter(r => r.ts >= f && r.ts < t2 && r.sec > 0);
  const songs = new Map(), artists = new Map(), lists = new Map(), stations = new Map(), days = new Map(), hours = new Array(24).fill(0);
  let total = 0;
  for (const r of rs) {
    total += r.sec;
    if (r.kind === 'radio') {
      const s = stations.get(r.id) || { id: r.id, name: r.title, call: r.artist, logo: r.album, sec: 0, plays: 0 };
      s.sec += r.sec; if (r.sec >= PLAY_MIN) s.plays++; stations.set(r.id, s);
    } else {
      const s = songs.get(r.id) || { id: r.id, title: r.title, artist: r.artist, album: r.album || '', dur: r.dur || 0, sec: 0, plays: 0 };
      s.sec += r.sec; if (r.sec >= PLAY_MIN) s.plays++; songs.set(r.id, s);
      for (const a of splitArtists(r.artist).slice(0, 3)) {
        const x = artists.get(a) || { name: a, sec: 0, plays: 0, best: {} };
        x.sec += r.sec; if (r.sec >= PLAY_MIN) x.plays++; x.best[r.id] = (x.best[r.id] || 0) + r.sec; artists.set(a, x);
      }
    }
    if (r.plName) { const l = lists.get(r.pl + '|' + r.plName) || { id: r.pl, name: r.plName, sec: 0, plays: 0 }; l.sec += r.sec; if (r.sec >= PLAY_MIN) l.plays++; lists.set(r.pl + '|' + r.plName, l); }
    const d = new Date(r.ts), dk = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    days.set(dk, (days.get(dk) || 0) + r.sec);
    hours[d.getHours()] += r.sec;
  }
  const bySong = [...songs.values()].filter(s => s.plays > 0 || s.sec >= 15).sort((a, b) => b.plays - a.plays || b.sec - a.sec);
  const byArtist = [...artists.values()].sort((a, b) => b.plays - a.plays || b.sec - a.sec);
  for (const a of byArtist) { const top = Object.entries(a.best).sort((x, y) => y[1] - x[1])[0]; const s = top && songs.get(top[0]); a.topSong = s ? s.title : ''; delete a.best; }
  const byList = [...lists.values()].sort((a, b) => b.sec - a.sec);
  const byStation = [...stations.values()].sort((a, b) => b.sec - a.sec);
  const bigDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0];
  const night = hours.slice(21).concat(hours.slice(0, 4)).reduce((a, b) => a + b, 0);
  const morning = hours.slice(5, 10).reduce((a, b) => a + b, 0);
  return { year, total, nSongs: bySong.length, nArtists: artists.size, songs: bySong, artists: byArtist, lists: byList, stations: byStation, bigDay, hours, night, morning };
}
function persona(s) {
  const c = [];
  if (s.total > 0) {
    const rep = s.songs[0] ? s.songs[0].sec / s.total : 0;
    const top = s.artists[0];
    if (top && top.sec / Math.max(1, s.total) > 0.25) c.push([`A ${top.name} year: nobody got more time than them`, top.sec / s.total]);
    if (rep > 0.3) c.push(['On repeat. One song carried the year', rep]);
    if (s.night / Math.max(1, s.total) > 0.4) c.push(['Night listener. The quiet hours are yours', s.night / s.total]);
    else if (s.morning / Math.max(1, s.total) > 0.3) c.push(['Morning person. Music with the sunrise', s.morning / s.total]);
    if (s.nSongs > 120) c.push(['Explorer. A lot of songs got a first listen', 0.6]);
    else if (s.nSongs > 0) c.push(['Loyal listener. You know what you like', 0.5]);
    if (s.stations.length) c.push(['Radio heart. Live radio kept you company', 0.4]);
  }
  c.sort((a, b) => b[1] - a[1]);
  return c.length ? c[0][0] : 'Your story starts with the first play';
}
const hm = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const hourName = h => { const n = (h % 12) || 12; return n + (h < 12 ? ' AM' : ' PM'); };

/* demo story for empty years (preview only, never stored) */
function demoRecs(year) {
  const out = [], from = new Date(year, 0, 1).getTime(), span = Date.now() - from;
  const pool = songs.slice(0, 40).map(s => ({ s, plName: 'Your library' }));
  if (pool.length < 8) [['Blinding Lights', 'The Weeknd'], ['HOPE', 'NF'], ['Sunflower', 'Post Malone, Swae Lee'], ['Circles', 'Post Malone'], ['Heat Waves', 'Glass Animals'], ['Believer', 'Imagine Dragons'], ['Levitating', 'Dua Lipa'], ['Stay', 'The Kid LAROI, Justin Bieber']].forEach(([title, artist], i) => pool.push({ s: { id: 'demo' + i, title, artist, album: '', dur: 200 } , plName: 'Gym Mix' }));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) { const p = pool[Math.floor(rnd() * pool.length)], s = p.s, ts = from + Math.floor(rnd() * span); out.push({ k: 'd' + i, kind: 'song', id: s.id, title: s.title, artist: s.artist, album: s.album || '', dur: s.dur || 200, pl: '', plName: p.plName, sec: 60 + rnd() * 240, ts, end: ts }); }
  return out;
}

/* ---------- the page ---------- */
let year = new Date().getFullYear(), preview = /[?&]wrapped=preview/.test(location.search);
let cache = null;
let lastSt = null;
const loadCache = () => allRecs().then(r => { cache = r; if (view === 'wrapped') render(); }).catch(() => { cache = []; });
loadCache();
const topHour = hs => hs.indexOf(Math.max(...hs));
function storyHTML(st) {
  const mins = Math.round(st.total / 60);
  const day = st.bigDay ? new Date(st.bigDay[0].split('-').map((v, i) => i === 1 ? +v : +v).reduce((d, v, i) => d, 0)) : null;
  let h = `<div class="wtph"><small>Wrapped</small><h2>${st.year}</h2><p><b>${hm(st.total)}</b> listened &middot; ${st.nSongs} song${st.nSongs === 1 ? '' : 's'} &middot; ${st.nArtists} artist${st.nArtists === 1 ? '' : 's'}</p><p class="wtp-p">${esc(persona(st))}</p></div>`;
  h += `<div class="chips">${[year, year - 1, year - 2].map(y => `<button class="chip ${y === st.year ? 'on' : ''}" data-a="wyear" data-y="${y}">${y}</button>`).join('')}</div>`;
  if (st.songs.length) {
    h += `<h2 class="st">Top songs</h2><div class="lst">` + st.songs.slice(0, 10).map((s, i) => {
      const live = byId(s.id);
      return `<div class="row" data-a="wplay" data-id="${esc(s.id)}"><em class="wtn">${i + 1}</em><img src="${cover(live)}" alt="" loading="lazy"><div class="rm"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div><em class="dur">${s.plays} play${s.plays === 1 ? '' : 's'}</em></div>`;
    }).join('') + `</div>`;
  }
  if (st.artists.length) h += `<h2 class="st">Top artists</h2><div class="lst">` + st.artists.slice(0, 5).map(a => `<div class="row"><div class="rm"><b>${esc(a.name)}</b><span>${hm(a.sec)} &middot; ${a.plays} play${a.plays === 1 ? '' : 's'}${a.topSong ? ' &middot; top song: ' + esc(a.topSong) : ''}</span></div></div>`).join('') + `</div>`;
  const facts = [];
  if (st.lists[0]) facts.push(['Most-played playlist', esc(st.lists[0].name) + ' &middot; ' + hm(st.lists[0].sec)]);
  if (st.stations[0]) facts.push(['Favorite station', esc(st.stations[0].name) + ' &middot; ' + hm(st.stations[0].sec)]);
  if (st.bigDay) { const [y, mo, d] = st.bigDay[0].split('-').map(Number); facts.push(['Biggest day', new Date(y, mo, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + ' &middot; ' + hm(st.bigDay[1])]); }
  facts.push(['Favorite listening hour', 'around ' + hourName(topHour(st.hours))]);
  h += `<h2 class="st">The rest of the year</h2><div class="card-list">` + facts.map(([t, v]) => `<div class="li"><div class="lt"><b>${t}</b><span>${v}</span></div></div>`).join('') + `</div>`;
  return h;
}
window.wrappedHTML = () => {
  if (!cache) { loadCache(); return '<p class="empty">Counting your listens...</p>'; }
  let recs = cache;
  let st = compute(recs, year);
  if (!st.total && preview) st = compute(demoRecs(year), year);
  lastSt = st;
  lastSt = st;
  if (!st.total && !preview) return `<div class="wtph"><small>Wrapped</small><h2>${year}</h2><p>Nothing logged for ${year} yet.</p><p class="wtp-p">Every song you play for 30 seconds or more counts, starting now.</p></div><div class="chips">${[year - 1, year - 2].map(y => `<button class="chip" data-a="wyear" data-y="${y}">${y}</button>`).join('')}</div>`;
  return storyHTML(st);
};
window.wrappedBanner = () => {
  try {
    const d = new Date(), mo = d.getMonth();
    const season = mo === 10 || mo === 11 || (mo === 0 && d.getDate() <= 10);
    if (!season || !cache || !cache.length) return '';
    const yr = cache.some(r => r.ts >= new Date(d.getFullYear(), 0, 1).getTime()) ? d.getFullYear() : d.getFullYear() - 1;
    if (!cache.some(r => r.ts >= new Date(yr, 0, 1).getTime() && r.ts < new Date(yr + 1, 0, 1).getTime())) return '';
    return `<div class="a2hs" data-a="wopen" role="button"><span>${mi('insights')}</span><span>Wrapped: your year in music is ready</span><b>Open</b></div>`;
  } catch (e) { return ''; }
};

Object.assign(A, {
  wyear: b => { year = +b.dataset.y || year; render(); $('#view').scrollTop = 0; },
  wopen: () => { view = 'wrapped'; sub = null; $('#search').value = ''; render(); $('#view').scrollTop = 0; },
  wplay: (b, id) => { const ids = (lastSt && lastSt.songs ? lastSt.songs : []).map(s => s.id).filter(x => byId(x)); if (ids.length) playList(ids, id); }
});
})();
