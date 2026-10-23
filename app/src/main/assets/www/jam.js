/* nortest 1.8.0 - Listen Together (from Cadence): play music with a friend in real time.
   Start a session from what's playing (or a playlist), share the 5-letter code, and everyone
   hears the same song at the same spot. A tiny relay (cadence-jam.sites.tab.bot) carries the
   queue and the playback state; the music itself comes from each phone's own library, matched
   by Spotify id or title + artist, so nothing here touches the audio path.
   Stored: localStorage nortest.jam.v1 (your name/emoji + the session you're in, so a relaunch
   can rejoin). */
(() => {
'use strict';
if (window.__jamLoaded) return; window.__jamLoaded = 1;
const BASE = 'https://cadence-jam.sites.tab.bot';
const KEY = 'nortest.jam.v1';
const EMOJI = ['🎧', '😎', '🔥', '🎸', '🎤', '🦊', '🐸', '👾', '🌙', '⚡'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let store = {}; try { store = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { }
const saveStore = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { } };
const J = { on: false, code: '', key: '', pid: '', host: false, sess: null, seq: 0, applied: 0, offset: 0, es: null, lastMsg: 0, localPaused: false, applyUntil: 0, lastHb: 0, lastSent: '', back: null, corrAt: 0, invite: null, live: false };
window.__jam = J;
const now = () => Date.now() + J.offset;
const canControl = () => J.host || !!(J.sess && J.sess.control);
const applying = () => performance.now() < J.applyUntil;
const hold = ms => { J.applyUntil = Math.max(J.applyUntil, performance.now() + (ms || 1500)); };
const toast = m => { try { if (window.NortestNative && NortestNative.toast) return NortestNative.toast(m); } catch (e) { } let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); } t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
const hostName = () => (J.sess && J.sess.host && J.sess.host.name) || 'The host';
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* ---- talking to the relay (same protocol as Cadence) ---- */
async function req(path, body, ms = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body), signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
    const j = await r.json().catch(() => ({})); j.status = r.status; return j;
  } finally { clearTimeout(t); }
}
async function syncClock() {
  let best = null;
  for (let i = 0; i < 4; i++) { const t0 = Date.now(); try { const j = await req('/time', null, 4000); const t1 = Date.now(); if (j && j.now && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, off: j.now - (t0 + t1) / 2 }; } catch (e) { } }
  if (best) J.offset = best.off; return best;
}
function connect() {
  disconnect(); if (!J.on) return;
  try {
    const es = new EventSource(`${BASE}/jam/${J.code}/events?k=${encodeURIComponent(J.key)}`); J.es = es;
    const on = ev => es.addEventListener(ev, e => { J.lastMsg = Date.now(); if (ev === 'ping') return; try { got(JSON.parse(e.data), ev); } catch (e2) { } });
    ['state', 'members', 'end', 'ping'].forEach(on);
    es.onerror = () => { J.lastMsg = Math.min(J.lastMsg, Date.now() - 20000); };
  } catch (e) { }
}
function disconnect() { if (J.es) { try { J.es.close(); } catch (e) { } J.es = null; } }
async function poll() {
  if (!J.on) return;
  try { const j = await req(`/jam/${J.code}?k=${encodeURIComponent(J.key)}`, null, 6000); if (j.status === 404 || (j.session && j.session.ended)) return ended(true); if (j.session) { J.lastPoll = Date.now(); got(j.session, 'poll'); } } catch (e) { }
}
function watchdog() {
  if (!J.on) return;
  const stale = Date.now() - J.lastMsg > 25000;
  if (stale && (!J.lastPoll || Date.now() - J.lastPoll > 3000)) { poll(); if (!J.es || J.es.readyState === 2 || Date.now() - J.lastMsg > 60000) connect(); }
  if (!J.host && Date.now() - (J.lastPing || 0) > 30000) { J.lastPing = Date.now(); req(`/jam/${J.code}/ping`, { key: J.key }).catch(() => { }); }
}
setInterval(watchdog, 3000);

