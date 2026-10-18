/* nortest 1.6 - Batch 1: gapless + loudness leveling, smart playlists, Replay, sleep timer, A-B loop + bookmarks.
   Loaded after backup.js. Uses only the existing 1.5.2 glass components (settings rows, .seg, .chip, .card, .row, #mb, #setp).
   New data lives in new IndexedDB meta keys (plog, ldays, bmarks, lvl, smart, replaySince); no existing key is renamed or rewritten. */
(() => {
  'use strict';
  /* ---------- icons, same SF line style as sf.js ---------- */
  Object.assign(window.SFI || (window.SFI = {}), {
    bedtime: '<path d="M18.9 14.9A7.4 7.4 0 0 1 9.1 5.1a7.4 7.4 0 1 0 9.8 9.8z"/>',
    bookmark: '<path d="M7.4 4.2h9.2a1.2 1.2 0 0 1 1.2 1.2v14.2L12 15.9l-5.8 3.7V5.4a1.2 1.2 0 0 1 1.2-1.2z"/>',
    ab_loop: '<path d="M3.8 19l3-8.4 3 8.4M4.9 16.2h3.8"/><path d="M14 10.6v8.4h3.2a2.2 2.2 0 0 0 0-4.4H14m0 0h2.8a2 2 0 0 0 0-4H14"/><path d="M6.6 7.6c3-2.9 7.8-2.9 10.8 0"/><path d="M15.4 5.2l2 2.4-2.6 1"/>',
    replay_stats: '<path d="M5 19.4v-5.6M9.7 19.4V9.6M14.3 19.4v-7.6M19 19.4V5"/>',
    smart_list: '<path d="M4 6.6h11M4 11.6h6.5M4 16.6h6.5"/><circle cx="17" cy="15.2" r="2.4"/><path d="M17 10.9v1.3M17 18.2v1.3M21.3 15.2H20M14 15.2h-1.3M20 12.2l-.9.9M14.9 17.3l-.9.9M20 18.2l-.9-.9M14.9 13.1l-.9-.9"/>',
    close: '<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/>'
  });

  const B1 = { plog: [], ldays: {}, bmarks: {}, lvl: {}, smart: [], since: 0, ready: false };
  const T = {};
  const sv = k => { if (T[k]) return; T[k] = setTimeout(() => { T[k] = 0; save(k, B1[k]); }, 1500); };   /* throttled: at most one write per key every 1.5 s */
  const toast = m => { try { if (NN && NN.toast) return NN.toast(m); } catch (e) { }
    let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('show'); clearTimeout(T.toast); T.toast = setTimeout(() => t.classList.remove('show'), 2200); };
  const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const plays = () => (window.nortestPlays && nortestPlays()) || {};
  Promise.all(['plog', 'ldays', 'bmarks', 'lvl', 'smart', 'replaySince'].map(k => meta(k))).then(([a, b, c, d, e, f]) => {
    B1.plog = Array.isArray(a) ? a : []; B1.ldays = b || {}; B1.bmarks = c || {}; B1.lvl = d || {}; B1.smart = Array.isArray(e) ? e : [];
    B1.since = f || Date.now(); if (!f) save('replaySince', B1.since);
    B1.ready = true; if (view === 'playlists') render(); marks();
  });

  /* ---------- per-song wrap of load(): dated play log, A-B reset, sleep "songs" count, leveling ---------- */
  let logged = false, lastPos = 0, lastDur = 0, loadAt = 0;
  const _load = load;
  load = function () {
    const prev = cur, prevLeft = lastDur - lastPos;
    const r = _load.apply(this, arguments);
    if (cur && prev !== cur) {
      logged = false; AB.a = AB.b = null; abLoop(); loadAt = performance.now();
      const xfs = +S.xf || 0;
      if (prev && lastDur && prevLeft < Math.max(3, xfs + 2)) sleepSongDone();
      lastPos = 0; lastDur = cur.dur || 0;
      lvlApply(prev); marks(); abBtn();
      setTimeout(lvlQueue, 4000);
    }
    return r;
  };
  au.addEventListener('playing', () => { if (loadAt) { const dt = (performance.now() - loadAt) / 1000; if (dt > 0 && dt < 1.5) GP.lead = Math.min(0.3, Math.max(0.05, GP.lead * 0.6 + dt * 0.4)); loadAt = 0; } lvlGraph(); lvlApply(); });
  let ltLast = 0;
  au.addEventListener('timeupdate', () => {
    if (!cur) return;
    if (isFinite(au.duration)) { lastPos = au.currentTime; lastDur = au.duration; }
    const n = Date.now();
    if (!au.paused && ltLast && n - ltLast < 2000) { const k = dayKey(n); B1.ldays[k] = (B1.ldays[k] || 0) + (n - ltLast) / 1000; sv('ldays'); }
    ltLast = n;
    if (!logged && !au.paused && au.currentTime >= Math.min(30, (au.duration || cur.dur || 60) * 0.5)) {
      logged = true; B1.plog.push([cur.id, n]); if (B1.plog.length > 30000) B1.plog.splice(0, B1.plog.length - 30000); sv('plog');
    }
  });

  /* ---------- gapless: start the next song the moment this one ends ---------- */
  const GP = { t: 0, lead: 0.12, pre: null };
  const gpFire = () => {
    GP.t = 0;
    if (au.paused || !isFinite(au.duration)) return;
    if (au.duration - au.currentTime < 1.2) au.currentTime = au.duration;   /* the normal "song ended" path: queue, repeat, play counts all as before */
  };
  au.addEventListener('timeupdate', () => {
    if (S.gapless === false || +S.xf || au.paused || !cur || !isFinite(au.duration) || GP.t) return;
    if (AB.b != null || SL.stopsHere()) return;
    const rem = (au.duration - au.currentTime) / (au.playbackRate || 1);
    if (rem > 1.1 || rem <= GP.lead) return;
    GP.t = setTimeout(gpFire, Math.max(0, (rem - GP.lead) * 1000));
    gpPreload();
  });
  au.addEventListener('seeking', () => { if (GP.t && au.duration - au.currentTime > 1.2) { clearTimeout(GP.t); GP.t = 0; } });
  /* phone songs stream from the app: warm the next one so it starts instantly */
  const gpPreload = () => {
    if (S.shuf || !queue.length) return;
    const s = byId(queue[(qi + 1) % queue.length]);
    if (!s || s.blob || !s.src) return;
    if (!GP.pre) { GP.pre = new Audio(); GP.pre.preload = 'auto'; GP.pre.muted = true; }
    if (GP.pre.src !== s.src) { GP.pre.src = s.src; try { GP.pre.load(); } catch (e) { } }
  };

  /* ---------- loudness leveling (ReplayGain-style, measured on the phone with K-weighted gated loudness) ---------- */
  const LV = { m: null, g: null, fade: null, busy: false, cur: 0, target: -14 };
  const lvlGain = s => { const x = s && B1.lvl[s.id]; if (!x || S.lvl !== true) return 0; let g = LV.target - x.l; g = Math.max(-12, Math.min(8, g)); if (x.p > 0) g = Math.min(g, -20 * Math.log10(x.p) - 0.5); return g; };
  function lvlGraph() {
    if (!ctx || !G.main || !F.in) return;
    if (!LV.m) { LV.m = ctx.createGain(); G.main.disconnect(); G.main.connect(LV.m).connect(F.in); }
    if (G.ghost && !LV.g) { LV.g = ctx.createGain(); G.ghost.disconnect(); G.ghost.connect(LV.g).connect(F.in); }
    if (!LV.fade && F.boost) { LV.fade = ctx.createGain(); F.boost.disconnect(); F.boost.connect(LV.fade).connect(ctx.destination); }
  }
  function lvlApply(prev) {
    lvlGraph(); if (!LV.m) return;
    const g = lvlGain(cur), lin = Math.pow(10, g / 20), t = ctx.currentTime;
    if (prev !== undefined && LV.g && xf.busy) LV.g.gain.setValueAtTime(Math.pow(10, lvlGain(prev) / 20), t);
    LV.m.gain.cancelScheduledValues(t); LV.m.gain.setValueAtTime(LV.m.gain.value, t); LV.m.gain.linearRampToValueAtTime(lin, t + (prev !== undefined ? 0.05 : 1.5));
    LV.cur = g;
  }
  async function analyze(s) {
    if (!s || B1.lvl[s.id] || LV.busy || !(s.blob || s.src)) return false;
    LV.busy = true;
    try {
      const buf = s.blob ? await s.blob.arrayBuffer() : await fetch(s.src).then(r => { if (!r.ok) throw new Error('fetch'); return r.arrayBuffer(); });
      if (buf.byteLength > 80e6) return false;
      const SR = 16000;
      const dec = await new OfflineAudioContext(2, 1, SR).decodeAudioData(buf);
      let peak = 0; for (let c = 0; c < dec.numberOfChannels; c++) { const d = dec.getChannelData(c); for (let i = 0; i < d.length; i += 2) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; } }
      /* ITU-R BS.1770 K-weighting, then 400 ms blocks (75% overlap) with the absolute and relative gates */
      const oc = new OfflineAudioContext(dec.numberOfChannels, dec.length, SR), src = oc.createBufferSource(); src.buffer = dec;
      const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
      const hs = oc.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681; hs.gain.value = 4;
      src.connect(hp).connect(hs).connect(oc.destination); src.start();
      const kw = await oc.startRendering();
      const bl = Math.round(SR * 0.4), hop = Math.round(SR * 0.1), ms = [];
      const ch = [...Array(kw.numberOfChannels)].map((_, c) => kw.getChannelData(c));
      for (let st = 0; st + bl <= kw.length; st += hop) { let z = 0; for (const d of ch) for (let i = st; i < st + bl; i += 2) z += d[i] * d[i]; ms.push(z / (bl / 2)); }
      const L = z => -0.691 + 10 * Math.log10(z || 1e-12);
      let g1 = ms.filter(z => L(z) > -70); if (!g1.length) return false;
      const rel = L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
      const g2 = g1.filter(z => L(z) > rel);
      const loud = L(g2.reduce((a, b) => a + b, 0) / g2.length);
      B1.lvl[s.id] = { l: Math.round(loud * 10) / 10, p: Math.round(peak * 1000) / 1000 }; sv('lvl');
      if (cur === s) lvlApply();
      return true;
    } catch (e) { return false; }
    finally { LV.busy = false; }
  }
  /* measure what's playing first, then what's coming up, one song at a time */
  async function lvlQueue() {
    if (S.lvl !== true || LV.busy) return;
    const ids = [cur && cur.id, ...queue.slice(qi + 1, qi + 4)].filter(Boolean);
    for (const id of ids) { const s = byId(id); if (s && !B1.lvl[s.id]) { await analyze(s); break; } }
  }
  document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.s; if (k === 'lvl') { lvlApply(); lvlQueue(); } });
  au.addEventListener('playing', () => setTimeout(lvlQueue, 1500));

  /* ---------- sleep timer: minutes, end of song, end of N songs, fade out ---------- */
  const FADE = 30;
  const SL = {
    mode: 'off', at: 0, left: 0, tm: 0,
    stopsHere() { return this.mode === 'end' || (this.mode === 'songs' && this.left <= 1); },
    label() {
      if (this.mode === 'min') { const r = Math.max(0, this.at - Date.now()); return 'Pauses in ' + fmt(r / 1000); }
      if (this.mode === 'end') return 'Pauses when this song ends';
      if (this.mode === 'songs') return this.left <= 1 ? 'Pauses when this song ends' : 'Pauses after ' + this.left + ' more songs';
      return 'Off';
    }
  };
  const fadeTo = v => { lvlGraph(); if (LV.fade && ctx) { const t = ctx.currentTime; LV.fade.gain.cancelScheduledValues(t); LV.fade.gain.setValueAtTime(LV.fade.gain.value, t); LV.fade.gain.linearRampToValueAtTime(v, t + 0.25); } };
  const sleepStop = () => {
    au.pause(); SL.mode = 'off'; clearInterval(SL.tm); SL.tm = 0;
    setTimeout(() => fadeTo(1), 400); slUI(); toast('Sleep timer: paused');
  };
  const sleepSet = (mode, n) => {
    clearTimeout(sleepT); sleepEnd = false; sleepMin = 0;   /* the old 1.5 timer stays off; this one replaces it */
    clearInterval(SL.tm); SL.tm = 0; fadeTo(1);
    SL.mode = mode;
    if (mode === 'min') SL.at = Date.now() + n * 60000;
    if (mode === 'songs') SL.left = n;
    if (mode === 'end') SL.left = 1;
    if (mode !== 'off') { S.sleepLast = mode + ':' + n; save('S', S); SL.tm = setInterval(sleepTick, 500); }
    slUI();
  };
  function sleepSongDone() { if (SL.mode === 'songs' && SL.left > 1) { SL.left--; slUI(); } }
  function sleepTick() {
    if (SL.mode === 'off') return;
    const fade = S.sleepFade !== false;
    if (SL.mode === 'min') {
      const r = (SL.at - Date.now()) / 1000;
      if (r <= 0) return sleepStop();
      if (fade && !au.paused) fadeTo(r < FADE ? Math.max(0, r / FADE) : 1);
    } else if (SL.stopsHere() && cur && isFinite(au.duration)) {
      const xfs = +S.xf || 0, end = au.duration - (xfs ? xfs + 0.4 : 0.35), r = (end - au.currentTime) / (au.playbackRate || 1);
      if (r <= 0) return sleepStop();
      if (fade && !au.paused) fadeTo(r < 12 ? Math.max(0, r / 12) : 1);
    }
    const el = document.querySelector('.b1sl'); if (el) el.textContent = SL.label();
  }
  au.addEventListener('ended', () => { if (SL.mode !== 'off' && SL.stopsHere()) sleepStop(); }, true);
  const slUI = () => {
    const b = document.getElementById('b1Sl'); if (b) b.classList.toggle('on', SL.mode !== 'off');
    document.querySelectorAll('.b1sl').forEach(e => e.textContent = SL.label());
    const p = document.getElementById('setp'); if (p && !p.classList.contains('hid') && !B1.page) { const e = p.querySelector('.b1slrow span'); if (e) e.textContent = SL.label(); }
  };
  const chip = (on, a, extra, t) => `<button class="chip ${on ? 'on' : ''}" data-a="${a}" ${extra}>${on ? mi('check') : ''}${t}</button>`;
  const sleepSheet = () => {
    const m = SL.mode, isMin = v => m === 'min' && SL.n === v, isS = v => (m === 'songs' || m === 'end') && SL.n === v;
    mod(`<h3>Sleep timer</h3><p class="b1sub b1sl">${SL.label()}</p>
<section class="sg b1sg"><h2>Minutes</h2><div class="chips wrap">${[15, 30, 45, 60, 90].map(v => chip(isMin(v), 'b1slset', `data-m="min" data-n="${v}"`, v + ' min')).join('')}</div></section>
<section class="sg b1sg"><h2>Songs</h2><div class="chips wrap">${chip(isS(1), 'b1slset', 'data-m="end" data-n="1"', 'End of song')}${[2, 3, 5].map(v => chip(isS(v), 'b1slset', `data-m="songs" data-n="${v}"`, v + ' songs')).join('')}</div></section>
<section class="sg b1sg"><h2>Ending</h2><div class="chips wrap">${chip(S.sleepFade !== false, 'b1slfade', '', 'Fade out')}</div></section>
<div class="mrow"><button class="btn" data-a="b1sloff">Turn off</button><button class="btn pri" data-a="mx">Done</button></div>`);
  };

  /* ---------- A-B loop ---------- */
  const AB = { a: null, b: null, tm: 0 };
  function abLoop() {
    clearInterval(AB.tm); AB.tm = 0;
    if (AB.a != null && AB.b != null) AB.tm = setInterval(() => { if (!au.paused && au.currentTime >= AB.b) au.currentTime = AB.a; }, 40);
  }
  const abBtn = () => {
    const b = document.getElementById('b1Ab'); if (!b) return;
    b.classList.toggle('on', AB.a != null); b.classList.toggle('half', AB.a != null && AB.b == null);
    b.setAttribute('aria-label', AB.a == null ? 'A-B loop: set A' : AB.b == null ? 'A-B loop: set B' : 'A-B loop: off');
  };
  const abTap = () => {
    if (!cur || !isFinite(au.duration)) return;
    const t = au.currentTime, xfs = +S.xf || 0;
    if (AB.a == null) { AB.a = t; toast('A set at ' + fmt(t) + '. Tap again to set B'); }
    else if (AB.b == null) {
      if (t < AB.a + 1) { AB.a = null; toast('A-B loop off'); }
      else { AB.b = Math.min(t, au.duration - xfs - 1); au.currentTime = AB.a; toast('Looping ' + fmt(AB.a) + ' to ' + fmt(AB.b)); }
    } else { AB.a = AB.b = null; toast('A-B loop off'); }
    abLoop(); abBtn(); marks();
  };

  /* ---------- bookmarks ---------- */
  const bms = () => (cur && B1.bmarks[cur.id]) || [];
  const bmSheet = () => {
    if (!cur) return;
    const L = bms();
    mod(`<h3>Bookmarks</h3><p class="b1sub">${esc(cur.title)}</p>
<button class="btn pri wide" data-a="b1bmadd">${mi('bookmark')}Add bookmark at ${fmt(au.currentTime)}</button>
<div class="mlist b1bml">${L.length ? L.map(t => `<div class="row" data-a="b1bmgo" data-t="${t}"><div class="rm"><b>${fmt(t)}</b><span>Jump here</span></div><button class="ib sm" data-a="b1bmdel" data-t="${t}" aria-label="Remove bookmark">${mi('trash')}</button></div>`).join('') : '<p class="empty">No bookmarks in this song yet.</p>'}</div>
<div class="mrow"><button class="btn pri" data-a="mx">Done</button></div>`);
  };
  /* A, B and bookmark marks on the scrubber */
  function marks() {
    const sk = document.querySelector('#big .sk'); if (!sk) return;
    let m = sk.querySelector('.b1mk'); if (!m) { m = document.createElement('div'); m.className = 'b1mk'; sk.insertBefore(m, sk.querySelector('input')); }
    const d = au.duration || (cur && cur.dur) || 0;
    if (!cur || !d || !isFinite(d)) { m.innerHTML = ''; return; }
    const pc = t => Math.max(0, Math.min(100, t / d * 100)) + '%';
    let h = bms().map(t => `<i class="bm" style="left:${pc(t)}"></i>`).join('');
    if (AB.a != null) h += AB.b != null ? `<b style="left:${pc(AB.a)};width:calc(${pc(AB.b)} - ${pc(AB.a)})"></b>` : `<i class="ab" style="left:${pc(AB.a)}"></i>`;
    m.innerHTML = h;
  }
  au.addEventListener('loadedmetadata', marks);

  /* Now Playing: three more glyph buttons in the centered bottom row, same .ib.tg as shuffle/repeat */
  (() => {
    const bb = document.querySelector('#big .bb'); if (!bb) return;
    const mk = (id, a, icon, label) => { const b = document.createElement('button'); b.className = 'ib tg'; b.id = id; b.dataset.a = a; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = mi(icon); return b; };
    const rep = bb.querySelector('#bRep');
    rep.after(mk('b1Ab', 'b1ab', 'ab_loop', 'A-B loop'), mk('b1Bm', 'b1bm', 'bookmark', 'Bookmarks'), mk('b1Sl', 'b1sl', 'bedtime', 'Sleep timer'));
  })();

  /* ---------- smart playlists ---------- */
  const DAY = 86400000;
  const lastPlayed = () => { const m = {}; for (const [id, t] of B1.plog) if (!m[id] || t > m[id]) m[id] = t; return m; };
  const BUILTIN = [
    { id: 'most', name: 'Most played', r: { plays: 1, sort: 'plays', limit: 50 } },
    { id: 'recent', name: 'Recently added', r: { sort: 'added', limit: 50 } },
    { id: 'never', name: 'Never played', r: { plays: -1, sort: 'added' } },
    { id: 'favs', name: 'Favorites', r: { fav: true, sort: 'added' } }
  ];
  const smartAll = () => [...BUILTIN.map(x => ({ ...x, builtin: true })), ...B1.smart];
  const smartGet = k => smartAll().find(x => 'smart:' + x.id === k);
  function smartIds(sp) {
    const r = sp.r || {}, P = plays(), now = Date.now(), lp = r.recentPlay ? lastPlayed() : null;
    const ar = (r.artist || '').toLowerCase().trim(), al = (r.album || '').toLowerCase().trim();
    let L = songs.filter(s => okSong(s)
      && (!r.fav || s.fav)
      && (!r.plays || (r.plays < 0 ? !(P[s.id] > 0) : (P[s.id] || 0) >= r.plays))
      && (!r.added || (s.added || 0) >= now - r.added * DAY)
      && (!lp || (lp[s.id] || 0) >= now - r.recentPlay * DAY)
      && (!ar || s.artist.toLowerCase().includes(ar))
      && (!al || s.album.toLowerCase().includes(al)));
    const by = { plays: (a, b) => (P[b.id] || 0) - (P[a.id] || 0) || (b.added || 0) - (a.added || 0), added: (a, b) => (b.added || 0) - (a.added || 0), title: (a, b) => a.title.localeCompare(b.title), artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title) };
    L = r.sort === 'random' ? shuffle(L) : L.sort(by[r.sort] || by.added);
    if (r.limit) L = L.slice(0, r.limit);
    return L.map(s => s.id);
  }
  const _pHTML = pHTML;
  pHTML = function () {
    if (sub && String(sub).startsWith('smart:')) {
      const sp = smartGet(sub);
      if (sp) {
        const ids = smartIds(sp);
        return `<div class="dhead"><button class="ib" data-a="back" aria-label="Back">${mi('keyboard_arrow_down')}</button></div><div class="phead"><img src="${cover(byId(ids[0]))}" alt=""><div><small>Smart playlist</small><h2>${esc(sp.name)}</h2><span>${nS(ids.length)} &middot; updates on its own</span><div class="acts">${ids.length ? `<button class="btn pri" data-a="playall">${mi('play_arrow', 1)}Play</button><button class="btn tonal" data-a="shufall">${mi('shuffle')}Shuffle</button>` : ''}${sp.builtin ? '' : `<button class="btn text" data-a="b1sedit" data-k="${esc(sp.id)}">Edit rules</button>`}</div></div></div>` + list(ids, sp.id === 'never' ? 'You have played every song.' : 'No songs match these rules yet.');
      }
      sub = null;
    }
    const h = _pHTML.apply(this, arguments);
    if (sub) return h;
    return h + `<h2 class="st">Smart playlists</h2><div class="grid">${smartAll().map(sp => { const ids = smartIds(sp); return card(sp.name, nS(ids.length), cover(byId(ids[0])), 'smart:' + sp.id); }).join('')}<div class="card new" data-a="b1snew"><div class="plus">${mi('add')}</div><b>New smart playlist</b><span>&nbsp;</span></div></div>`;
  };
  /* rule editor: a Settings-style page with the same rows */
  const opt = (v, cur, t) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`;
  const smartEdit = sp => {
    const r = (sp && sp.r) || { sort: 'plays' };
    const p = $('#setp'); B1.page = 'smart'; B1.edit = sp ? sp.id : null;
    p.innerHTML = `<header class="sh"><button class="ib" data-a="b1back" aria-label="Back"><span class="rot90">${mi('keyboard_arrow_down')}</span></button><h1>${sp ? 'Edit smart playlist' : 'New smart playlist'}</h1></header>