/* ---- playback surfaces: audio element for your own files, Spotify streams through the embed ---- */
const isAudio = () => { try { return !(cur && cur.stream) && !(window.nortestRadioNow && window.nortestRadioNow()); } catch (e) { return true; } };
const playTime = () => { try { const sn = window.spNow && window.spNow(); if (sn) return sn.pos; return au.currentTime; } catch (e) { return 0; } };
const playingNow = () => { try { const sn = window.spNow && window.spNow(); if (sn) return !!sn.playing; if (window.nortestRadioNow && window.nortestRadioNow()) { const rau = document.getElementById('rau'); return !!(rau && !rau.paused); } return !au.paused; } catch (e) { return false; } };
function seekQuiet(s) {
  hold();
  try {
    if (cur && cur.stream) { if (window.spCtl) window.spCtl.seek(Math.max(0, s)); return; }
    const set = () => { try { if (isFinite(au.duration)) au.currentTime = Math.max(0, Math.min(au.duration - 0.5, s)); } catch (e) { } };
    au.readyState >= 1 ? set() : au.addEventListener('loadedmetadata', set, { once: true });
  } catch (e) { }
}
function setRate(r) { try { if (isAudio() && Math.abs((au.playbackRate || 1) - r) > 0.001) { au.preservesPitch = true; au.playbackRate = r; } } catch (e) { } }

/* ---- what a friend needs to play the same audio: title, artist, length, plus YouTube ids for Spotify tracks ---- */
function shareable(s) {
  if (!s) return null;
  const o = { id: s.id, title: s.title || '', artist: s.artist || '', dur: s.dur || 0, album: s.album || '' };
  if (typeof s.art === 'string' && /^https:/.test(s.art)) o.art = s.art;
  try { if (String(s.id).startsWith('sp:')) { const ytc = JSON.parse(localStorage.getItem('nortest_spotify_yt') || '{}'); if (ytc[s.id] && ytc[s.id].length) o.yt = ytc[s.id].slice(0, 3); } } catch (e) { }
  return o;
}
const rmap = new Map();  // descriptor id -> local song id (per installed queue)
function resolve(t) {
  if (!t) return null;
  try { const s = byId(t.id); if (s) return s.id; } catch (e) { }
  try {
    const kk = norm(t.title + '|' + t.artist);
    const hit = songs.find(s => norm(s.title + '|' + s.artist) === kk);
    if (hit) return hit.id;
  } catch (e) { }
  return null;
}
function install(q, idx) {
  rmap.clear();
  const ids = [], pos = {};
  for (const t of q) {
    if (t.yt && t.yt.length) { try { const ytc = JSON.parse(localStorage.getItem('nortest_spotify_yt') || '{}'); if (!(ytc[t.id] && ytc[t.id].length)) { ytc[t.id] = t.yt.slice(0, 3); localStorage.setItem('nortest_spotify_yt', JSON.stringify(ytc)); } } catch (e) { } }
    const id = resolve(t);
    rmap.set(t.id, id);
    if (id) { pos[t.id] = ids.length; ids.push(id); }
  }
  queue = ids;
  const want = idx != null && idx >= 0 && q[idx] ? pos[q[idx].id] : 0;
  qi = want != null && want != undefined ? want : Math.max(0, ids.length - 1);
  J.live = true;
}
function descFor(localId) { for (const [did, lid] of rmap) if (lid === localId) return did; return ''; }
function curDesc() { try { const t = cur; if (!t) return null; const q = (J.sess && J.sess.queue) || []; const did = descFor(t.id); return q.find(x => x.id === did) || null; } catch (e) { return null; } }

/* ---- following the session ---- */
function expected(st) { return st.pos + (st.playing ? Math.max(0, now() - st.at) / 1000 : 0); }
function got(sess, ev) {
  if (!J.on || !sess || sess.code !== J.code) return;
  if (sess.ended || ev === 'end') return ended(false);
  if (sess.seq < J.seq) return;
  const qChanged = !J.sess || J.sess.qv !== sess.qv;
  J.sess = sess; J.seq = sess.seq;
  if (qChanged) install(sess.queue, J.live ? sess.state.idx : null);
  if (J.host) { if (sess.by !== J.pid && sess.kind === 'act' && sess.seq > J.applied) { J.applied = sess.seq; follow(sess.state, true); } }
  else if (ev !== 'members' || qChanged) follow(sess.state, false);
  paint();
}
function follow(st, force) {
  if (!J.on || !st || J.localPaused) return;
  const q = (J.sess && J.sess.queue) || [];
  let idx = q[st.idx] && q[st.idx].id === st.tid ? st.idx : q.findIndex(x => x.id === st.tid);
  if (idx < 0) idx = Math.min(st.idx, q.length - 1); if (idx < 0) return;
  const t = q[idx], lid = rmap.get(t.id);
  const tgt = expected(st);
  if (!J.live || !cur || (lid && cur.id !== lid) || qi < 0) {
    if (!lid) return;
    hold(2500); J.corrAt = performance.now() + 2500;
    install(q, idx);
    load(qi, st.playing);
    if (st.playing) { setTimeout(() => seekQuiet(tgt + 0.7), 300); }
    else setTimeout(() => seekQuiet(tgt), 300);
    paint(); return;
  }
  const playing = playingNow();
  if (st.playing && !playing) { hold(); seekQuiet(tgt + 0.25); start(); try { if (cur && cur.stream && window.spCtl) setTimeout(() => { const sn = window.spNow && window.spNow(); if (sn && !sn.playing) window.spCtl.play(true); }, 500); } catch (e) { } J.corrAt = performance.now() + 2000; }
  else if (!st.playing && playing) { hold(); try { au.pause(); } catch (e) { } try { if (cur && cur.stream && window.spCtl) window.spCtl.play(false); } catch (e2) { } seekQuiet(st.pos); }
  else if (!st.playing && Math.abs(playTime() - st.pos) > 0.5) { hold(); seekQuiet(st.pos); }
  else drift();
}
function drift() {
  if (!J.on || J.localPaused || !J.sess) return;
  const st = J.sess.state; if (!st.playing || !playingNow()) { setRate(1); return; }
  const d = curDesc();
  if (!d || d.id !== st.tid) return;
  if (performance.now() < J.corrAt || (isAudio() && (au.seeking || au.readyState < 3 || au.muted))) return;
  const diff = playTime() - expected(st);
  if (J.host) { if (Math.abs(diff) > 0.5) { seekQuiet(expected(st) + 0.12); J.corrAt = performance.now() + 2500; } return; }
  if (Math.abs(diff) > 0.5) { setRate(1); seekQuiet(expected(st) + 0.12); J.corrAt = performance.now() + 2500; }
  else if (Math.abs(diff) > 0.06 && isAudio()) setRate(Math.max(0.95, Math.min(1.05, 1 - diff * 0.6)));
  else setRate(1);
}
setInterval(() => { if (J.on && !J.host) drift(); }, 1000);