<div class="sbody">
<section class="sg"><h2>Name</h2><div class="card-list"><div class="li col"><input type="text" id="b1sn" placeholder="Smart playlist" value="${esc(sp ? sp.name : '')}"></div></div></section>
<section class="sg"><h2>Songs that match all of these</h2><div class="card-list">
  <div class="li"><div class="lt"><b>Favorites only</b></div><label class="swt"><input type="checkbox" id="b1sf" ${r.fav ? 'checked' : ''}><i></i></label></div>
  <div class="li"><div class="lt"><b>Plays</b></div><select id="b1sp">${[[0, 'Any'], [-1, 'Never played'], [1, 'Played at least once'], [3, '3+ plays'], [5, '5+ plays'], [10, '10+ plays'], [25, '25+ plays']].map(([v, t]) => opt(v, r.plays || 0, t)).join('')}</select></div>
  <div class="li"><div class="lt"><b>Added</b></div><select id="b1sa">${[[0, 'Any time'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 3 months'], [365, 'Last year']].map(([v, t]) => opt(v, r.added || 0, t)).join('')}</select></div>
  <div class="li"><div class="lt"><b>Played recently</b><span>Counts from version 1.6</span></div><select id="b1sr">${[[0, 'Any'], [1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days']].map(([v, t]) => opt(v, r.recentPlay || 0, t)).join('')}</select></div>
  <div class="li col"><div class="lt"><b>Artist contains</b></div><input type="text" id="b1sar" placeholder="Any artist" value="${esc(r.artist || '')}"></div>
  <div class="li col"><div class="lt"><b>Album contains</b></div><input type="text" id="b1sal" placeholder="Any album" value="${esc(r.album || '')}"></div>
</div></section>
<section class="sg"><h2>Order</h2><div class="card-list">
  <div class="li"><div class="lt"><b>Sort by</b></div><select id="b1ss">${[['plays', 'Most played'], ['added', 'Recently added'], ['title', 'Title'], ['artist', 'Artist'], ['random', 'Shuffled']].map(([v, t]) => opt(v, r.sort || 'plays', t)).join('')}</select></div>
  <div class="li"><div class="lt"><b>Limit</b></div><select id="b1sl2">${[[0, 'No limit'], [25, '25 songs'], [50, '50 songs'], [100, '100 songs']].map(([v, t]) => opt(v, r.limit || 0, t)).join('')}</select></div>
  <div class="li"><div class="lt"><b>Matching now</b></div><span class="b1cnt"></span></div>
</div></section>
<section class="sg"><div class="card-list">
  <div class="li"><div class="lt"><b>${sp ? 'Save changes' : 'Create smart playlist'}</b></div><button class="btn tonal" data-a="b1ssave">${sp ? 'Save' : 'Create'}</button></div>
  ${sp ? '<div class="li"><div class="lt"><b>Delete smart playlist</b><span>Your songs stay</span></div><button class="btn text danger" data-a="b1sdel">Delete</button></div>' : ''}
</div></section>
</div>`;
    pageOpen(p); smartCount();
  };
  const smartRead = () => ({ fav: $('#b1sf').checked, plays: +$('#b1sp').value, added: +$('#b1sa').value, recentPlay: +$('#b1sr').value, artist: $('#b1sar').value.trim(), album: $('#b1sal').value.trim(), sort: $('#b1ss').value, limit: +$('#b1sl2').value });
  const smartCount = () => { const e = document.querySelector('#setp .b1cnt'); if (e) e.textContent = nS(smartIds({ r: smartRead() }).length); };
  document.addEventListener('input', e => { if (B1.page === 'smart' && e.target.closest('#setp')) smartCount(); });
  document.addEventListener('change', e => { if (B1.page === 'smart' && e.target.closest('#setp')) smartCount(); });

  /* ---------- Replay: your listening, by week, month or all time ---------- */
  const startOf = per => { const d = new Date(); d.setHours(0, 0, 0, 0); if (per === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else d.setDate(1); return d.getTime(); };
  const md = ms => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  function replayData(per) {
    const P = plays();
    if (per === 'all') {
      const st = stats(), cnt = Object.entries(P).filter(([id]) => byId(id));
      return { sec: st.sec, plays: cnt.reduce((a, [, n]) => a + n, 0), counts: Object.fromEntries(cnt) };
    }
    const from = startOf(per), counts = {};
    for (const [id, t] of B1.plog) if (t >= from && byId(id)) counts[id] = (counts[id] || 0) + 1;
    let sec = 0; for (const [k, v] of Object.entries(B1.ldays)) if (new Date(k + 'T00:00:00').getTime() >= from) sec += v;
    return { sec, plays: Object.values(counts).reduce((a, b) => a + b, 0), counts, from };
  }
  const replay = per => {
    per = per || B1.rper || 'week'; B1.rper = per;
    const d = replayData(per), top = Object.entries(d.counts).sort((a, b) => b[1] - a[1]);
    const ar = {}; top.forEach(([id, n]) => byId(id).artist.split(/\s*[;\/]\s*/).forEach(a => ar[a] = (ar[a] || 0) + n));
    const topA = Object.entries(ar).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const songsN = top.length, mins = Math.round(d.sec / 60);
    const pl = n => n + (n === 1 ? ' play' : ' plays');
    const range = per === 'week' ? 'This week, ' + md(d.from) + ' to today' : per === 'month' ? new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Everything so far';
    const startedLate = per !== 'all' && B1.since > d.from;
    const p = $('#setp'); B1.page = 'replay';
    p.innerHTML = `<header class="sh"><button class="ib" data-a="b1back" aria-label="Back"><span class="rot90">${mi('keyboard_arrow_down')}</span></button><h1>Replay</h1></header>
<div class="sbody">
<section class="sg"><div class="card-list"><div class="li col">${seg('b1rp', per, [['week', 'Week'], ['month', 'Month'], ['all', 'All time']]).replace(/data-a="segset"/g, 'data-a="b1rp"')}<div class="lt"><span>${range}${startedLate ? ' &middot; counting since ' + md(B1.since) : ''}</span></div></div></div></section>
<section class="sg"><h2>Listening</h2><div class="card-list">
  <div class="li b1hero"><div class="lt"><b class="b1num">${mins.toLocaleString()}</b><span>minutes listened</span></div><div class="lt b1r"><b class="b1num">${d.plays.toLocaleString()}</b><span>plays</span></div></div>
  <div class="li"><div class="lt"><b>${nS(songsN)} &middot; ${Object.keys(ar).length} ${Object.keys(ar).length === 1 ? 'artist' : 'artists'}</b><span>${per === 'all' ? 'Listening time counts from version 1.4' : 'A play counts after 30 seconds'}</span></div></div>
</div></section>
<section class="sg"><h2>Top songs</h2><div class="card-list"><div class="li col">${top.length ? `<ol class="top5">${top.slice(0, 5).map(([id, n]) => `<li><span>${esc(byId(id).title)}</span><em>${pl(n)}</em></li>`).join('')}</ol>` : `<span class="mut">${per === 'all' ? 'Play some songs first' : 'Nothing played ' + (per === 'week' ? 'this week' : 'this month') + ' yet'}</span>`}</div>
  ${top.length ? `<div class="li"><div class="lt"><b>Play your top songs</b><span>${nS(Math.min(25, top.length))}</span></div><button class="btn tonal" data-a="b1rplay">Play</button></div>` : ''}</div></section>
<section class="sg"><h2>Top artists</h2><div class="card-list"><div class="li col">${topA.length ? `<ol class="top5">${topA.map(([a, n]) => `<li><span>${esc(a)}</span><em>${pl(n)}</em></li>`).join('')}</ol>` : '<span class="mut">Nothing yet</span>'}</div></div></section>
</div>`;
    B1.rtop = top.slice(0, 25).map(([id]) => id);
    pageOpen(p);
  };
  const pageOpen = p => {
    const was = !p.classList.contains('hid');
    p.classList.remove('hid'); p.scrollTop = 0;
    if (typeof bgVis === 'function') bgVis();
    if (!was) document.body.classList.add('set-open');
  };

  /* ---------- Settings: new rows in the existing groups ---------- */
  const _set = settings;
  settings = async function () { B1.page = null; return _set.apply(this, arguments); };
  const _osr = window.onSettingsRendered;
  window.onSettingsRendered = p => {
    try { if (_osr) _osr(p); } catch (e) { }
    try {
      const rowOf = t => [...p.querySelectorAll('.li')].find(li => { const b = li.querySelector('.lt>b'); return b && b.textContent.trim() === t; });
      const xfRow = rowOf('Crossfade');
      if (xfRow && !p.querySelector('[data-s="gapless"]')) {
        const n = Object.keys(B1.lvl).length;
        xfRow.insertAdjacentHTML('afterend', `<div class="li"><div class="lt"><b>Gapless playback</b><span>No pause between songs (when crossfade is off)</span></div>${sw('gapless', S.gapless !== false)}</div>
<div class="li"><div class="lt"><b>Loudness leveling</b><span>Every song plays at the same loudness${n ? ' &middot; ' + nS(n) + ' measured' : ''}</span></div>${sw('lvl', S.lvl === true)}</div>`);
      }
      const sl = rowOf('Sleep timer');
      if (sl) sl.outerHTML = `<div class="li b1slrow"><div class="lt"><b>Sleep timer</b><span>${SL.label()}</span></div><button class="btn tonal" data-a="b1sl">Set</button></div>`;
      const ts = rowOf('Top songs');
      if (ts && !p.querySelector('[data-a="b1replay"]')) ts.insertAdjacentHTML('beforebegin', `<div class="li"><div class="lt"><b>Replay</b><span>Top songs, artists and minutes by week or month</span></div><button class="btn tonal" data-a="b1replay" data-from="settings">Open</button></div>`);
    } catch (e) { }
  };

  /* Library: a Replay chip next to Artists and History */
  const _render = render;
  render = function () {
    const r = _render.apply(this, arguments);
    if (view === 'library') { const c = document.querySelector('#view .chips'); if (c && !c.querySelector('[data-a="b1replay"]')) c.insertAdjacentHTML('beforeend', `<button class="chip" data-a="b1replay">${mi('replay_stats')}Replay</button>`); }
    return r;
  };

  /* Back: Replay / editor return where they came from */
  const _back = window.__nortestBack;
  window.__nortestBack = () => {
    if (B1.page && !$('#setp').classList.contains('hid') && $('#mod').classList.contains('hid')) { A.b1back(); return true; }
    return _back();
  };

  /* a smart playlist's song menu has no "Remove from this playlist" (its rules decide) */
  const _dots = A.dots, _prm = A.prm;
  if (_dots) A.dots = function () { const r = _dots.apply(this, arguments); if (String(sub).startsWith('smart:')) document.querySelectorAll('#menu [data-a="prm"]').forEach(e => e.remove()); return r; };
  if (_prm) A.prm = function () { if (!cp()) return; return _prm.apply(this, arguments); };
  Object.assign(A, {
    b1ab: abTap,
    b1bm: bmSheet,
    b1bmadd: () => { if (!cur) return; const t = Math.floor(au.currentTime * 10) / 10, L = B1.bmarks[cur.id] ||= []; if (!L.some(x => Math.abs(x - t) < 1)) { L.push(t); L.sort((a, b) => a - b); sv('bmarks'); toast('Bookmarked ' + fmt(t)); } marks(); bmSheet(); },
    b1bmgo: b => { au.currentTime = +b.dataset.t; if (au.paused) start(); closeMod(); },
    b1bmdel: (b, id, e) => { if (e) e.stopPropagation(); if (!cur) return; const t = +b.dataset.t; B1.bmarks[cur.id] = bms().filter(x => x !== t); if (!B1.bmarks[cur.id].length) delete B1.bmarks[cur.id]; sv('bmarks'); marks(); bmSheet(); },
    b1sl: sleepSheet,
    b1slset: b => { const m = b.dataset.m, n = +b.dataset.n; SL.n = n; sleepSet(m, n); toast(SL.label()); sleepSheet(); },
    b1slfade: () => { S.sleepFade = S.sleepFade === false; save('S', S); if (S.sleepFade === false) fadeTo(1); sleepSheet(); },
    b1sloff: () => { sleepSet('off'); SL.n = 0; toast('Sleep timer off'); sleepSheet(); },
    b1replay: b => { B1.from = b && b.dataset.from === 'settings' ? 'settings' : 'library'; replay(); },
    b1rp: b => replay(b.dataset.v),
    b1rplay: () => { if (B1.rtop && B1.rtop.length) { playList(B1.rtop); $('#big').classList.add('show'); } },
    b1back: () => { const from = B1.page === 'replay' ? B1.from : 'library'; B1.page = null; if (from === 'settings') settings(); else closeSettings(); },
    b1snew: () => smartEdit(null),
    b1sedit: b => smartEdit(B1.smart.find(x => x.id === b.dataset.k)),
    b1ssave: () => {
      const r = smartRead(), name = $('#b1sn').value.trim() || 'Smart playlist';
      let sp = B1.edit && B1.smart.find(x => x.id === B1.edit);
      if (sp) { sp.name = name; sp.r = r; } else { sp = { id: crypto.randomUUID(), name, r }; B1.smart.push(sp); }
      save('smart', B1.smart); B1.page = null; closeSettings(); view = 'playlists'; sub = 'smart:' + sp.id; render(); $('#view').scrollTop = 0;
    },
    b1sdel: () => {
      if (!B1.edit || !confirm('Delete this smart playlist? Your songs stay.')) return;
      B1.smart = B1.smart.filter(x => x.id !== B1.edit); save('smart', B1.smart); B1.page = null; closeSettings(); sub = null; render();
    }
  });

  /* layout only for the new bits; colors come from the existing glass variables */
  const css = document.createElement('style');
  css.textContent = `
#big .sk .b1mk{position:absolute;left:0;right:0;top:50%;height:0;pointer-events:none;z-index:1}
#big .sk .b1mk i{position:absolute;top:-6px;width:2px;height:12px;margin-left:-1px;border-radius:1px;background:var(--lg-fg,#fff);opacity:.9}
#big .sk .b1mk i.bm{opacity:.55}
#big .sk .b1mk b{position:absolute;top:-5px;height:10px;border-radius:5px;background:var(--lg-fg,#fff);opacity:.22}
html.lgx #big .bb{gap:0}
html.lgx #big .bb .ib{width:40px;flex:none}
#big .bb .ib.half{opacity:.75}
.mb .b1sub{margin:-8px 0 12px;color:var(--lg-fg2,inherit);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mb .b1sg{margin:0 0 12px}.mb .b1sg h2{margin:0 2px 8px}
.mb .btn.wide{width:100%;justify-content:center}
.mb .b1bml{margin-top:10px}.mb .b1bml .row{padding-left:14px}
.mb .b1bml .empty{margin:8px 2px;color:var(--lg-fg2,inherit)}
#setp .b1hero{justify-content:space-between}
#setp .b1num{font-size:34px;font-weight:800;letter-spacing:-.025em;line-height:1.1}
#setp .b1r{text-align:right}
#setp .b1cnt{color:var(--lg-fg2,inherit);font-size:14px}
.toast.b1t{position:fixed;left:50%;bottom:calc(150px + env(safe-area-inset-bottom));transform:translate(-50%,10px);padding:10px 16px;border-radius:999px;font-size:14px;color:var(--lg-fg,#fff);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:9999;max-width:86vw;text-align:center}
.toast.b1t.show{opacity:1;transform:translate(-50%,0)}
/* sheets and dialogs: a darker smoky floor so nothing behind them is readable on the Samsung path */
html.lgx:not([data-glass=off]) #mb:not(#z_):not(#z2_){background:rgba(22,22,27,.985)}
html.lgx.light:not([data-glass=off]) #mb:not(#z_):not(#z2_){background:rgba(248,248,250,.985)}
html.lgx #mod:not(.hid){background:rgba(0,0,0,.5)}
/* mini player: one complete pill; the progress line runs inside it under the song text, not along its bottom edge */
html.lgx #mProg{left:64px;right:24px;bottom:7px;border-radius:1px}
/* sideways: the mini player and rail keep clear of the gesture bar, and the list ends just above the mini player (no dead band, no cut pills) */
@media (orientation:landscape) and (max-height:500px){
html.lgx #mini{bottom:calc(8px + env(safe-area-inset-bottom))}
html.lgx #nav{bottom:calc(8px + env(safe-area-inset-bottom))}
html.lgx.lg-android #app{padding-bottom:0}
}
.b1fade{position:fixed;left:0;right:0;z-index:4;pointer-events:none;overflow:hidden;display:none;-webkit-mask:linear-gradient(to bottom,transparent,#000 44px);mask:linear-gradient(to bottom,transparent,#000 44px)}
.b1fade>.b1fadebg{position:absolute!important;left:0;right:0;bottom:auto;inset:auto 0 auto 0;z-index:0;transition:none}
@media (max-width:440px){html.lgx #big:not(.side) .tr{gap:0}html.lgx #big:not(.side) .bgp{gap:clamp(2px,1.6vw,18px)}html.lgx #big:not(.side) .tr>.ib{width:42px}}`;
  document.head.appendChild(css);


  /* Android with a wallpaper: the list fades into the wallpaper just above the mini player instead of ending on a hard line.
     (A mask on the list would stop the glass chips from blurring the wallpaper, so this lays a copy of the wallpaper over the last 44px.) */
  (() => {
    const H = document.documentElement, FH = 44;
    const fade = document.createElement('div'); fade.className = 'b1fade'; fade.setAttribute('aria-hidden', 'true'); document.body.appendChild(fade);
    let sig = '', raf = 0;
    const sync = () => {
      raf = 0;
      const bg = document.querySelector('body > .bg'), main = document.querySelector('.main'), big = document.getElementById('big');
      const on = H.classList.contains('lg-android') && document.body.classList.contains('cbg-on') && bg && main && !bg.querySelector('video:not(.hid)') && !document.body.classList.contains('set-open') && !(big && big.classList.contains('show'));
      if (!on) { fade.style.display = 'none'; return; }
      const top = Math.round(main.getBoundingClientRect().bottom - FH);
      fade.style.display = 'block'; fade.style.top = top + 'px'; fade.style.height = Math.max(0, innerHeight - top) + 'px';
      const s = bg.innerHTML + '|' + (bg.getAttribute('style') || '') + '|' + bg.className + '|' + innerWidth + 'x' + innerHeight + '|' + top;
      if (s === sig) return; sig = s;
      const c = bg.cloneNode(true); c.querySelectorAll('video').forEach(v => v.remove()); c.classList.add('b1fadebg'); c.style.top = (-top) + 'px'; c.style.height = innerHeight + 'px';
      fade.replaceChildren(c);
    };
    const q = () => { if (!raf) raf = requestAnimationFrame(sync); };
    addEventListener('resize', () => setTimeout(q, 80));
    new MutationObserver(q).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(q).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    const bgEl = document.querySelector('body > .bg'); if (bgEl) new MutationObserver(q).observe(bgEl, { attributes: true, childList: true, subtree: true, characterData: false });
    const bigEl = document.getElementById('big'); if (bigEl) new MutationObserver(q).observe(bigEl, { attributes: true, attributeFilter: ['class'] });
    setTimeout(q, 300);
    window.__b1fade = sync;
  })();

  /* test hooks (read-only views) */
  window.__b1 = { B1, SL, AB, GP, LV, analyze, smartIds, smartAll, replayData, sleepSet };
})();