/* ---- the host keeps the session's clock ---- */
function sendState(kind) {
  if (!J.on || !canControl()) return;
  const d = curDesc(); if (!d) return;
  const q = (J.sess && J.sess.queue) || [];
  const idx = Math.max(0, q.findIndex(x => x.id === d.id));
  const st = { idx, tid: d.id, pos: playTime(), playing: playingNow() };
  J.lastHb = Date.now();
  const body = { key: J.key, state: st, base: J.seq, hb: kind === 'hb' ? 1 : 0 };
  req(`/jam/${J.code}/state`, body).then(j => { if (j && j.seq && j.seq > J.seq && kind !== 'hb') { J.seq = j.seq; J.applied = j.seq; } if (j && j.stale && j.session) got(j.session, 'state'); }).catch(() => { });
}
let actT = null;
function action() { clearTimeout(actT); actT = setTimeout(() => sendState('act'), 120); }
function hostTick() { if (J.on && canControl() && Date.now() - J.lastHb > (playingNow() ? 4000 : 15000)) sendState('hb'); }
setInterval(hostTick, 1000);
au.addEventListener('timeupdate', () => { if (!J.on) return; if (canControl()) { if (Date.now() - J.lastHb > 4000) sendState('hb'); } else { drift(); if (Date.now() - J.lastMsg > 25000) watchdog(); } });
['playing', 'seeked'].forEach(ev => au.addEventListener(ev, () => { if (J.on && canControl() && !applying()) action(); }));
au.addEventListener('play', () => { if (!J.on || applying()) return; J.localPaused = false; if (canControl()) action(); else if (J.sess) setTimeout(() => follow(J.sess.state, true), 60); });
au.addEventListener('pause', () => { if (!J.on || applying()) return; if (canControl()) action(); else { J.localPaused = true; setRate(1); paint(); } });
let lastIdx = -2, lastTid = '';
setInterval(() => {
  if (!J.on) return;
  const d = curDesc(); const tid = d ? d.id : '';
  if (qi !== lastIdx || tid !== lastTid) { lastIdx = qi; lastTid = tid; if (canControl() && !applying() && tid) action(); paint(); }
}, 400);
let lastSpPlay = false;
setInterval(() => { // Spotify streams do not tick the audio element; keep the same duties on a 1 s poll
  if (!J.on) return;
  const sn = window.spNow ? window.spNow() : null;
  if (!sn) return;
  const on = !!sn.playing;
  if (on !== lastSpPlay && !applying()) { lastSpPlay = on; if (canControl()) action(); else { J.localPaused = !on; if (on && J.sess) setTimeout(() => follow(J.sess.state, true), 60); paint(); } }
  if (on) { if (canControl()) { if (Date.now() - J.lastHb > 4000) sendState('hb'); } else drift(); }
}, 1000);

/* ---- what the player tells us (hooks in app.js) ---- */
const JAM = window.JAM = {
  active: () => J.on,
  next(auto) {
    if (!J.on) return false;
    if (canControl()) return false;                      // our queue IS the session queue: let it run, the events send the state
    if (!auto) { toast(`${hostName()} has the controls`); return true; }
    return true;                                         // a follower waits for the host's next song
  },
  prev() {
    if (!J.on || canControl()) return false;
    toast(`${hostName()} has the controls`); return true;
  },
  startList(listIds, id) {
    if (!J.on) return false;
    const ids = (listIds || []).filter(x => byId(x));
    if (!ids.length) return false;
    const at = id ? Math.max(0, ids.indexOf(id)) : 0;
    if (!canControl()) { const one = shareable(byId(ids[at])); if (one) addTracks([one]); return true; }
    const q = ids.slice(at).concat(ids.slice(0, at)).map(x => shareable(byId(x))).filter(Boolean);
    if (!q.length) { toast('Nothing in that list can be shared yet'); return true; }
    J.sess = Object.assign({}, J.sess, { queue: q, qv: (J.sess.qv || 0) + 0.5, state: { idx: 0, tid: q[0].id, pos: 0, playing: true, at: now() } });
    J.live = false; install(q, 0); hold(1500); load(qi, true);
    req(`/jam/${J.code}/queue`, { key: J.key, queue: q, state: { idx: 0, tid: q[0].id, pos: 0, playing: true } }).then(j => { if (j && j.seq) J.seq = Math.max(J.seq, j.seq - 1); }).catch(() => { });
    return true;
  }
};
async function addTracks(ts) {
  const list = ts.map(shareable).filter(Boolean); if (!list.length) { toast("That song can't be shared yet"); return; }
  try { const j = await req(`/jam/${J.code}/add`, { key: J.key, tracks: list }); if (j && j.ok) toast(list.length > 1 ? `Added ${list.length} songs to Listen Together` : `Added "${list[0].title}" to Listen Together`); else toast("Couldn't add it, try again"); } catch (e) { toast("Couldn't add it, try again"); }
}

/* ---- start / join / leave ---- */
const me = () => ({ name: (store.name || '').trim() || 'Me', emoji: store.emoji || '🎧' });
async function startSession() {
  let listIds = null;
  if (J.live && queue.length && cur) listIds = queue;
  else if (lastList && lastList.length) { playList(lastList, lastList[0]); await new Promise(r => setTimeout(r, 500)); listIds = lastList; }
  else if (queue.length && cur) listIds = queue;
  if (!listIds || !cur) { toast('Play a song or open a playlist first'); return false; }
  const q = listIds.filter(x => byId(x)).map(x => shareable(byId(x))).filter(Boolean);
  if (!q.length) { toast('Nothing in that list can be shared yet'); return false; }
  const d = curDesc(); const at = Math.max(0, q.findIndex(x => x.id === (d && d.id)));
  const st = { idx: at, tid: q[at] ? q[at].id : q[0].id, pos: playTime(), playing: playingNow(), at: now() };
  await syncClock();
  const j = await req('/jam/new', Object.assign({ queue: q, state: st, control: !!store.control }, me()));
  if (!j || !j.ok) { toast("Couldn't start Listen Together, check your connection"); return false; }
  J.back = lastList ? [...lastList] : null;
  Object.assign(J, { on: true, code: j.code, key: j.key, pid: j.pid, host: true, sess: j.session, seq: j.session.seq, applied: j.session.seq, localPaused: false, lastMsg: Date.now() });
  install(q, st.idx);
  store.sess = { code: j.code, key: j.key, pid: j.pid, host: true, at: Date.now() }; saveStore();
  connect(); paint(); toast('Listen Together started. Share the code');
  return true;
}
async function lookup(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); if (code.length !== 5) return { error: 'That code has 5 letters/numbers' };
  try { const j = await req(`/jam/${code}`); if (j.session && !j.session.ended) return { code, sess: j.session }; return { error: 'That session has ended or the code is wrong' }; } catch (e) { return { error: "Can't reach Listen Together, check your connection" }; }
}
function joinNow(code, sess) {
  Object.assign(J, { on: true, code, key: '', pid: '', host: false, sess, seq: sess.seq, localPaused: false, lastMsg: Date.now() });
  install(sess.queue, sess.state.idx);
  follow(sess.state, true);
  (async () => {
    const j = await req(`/jam/${code}/join`, Object.assign({ key: store.sess && store.sess.code === code ? store.sess.key : '' }, me())).catch(() => null);
    if (!j || !j.ok) { toast(j && j.ended ? 'That session just ended' : "Couldn't join, try again"); if (j && j.ended) ended(false); return; }
    J.key = j.key; J.pid = j.pid; store.sess = { code, key: j.key, pid: j.pid, host: false, at: Date.now() }; saveStore();
    await syncClock(); connect(); got(j.session, 'state'); J.corrAt = 0; drift();
  })();
  paint();
}
async function leave() {
  if (!J.on) return;
  const wasHost = J.host, code = J.code, key = J.key;
  J.on = false; disconnect(); setRate(1); J.live = false;
  req(`/jam/${code}/leave`, { key }).catch(() => { });
  delete store.sess; saveStore();
  if (wasHost) restoreBack(); else { try { au.pause(); } catch (e) { } }
  toast(wasHost ? 'Listen Together ended' : 'You left Listen Together');
  J.sess = null; paint();
}
function restoreBack() {
  const b = J.back; const t = cur;
  if (b && b.length && t) { const i = b.indexOf(t.id); if (i >= 0) { queue = [...b]; qi = i; refreshQ && refreshQ(); } }
}
function ended(gone) {
  if (!J.on) return; const hn = hostName(), host = J.host;
  J.on = false; disconnect(); setRate(1); J.live = false; delete store.sess; saveStore();
  if (!host) { try { au.pause(); } catch (e) { } toast(gone ? 'That Listen Together session is over' : `${hn} ended Listen Together`); }
  J.sess = null; paint();
}

/* ---- UI ---- */
const ICON = 'groups';
let view = 'main', joinInfo = null, searchQ = '';
let closeT = null;
function build() {
  if ($('#jamSheet')) return;
  const s = document.createElement('div'); s.id = 'jamSheet'; s.className = 'jam-sheet hidden'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-label', 'Listen Together');
  s.innerHTML = '<div class="jam-back"></div><div class="jam-card"><div class="jam-grab"></div><div id="jamBody"></div></div>';
  document.body.appendChild(s);
  s.querySelector('.jam-back').onclick = close;
  s.addEventListener('click', onClick); s.addEventListener('input', onInput); s.addEventListener('change', onChange);
}
function open(v) { build(); view = v || 'main'; clearTimeout(closeT); $('#jamSheet').classList.remove('hidden'); requestAnimationFrame(() => $('#jamSheet').classList.add('show')); paint(true); }
function close() { const s = $('#jamSheet'); if (!s) return; s.classList.remove('show'); clearTimeout(closeT); closeT = setTimeout(() => s.classList.add('hidden'), 260); }
const isOpen = () => { const s = $('#jamSheet'); return s && !s.classList.contains('hidden'); };
function who(sess) { return (sess.members || []).map(m => `<span class="jam-who${m.away ? ' away' : ''}"><b>${esc(m.emoji)}</b>${esc(m.name)}${m.host ? ' <em>host</em>' : ''}</span>`).join(''); }
function queueHTML(sess) {
  const q = sess.queue || [], curIdx = J.live ? qi : sess.state.idx;
  const from = Math.max(0, curIdx - 1);
  return q.slice(from, from + 30).map((t, k) => { const i = from + k; const lid = rmap.get(t.id); return `<button class="jam-q${i === curIdx ? ' cur' : ''}${i < curIdx ? ' done' : ''}" data-qi="${i}"><img src="${esc(t.art || '')}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.by ? ' &middot; added by ' + esc(t.by) : ''}${!lid ? ' &middot; not in your library' : ''}</small></span>${i === curIdx ? '<i class="jam-eq"><u></u><u></u><u></u></i>' : ''}</button>`; }).join('') + (q.length > from + 30 ? `<p class="jam-more">+${q.length - from - 30} more</p>` : '');
}
function profileHTML() {
  const m = me();
  return `<label class="jam-lab">Your name</label><input id="jamName" class="jam-in" maxlength="24" placeholder="Your name" value="${esc(store.name || '')}" autocomplete="nickname">
  <div class="jam-emo">${EMOJI.map(e => `<button data-emo="${e}" class="${e === m.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>`;
}
function searchHTML() {
  if (!searchQ.trim()) return '';
  const q = searchQ.trim().toLowerCase(); const out = songs.filter(s => (s.title + ' ' + s.artist).toLowerCase().includes(q)).slice(0, 25);
  J.results = out;
  return out.length ? out.map((t, i) => `<button class="jam-r" data-add="${i}"><span><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span><i>+</i></button>`).join('') : '<p class="jam-muted">No songs in your library match.</p>';
}
function paint(full) {
  const btn = $('#jamBtn'), cnt = $('#jamCount');
  const n = J.on && J.sess ? (J.sess.members || []).length : 0;
  if (btn) btn.classList.toggle('on', J.on); if (cnt) cnt.textContent = J.on && n > 1 ? n : '';
  if (!isOpen()) return;
  const body = $('#jamBody'); const active = document.activeElement && document.activeElement.id;
  if (!full && (active === 'jamName' || active === 'jamCode' || active === 'jamSearch')) { const q = $('#jamQ'), w = $('#jamWho'); if (q && J.sess) q.innerHTML = queueHTML(J.sess); if (w && J.sess) w.innerHTML = who(J.sess); return; }
  let h = '';
  if (joinInfo && !J.on) {
    const s = joinInfo.sess;
    h = `<h2 class="jam-h">Listen Together</h2><p class="jam-sub"><b>${esc(s.host.emoji)} ${esc(s.host.name)}</b> invited you to listen along. You'll hear the same song at the same moment.</p>
    ${profileHTML()}<div class="jam-now">${s.queue[s.state.idx] ? `Playing now: <b>${esc(s.queue[s.state.idx].title)}</b> &middot; ${esc(s.queue[s.state.idx].artist)}` : ''}</div>
    <button class="jam-go" id="jamJoin">Join</button><button class="jam-link" id="jamCancel">Not now</button>`;
  } else if (view === 'resume' && store.sess && !J.on) {
    h = `<h2 class="jam-h">Listen Together</h2><p class="jam-sub">You were in session <b>${esc(store.sess.code)}</b>.</p>
    <button class="jam-go" id="jamResume">Rejoin</button><button class="jam-link" id="jamForget">Leave it</button>`;
  } else if (!J.on) {
    const c = cur;
    h = `<h2 class="jam-h">Listen Together</h2><p class="jam-sub">Play music with a friend in real time. Share the 5-letter code and you'll both hear the same song at the same second.</p>
    ${profileHTML()}
    <button class="jam-go" id="jamStart">${c || (lastList && lastList.length) ? 'Start a session' : 'Play something to start'}</button>
    <div class="jam-or"><span>or join a friend</span></div>
    <div class="jam-joinrow"><input id="jamCode" class="jam-in code" maxlength="5" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="jam-sec" id="jamCodeGo">Join</button></div>
    <p class="jam-err" id="jamErr"></p>`;
  } else {
    const s = J.sess || { members: [], queue: [], state: {} };
    h = `<div class="jam-top"><h2 class="jam-h">Listen Together</h2><span class="jam-live"><i></i>LIVE</span></div>
    ${J.host ? `<div class="jam-code"><small>Join code</small><b>${esc(J.code)}</b></div><div class="jam-share"><button class="jam-go" id="jamShare">Share the code</button></div>`
      : `<p class="jam-sub">Listening with <b>${esc(hostName())}</b>${J.localPaused ? '. <span class="jam-warn">Paused just for you. Press play to jump back in.</span>' : ''}</p>`}
    <div class="jam-who-row" id="jamWho">${who(s)}</div>
    ${J.host ? `<label class="jam-toggle"><input type="checkbox" id="jamCtl" ${s.control ? 'checked' : ''}><span>Friends can control (skip, pause, seek)</span></label>` : (s.control ? '<p class="jam-muted">Everyone can control the music.</p>' : `<p class="jam-muted">${esc(hostName())} controls the music. You can add songs.</p>`)}
    <h3 class="jam-h3">Queue</h3><div class="jam-qs" id="jamQ">${queueHTML(s)}</div>
    <h3 class="jam-h3">Add songs</h3><input id="jamSearch" class="jam-in" placeholder="Search your library" value="${esc(searchQ)}" autocomplete="off"><div id="jamRes">${searchHTML()}</div>
    <button class="jam-end" id="jamLeave">${J.host ? 'End session' : 'Leave'}</button>`;
  }
  body.innerHTML = h;
}
function onInput(e) {
  if (e.target.id === 'jamName') { store.name = e.target.value.slice(0, 24); saveStore(); }
  if (e.target.id === 'jamSearch') { searchQ = e.target.value; const r = $('#jamRes'); if (r) r.innerHTML = searchHTML(); }
  if (e.target.id === 'jamCode') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function onChange(e) {
  if (e.target.id === 'jamCtl') { store.control = e.target.checked; saveStore(); req(`/jam/${J.code}/settings`, { key: J.key, control: e.target.checked }).catch(() => { }); if (J.sess) J.sess.control = e.target.checked; }
}
async function onClick(e) {
  const t = e.target.closest('button,[data-add],[data-qi]'); if (!t) return;
  if (t.id === 'jamStart') { t.disabled = true; const ok = await startSession(); if (!ok) t.disabled = false; paint(true); return; }
  if (t.id === 'jamCodeGo') { const r = await lookup($('#jamCode').value); if (r.error) { $('#jamErr').textContent = r.error; return; } joinInfo = { sess: r.sess, pending: true }; paint(true); return; }
  if (t.id === 'jamJoin') { const ji = joinInfo; joinInfo = null; if (ji) { view = 'main'; joinNow(ji.sess.code, ji.sess); close(); } return; }
  if (t.id === 'jamCancel') { joinInfo = null; close(); return; }
  if (t.id === 'jamResume') { const code = store.sess && store.sess.code; if (!code) return; const r = await lookup(code); if (r.error) { toast(r.error); delete store.sess; saveStore(); view = 'main'; paint(true); return; } joinNow(code, r.sess); close(); return; }
  if (t.id === 'jamForget') { delete store.sess; saveStore(); view = 'main'; paint(true); return; }
  if (t.id === 'jamShare') { const code = J.code; try { if (navigator.share) navigator.share({ title: 'Listen Together on Nortest', text: `Join my Nortest Listen Together session with code ${code}` }); else { await navigator.clipboard.writeText(code); toast('Code copied: ' + code); } } catch (e2) { toast('Code: ' + code); } return; }
  if (t.id === 'jamLeave') { leave(); return; }
  if (t.dataset.emo) { store.emoji = t.dataset.emo; saveStore(); paint(true); return; }
  if (t.dataset.add != null && J.results) { const s = J.results[+t.dataset.add]; if (s) addTracks([shareable(s)].filter(Boolean)); return; }
  if (t.dataset.qi != null && J.sess) { const i = +t.dataset.qi, q = J.sess.queue || []; if (i > (J.live ? qi : J.sess.state.idx) && canControl()) { J.sess = Object.assign({}, J.sess, { state: { idx: i, tid: (q[i] || {}).id || '', pos: 0, playing: true, at: now() } }); J.live = false; install(q, i); hold(1500); load(qi, true); sendState('act'); } else if (i > (J.live ? qi : J.sess.state.idx)) toast(`${hostName()} has the controls`); return; }
}
/* entry points: a button in the big player's top bar and one on each playlist page */
const jamBtnHTML = () => `<button class="ib" id="jamBtn" data-jam="1" aria-label="Listen Together" title="Listen Together"><span data-i="${ICON}"></span><i id="jamCount"></i></button>`;
setInterval(() => {
  try {
    const bt = document.querySelector('#big .bt');
    if (bt && !$('#jamBtn')) { const side = bt.querySelector('[data-a="side"]'); const b = document.createElement('button'); b.className = 'ib'; b.id = 'jamBtn'; b.setAttribute('aria-label', 'Listen Together'); b.innerHTML = mi(ICON) + '<i id="jamCount"></i>'; const el = b; side ? bt.insertBefore(el, side) : bt.appendChild(el); el.onclick = e => { e.preventDefault(); open(J.on ? 'main' : (store.sess ? 'resume' : 'main')); }; }
    const acts = document.querySelector('#view .phead .acts');
    if (acts && !acts.querySelector('#plJam')) { const b = document.createElement('button'); b.className = 'btn tonal'; b.id = 'plJam'; b.innerHTML = `<span data-i="${ICON}"></span>Listen Together`; b.onclick = e => { e.preventDefault(); open(store.sess && !J.on ? 'resume' : 'main'); }; acts.insertBefore(b, acts.firstChild); }
    const rp = document.querySelector('#jamResume');
    if (rp && store.sess) { /* nothing */ }
  } catch (e) { }
}, 800);
/* joining from a link (the web version): ?jam=CODE */
try { const m = /[?&]jam=([A-Z0-9]{5})/i.exec(location.search); if (m) { joinInfo = null; lookup(m[1]).then(r => { if (r.sess) { view = 'join'; joinInfo = { sess: r.sess, pending: true }; open('main'); } }); } } catch (e) { }
})();
