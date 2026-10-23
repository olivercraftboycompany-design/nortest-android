/* nortest 1.6.3 (1.6.5: Live from your state) - Radio: live internet radio from the free, public Radio Browser directory (radio-browser.info).
   Loaded last. Stations play in their OWN audio element (#rau), not through the equalizer graph: a stream from
   another site would come out silent through Web Audio. The mini player, the big player, Media Session (lock screen)
   and the Tab remote follow the radio while it plays; tapping any song goes back to your music.
   Stored: localStorage nortest_radio_favs (favorite stations), nortest_radio_recent, nortest_radio_cc (country), nortest_radio_region. */
(() => {
  'use strict';
  const LSF = 'nortest_radio_favs', LSR = 'nortest_radio_recent', LSC = 'nortest_radio_cc';
  const SERVERS = ['de1', 'fi1', 'de2', 'nl1'].map(s => `https://${s}.api.radio-browser.info`);
  const GENRES = [['top', 'Top'], ['pop', 'Pop'], ['hip hop', 'Hip hop'], ['rock', 'Rock'], ['country', 'Country'], ['christian', 'Christian'], ['news', 'News'], ['sports', 'Sports'], ['lofi', 'Lofi'], ['classical', 'Classical'], ['jazz', 'Jazz'], ['dance', 'Dance']];
  const TAGQ = { 'hip hop': ['hip hop', 'hiphop', 'rap'], lofi: ['lofi', 'lo-fi', 'chillhop'], christian: ['christian', 'christian music', 'worship', 'gospel'], sports: ['sports', 'sport', 'sports talk'], news: ['news', 'news talk'], pop: ['pop', 'top 40', 'hits'], dance: ['dance', 'edm', 'electronic'] };
  const COUNTRIES = [['', 'Anywhere'], ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['MX', 'Mexico'], ['AU', 'Australia'], ['IE', 'Ireland'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BR', 'Brazil'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'], ['PH', 'Philippines'], ['NG', 'Nigeria'], ['ZA', 'South Africa'], ['JM', 'Jamaica']];
  const PLAYABLE = /^(MP3|AAC|AAC\+|HE-AAC|AACP)$/i;
  const SVG_RADIO = '<path d="M7.1 16.9a6.9 6.9 0 0 1 0-9.8M16.9 7.1a6.9 6.9 0 0 1 0 9.8"/><path d="M4.3 19.7a10.9 10.9 0 0 1 0-15.4M19.7 4.3a10.9 10.9 0 0 1 0 15.4"/><circle cx="12" cy="12" r="2.1" class="fl"/>';
  if (window.SFI && !SFI.radio) SFI.radio = SVG_RADIO;
  /* the plain tile a station without a usable logo gets (same colors as a song without a cover) */
  const RPH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3a3f4a"/><g transform="translate(26 26) scale(2.1667)" fill="none" stroke="#c9cfdc" stroke-width="1.6" stroke-linecap="round">' + SVG_RADIO.replace('class="fl"', 'fill="#c9cfdc" stroke="none"') + '</g></svg>');
  window.nortestRadioPH = RPH;

  const rau = document.createElement('audio');
  rau.id = 'rau'; rau.preload = 'none';
  document.body.appendChild(rau);

  const ls = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const R = {
    on: false, st: null, list: [], mode: 'top', q: '', cc: ls(LSC, 'US'),
    favs: ls(LSF, []), recent: ls(LSR, []), cache: {}, by: {}, srv: 0, loading: false, err: '', bad: 0, tm: 0, reqId: 0, view: null
  };
  if (!Array.isArray(R.favs)) R.favs = [];
  if (!Array.isArray(R.recent)) R.recent = [];

  const T = {};
  const toast = m => {
    try { if (NN && NN.toast) return NN.toast(m); } catch (e) { }
    let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('show'); clearTimeout(T.t); T.t = setTimeout(() => t.classList.remove('show'), 2400);
  };

  /* ---------- look: the existing rows, chips, search bar and player; nothing new on the glass ---------- */
  const st = document.createElement('style');
  st.textContent = `
.radio .rch{margin-top:2px}
#view #rq{width:auto;height:100%;padding:0;border:0;border-radius:0;background:none;box-shadow:none;outline:0}
.radio .rmeta{margin:2px 4px 4px}
.radio .rmeta span{flex:1}
.rrow img.rf{object-fit:cover;background:#3a3f4a}
.rrow .rm{flex:1;min-width:0}
.rrow .rm b,.rrow .rm span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rlv{display:inline-flex;align-items:center;gap:5px;flex:none;font-style:normal;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--lg-acc,var(--md-primary))}
.rlv i,.rlive i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:rpulse 1.6s ease-in-out infinite}
.rlv.off i,.rlive.off i{animation:none;opacity:.45}
.rlv.off{color:var(--lg-fg3,var(--md-on-surface-variant))}
@keyframes rpulse{50%{opacity:.25}}
html.rm-motion .rlv i,html.rm-motion .rlive i{animation:none}
.rsk .row{pointer-events:none}
.rsq{width:52px;height:52px;border-radius:9px;flex:none;background:var(--lg-hair,rgba(255,255,255,.08))}
.rln{display:block;height:12px;width:58%;border-radius:6px;background:var(--lg-hair,rgba(255,255,255,.08))}
.rln.s{width:36%;height:10px;margin-top:8px}
.rretry{margin-top:16px}
.rlive{display:none}
body.radio-on #big .pr,body.radio-on #big .tr>.ib,body.radio-on #big .bb,body.radio-on #mProg,body.radio-on #big #lyr{display:none!important}
body.radio-on #big .rlive{display:flex;align-items:center;justify-content:center;gap:8px;height:44px;margin:18px 0 6px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--lg-acc,var(--md-primary))}
body.radio-on #big .rlive.off{color:var(--lg-fg2,var(--md-on-surface-variant))}
body.radio-on #bArt:not([src^="data:"]),body.radio-on #mArt:not([src^="data:"]){object-fit:contain;background:#3a3f4a}
body.radio-on #bArt:not([src^="data:"]){padding:14%;box-sizing:border-box}
`;
  document.head.appendChild(st);

  /* ---------- station data ---------- */
  const slim = s => ({
    id: s.stationuuid || s.id, name: String(s.name || 'Station').replace(/\s*[(\[][^)\]]*\b(\d+\s?k(bps)?|mp3|aac\+?|ogg|opus)\b[^)\]]*[)\]]/ig, '').trim().replace(/\s+/g, ' ') || String(s.name || 'Station').trim(), url: s.url_resolved || s.url,
    logo: /^https:\/\//i.test(s.favicon || s.logo || '') ? (s.favicon || s.logo) : '',
    tags: (Array.isArray(s.tags) ? s.tags : String(s.tags || '').split(',')).map(x => x.trim()).filter(x => x && x.length <= 20 && !/^\d|^(rsl|hd|hq|fm|am|radio|music|online|internet)$/i.test(x)).slice(0, 3),
    cc: s.countrycode || s.cc || '', codec: s.codec || '', br: +s.bitrate || +s.br || 0, home: s.homepage || s.home || ''
  });
  const okStation = s => /^https:\/\//i.test(s.url_resolved || '') && !+s.hls && (!s.codec || PLAYABLE.test(s.codec) || s.codec === 'UNKNOWN');
  const baseName = n => n.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(hd|opus|aac\+?|mp3|ogg|\d+\s?k(bps)?|hq|lq|low|high)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  /* one copy of each station (the directory lists the same stream several times), at most 2 per broadcaster */
  const tidy = (arr, perHost = 2) => {
    const seen = new Set(), hosts = {}, out = [];
    for (const raw of arr) {
      if (!okStation(raw)) continue;
      const s = slim(raw), k = baseName(s.name) || s.id;
      if (seen.has(k) || seen.has(s.url)) continue;
      const h = host(s.home) || host(s.url);
      if (h && perHost && (hosts[h] = (hosts[h] || 0) + 1) > perHost) continue;
      seen.add(k); seen.add(s.url); out.push(s);
    }
    return out;
  };
  const api = async (path, params) => {
    const qs = new URLSearchParams({ hidebroken: 'true', ...params }).toString();
    let lastErr;
    for (let i = 0; i < SERVERS.length; i++) {
      const base = SERVERS[(R.srv + i) % SERVERS.length];
      try {
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
        const r = await fetch(`${base}/json/${path}?${qs}`, { signal: ctl.signal });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        R.srv = (R.srv + i) % SERVERS.length;
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('offline');
  };
  const search = p => api('stations/search', { order: 'clickcount', reverse: 'true', is_https: 'true', limit: 120, ...p });
  const cached = async (key, fn) => {
    const c = R.cache[key];
    if (c && Date.now() - c.at < 15 * 60000) return c.list;
    const list = await fn();
    R.cache[key] = { at: Date.now(), list };
    list.forEach(s => R.by[s.id] = s);
    return list;
  };
  const ccName = c => (COUNTRIES.find(x => x[0] === c) || [c, c])[1];
  /* where the phone roughly is (state/region), from a free public lookup with no key; kept a week (nortest_radio_region) */
  const LSG = 'nortest_radio_region';
  let RG = ls(LSG, null);
  const region = async () => {
    if (RG && RG.r && Date.now() - (RG.at || 0) < 7 * 864e5) return RG;
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 5000);
      const j = await (await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: ctl.signal })).json();
      clearTimeout(to);
      if (j && j.region && j.country_code) { RG = { r: String(j.region), cc: String(j.country_code).toUpperCase(), city: j.city || '', at: Date.now() }; lsSet(LSG, RG); }
    } catch (e) { }
    return RG;
  };

  /* what the Radio page lists: sections of stations */
  async function fetchSections() {
    const cc = R.cc, q = R.q.trim();
    if (q) {
      const list = await cached('q:' + q.toLowerCase(), async () => {
        const [a, b] = await Promise.all([search({ name: q, limit: 80 }), search({ tag: q.toLowerCase(), limit: 40 }).catch(() => [])]);
        return tidy([...a, ...b], 3).slice(0, 60);
      });
      return [{ h: list.length ? 'Stations' : '', list, empty: `No stations found for "${esc(q)}".` }];
    }
    if (R.mode === 'favs') return [{ h: '', list: R.favs, empty: 'Tap the heart on a station to keep it here.' }];
    if (R.mode === 'top') {
      const secs = [];
      /* 1.6.5: "Live from <your state>" first: local stations for where the phone is (approximate, from the internet connection) */
      const rg = await region();
      if (rg && rg.r && rg.cc && (!cc || rg.cc === cc)) {
        const loc = await cached('loc:' + rg.cc + ':' + rg.r, async () => tidy(await search({ state: rg.r, countrycode: rg.cc, limit: 80 }), 2).slice(0, 15)).catch(() => []);
        if (loc.length) secs.push({ h: 'Live from ' + rg.r, list: loc });
      }
      if (cc) secs.push({ h: 'Top in ' + (cc === 'US' ? 'the US' : cc === 'GB' ? 'the UK' : ccName(cc)), list: await cached('top:' + cc, async () => tidy(await search({ countrycode: cc })).slice(0, cc === 'US' ? 30 : 25)) });
      const world = await cached('top:', async () => tidy(await search({ limit: 200 })).slice(0, 40));
      secs.push({ h: 'Top worldwide', list: world.filter(s => s.cc !== cc).slice(0, 25) });
      return secs;
    }
    const tags = TAGQ[R.mode] || [R.mode];
    const key = 'g:' + R.mode + ':' + cc;
    const list = await cached(key, async () => {
      const reqs = tags.map(t => search({ tag: t, tagExact: 'true', limit: 80, ...(cc ? { countrycode: cc } : {}) }).catch(() => []));
      let arr = (await Promise.all(reqs)).flat().sort((a, b) => b.clickcount - a.clickcount);
      let out = tidy(arr);
      if (cc && out.length < 12) {
        const more = (await Promise.all(tags.slice(0, 2).map(t => search({ tag: t, tagExact: 'true', limit: 60 }).catch(() => [])))).flat().sort((a, b) => b.clickcount - a.clickcount);
        out = tidy([...arr, ...more]);
      }
      return out.slice(0, 40);
    });
    const g = (GENRES.find(x => x[0] === R.mode) || [0, R.mode])[1];
    return [{ h: g + (cc ? (list.some(s => s.cc !== cc) ? '' : ' in ' + (cc === 'US' ? 'the US' : ccName(cc))) : ''), list, empty: 'No stations for this one right now.' }];
  }

  /* ---------- Radio page ---------- */
  const isFav = id => R.favs.some(s => s.id === id);
  const logo = s => s.logo || RPH;
  const meta = s => [s.tags.slice(0, 2).join(', '), s.cc, s.br ? s.br + ' kbps' : ''].filter(Boolean).map(esc).join(' &middot; ');
  const rrow = s => `<div class="row rrow${R.on && R.st && R.st.id === s.id ? ' now' : ''}" data-a="rdplay" data-rid="${esc(s.id)}"><img class="rf" src="${esc(logo(s))}" alt="" loading="lazy" onerror="this.onerror=null;this.src=nortestRadioPH"><div class="rm"><b>${esc(s.name)}</b><span>${meta(s)}</span></div>${R.on && R.st && R.st.id === s.id ? `<em class="rlv${rau.paused ? ' off' : ''}"><i></i>Live</em>` : ''}<button class="ib hrt ${isFav(s.id) ? 'on' : ''}" data-a="rdfav" aria-label="${isFav(s.id) ? 'Remove from favorite stations' : 'Add to favorite stations'}">${ic('heart', isFav(s.id))}</button></div>`;
  const skel = n => `<div class="lst rsk">${Array.from({ length: n }, () => '<div class="row"><span class="rsq"></span><div class="rm"><b class="rln"></b><span class="rln s"></span></div></div>').join('')}</div>`;
  let lastSecs = null;
  window.radioHTML = () => {
    const chips = [...(R.favs.length ? [['favs', 'Favorites']] : []), ...GENRES];
    if (R.mode === 'favs' && !R.favs.length) R.mode = 'top';
    const head = `<label class="sbar in rsb"><span class="sic">${mi('search')}</span><input id="rq" type="search" placeholder="Search radio stations" autocomplete="off" enterkeyhint="search" value="${esc(R.q)}"></label>
<div class="chips rch" role="group" aria-label="Genre">${chips.map(([k, t]) => `<button class="chip ${!R.q && R.mode === k ? 'on' : ''}" data-a="rdmode" data-v="${esc(k)}" aria-pressed="${!R.q && R.mode === k}">${!R.q && R.mode === k ? mi('check') : ''}${t}</button>`).join('')}</div>
${R.q || R.mode === 'favs' ? '' : `<div class="lmeta rmeta"><span>Country</span><select id="rcc" aria-label="Country">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === R.cc ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}`;
    let body;
    if (R.err) body = `<p class="empty">Can't reach the radio directory right now.<br><button class="btn tonal rretry" data-a="rdretry">Try again</button></p>`;
    else if (!lastSecs) body = skel(8);
    else body = lastSecs.map(sec => (sec.h ? `<h2 class="st">${esc(sec.h)}</h2>` : '') + (sec.list.length ? `<div class="lst">${sec.list.map(rrow).join('')}</div>` : `<p class="empty">${sec.empty || ''}</p>`)).join('');
    if (!lastSecs && !R.err && !R.loading) setTimeout(refresh, 0);
    return `<div class="radio">${head}<div class="rbody">${body}</div></div>`;
  };
  const paintBody = () => {
    if (view !== 'radio') return;
    const b = document.querySelector('#view .rbody');
    if (!b) return render();
    const tmp = document.createElement('div'); tmp.innerHTML = radioHTML();
    b.replaceWith(tmp.querySelector('.rbody'));
  };
  async function refresh() {
    const id = ++R.reqId;
    R.loading = true; R.err = '';
    try {
      const secs = await fetchSections();
      if (id !== R.reqId) return;
      lastSecs = secs; R.list = secs.flatMap(s => s.list);
    } catch (e) {
      if (id !== R.reqId) return;
      R.err = String(e && e.message || e);
    } finally { if (id === R.reqId) R.loading = false; }
    paintBody();
  }
  const reload = () => { lastSecs = null; paintBody(); refresh(); };
  let qT = 0;
  document.addEventListener('input', e => {
    if (e.target.id === 'rq') { clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { if (R.q === v) return; R.q = v; reloadKeepInput(); }, 450); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'rcc') { R.cc = e.target.value; lsSet(LSC, R.cc); reload(); }
  });
  document.addEventListener('keydown', e => { if (e.target.id === 'rq' && e.key === 'Enter') { clearTimeout(qT); R.q = e.target.value; reloadKeepInput(); e.target.blur(); } });
  /* typing in the search box: keep the box (and the keyboard), redraw the chips and the list */
  const reloadKeepInput = () => {
    const ch = document.querySelector('#view .rch'), mt = document.querySelector('#view .rmeta');
    const tmp = document.createElement('div'); lastSecs = null; tmp.innerHTML = radioHTML();
    if (ch) ch.replaceWith(tmp.querySelector('.rch'));
    const nm = tmp.querySelector('.rmeta');
    if (mt && !nm) mt.remove(); else if (!mt && nm) document.querySelector('#view .rch').after(nm);
    paintBody(); refresh();
  };

  /* ---------- playing ---------- */
  const _origPause = HTMLMediaElement.prototype.pause;
  const _origPlay = HTMLMediaElement.prototype.play;
  const setMS = () => {
    if (!('mediaSession' in navigator)) return;
    const h = R.on
      ? [['play', () => rPlay()], ['pause', () => _origPause.call(rau)], ['stop', () => _origPause.call(rau)], ['nexttrack', () => step(1)], ['previoustrack', () => step(-1)], ['seekbackward', null], ['seekforward', null], ['seekto', null]]
      : [['play', start], ['pause', () => au.pause()], ['nexttrack', next], ['previoustrack', prev],
      ['seekbackward', d => seekBy(-((d && d.seekOffset) || 10))], ['seekforward', d => seekBy((d && d.seekOffset) || 10)],
      ['seekto', d => { if (d.fastSeek && 'fastSeek' in au) au.fastSeek(d.seekTime); else au.currentTime = d.seekTime; posState(); }],
      ['stop', () => { au.pause(); au.currentTime = 0; posState(); }]];
    h.forEach(([a, f]) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { } });
    if (R.on) { try { navigator.mediaSession.setPositionState(); } catch (e) { } }
  };
  const msMeta = () => {
    if (!('mediaSession' in navigator) || !R.on || !R.st) return;
    const s = R.st, base = new URL('icons/', location.href).href;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: R.now || s.name, artist: R.now ? s.name : 'Live radio' + (s.tags[0] ? ' \u00b7 ' + s.tags[0] : ''), album: 'nortest radio',
        artwork: [...(s.logo ? [{ src: s.logo, sizes: '512x512' }] : []), { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.playbackState = rau.paused ? 'paused' : 'playing';
    } catch (e) { }
  };
  function rUI() {
    const s = R.st; if (!R.on || !s) return;
    document.body.classList.add('radio-on');
    $('#mT').textContent = s.name;
    $('#mA').textContent = R.now || (R.wait ? 'Connecting...' : 'Live radio' + (s.tags[0] ? ' \u00b7 ' + s.tags[0] : ''));
    $('#mArt').src = $('#bArt').src = logo(s);
    $('#bT').textContent = s.name;
    $('#bA').textContent = R.now || (s.tags.length ? s.tags.join(', ') : 'Live radio');
    $('#bAl').textContent = [ccName(s.cc), s.codec && s.br ? s.br + ' kbps ' + s.codec : ''].filter(Boolean).join(' \u00b7 ');
    const f = isFav(s.id);
    $('#bH').classList.toggle('on', f); $('#bH').innerHTML = ic('heart', f);
    $('#bH').setAttribute('aria-label', f ? 'Remove from favorite stations' : 'Add to favorite stations');
    const lv = $('#rlive'); if (lv) { lv.classList.toggle('off', rau.paused); lv.querySelector('span').textContent = R.wait ? 'Connecting' : rau.paused ? 'Paused' : 'Live'; }
    document.title = s.name + ' - nortest';
    rPi(); msMeta();
    document.querySelectorAll('#view .rrow').forEach(r => {
      const on = r.dataset.rid === s.id; r.classList.toggle('now', on);
      const em = r.querySelector('.rlv');
      if (on && !em) r.querySelector('.hrt').insertAdjacentHTML('beforebegin', `<em class="rlv${rau.paused ? ' off' : ''}"><i></i>Live</em>`);
      else if (!on && em) em.remove();
      else if (em) em.classList.toggle('off', rau.paused);
    });
  }
  function rPi() {
    const p = rau.paused && !R.wait;
    ['#mpl', '#bpl'].forEach(i => $(i).innerHTML = ic(p ? 'play' : 'pause'));
    $('#big').classList.toggle('paused', p);
    $('#mini').classList.toggle('paused', p);
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = rau.paused ? 'paused' : 'playing'; } catch (e) { } }
  }
  const rPlay = () => {
    if (!R.st) return;
    if (!rau.getAttribute('src')) rau.src = R.st.url;
    R.wait = rau.readyState < 3; rUI();
    armStall();
    const p = _origPlay.call(rau); if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') { R.wait = false; rUI(); } });
  };
  const armStall = () => {
    clearTimeout(R.tm);
    const st = R.st;
    R.tm = setTimeout(() => { if (R.on && R.st === st && R.wait) dead(st, 'not responding'); }, 15000);
  };
  function play(s, list) {
    if (!s || !s.url) return;
    if (list) R.playList = list;
    try { if (!au.paused) _origPause.call(au); } catch (e) { }
    const was = R.on;
    R.on = true; R.st = s; R.now = '';
    rau.src = s.url;
    R.recent = [s, ...R.recent.filter(x => x.id !== s.id)].slice(0, 20); lsSet(LSR, R.recent);
    if (!was) setMS();
    rPlay();
    try { fetch(SERVERS[R.srv] + '/json/url/' + encodeURIComponent(s.id)).catch(() => { }); } catch (e) { }   /* counts the play in the directory, as its docs ask */
  }
  function stop(keepUI) {
    if (!R.on) return;
    clearTimeout(R.tm);
    _origPause.call(rau); rau.removeAttribute('src'); try { rau.load(); } catch (e) { }
    R.on = false; R.wait = false; R.now = '';
    document.body.classList.remove('radio-on');
    setMS();
    if (!keepUI) ui();
  }
  const listFor = () => (R.playList && R.playList.length ? R.playList : R.list);
  function step(d, auto) {
    const L = listFor(); if (!L.length || !R.st) return false;
    if (!auto) R.tried = new Set();
    let i = L.findIndex(x => x.id === R.st.id);
    for (let k = 1; k <= L.length; k++) {
      const c = L[((i < 0 ? -1 : i) + d * k + L.length * k) % L.length];
      if (c && c.id !== R.st.id && !(auto && R.tried && R.tried.has(c.id))) { play(c); return true; }
    }
    return false;
  }
  function dead(s, why) {
    if (!R.on || R.st !== s) return;
    (R.tried ||= new Set()).add(s.id);
    R.bad = Date.now() - (R.badAt || 0) < 60000 ? R.bad + 1 : 1; R.badAt = Date.now();
    if (R.bad < 6 && listFor().length > 1) { toast(s.name + ' is off the air, trying the next one'); if (step(1, true)) return; }
    toast(s.name + " isn't playing right now"); R.wait = false; clearTimeout(R.tm); _origPause.call(rau); rUI();
  }
  rau.addEventListener('playing', () => { R.wait = false; R.bad = 0; clearTimeout(R.tm); rUI(); });
  rau.addEventListener('waiting', () => { if (!R.on) return; R.wait = true; rUI(); armStall(); });
  rau.addEventListener('pause', () => { if (R.on) { R.wait = false; clearTimeout(R.tm); rUI(); } });
  rau.addEventListener('play', () => { if (R.on) rUI(); });
  rau.addEventListener('error', () => { if (R.on && rau.getAttribute('src')) dead(R.st, 'error'); });
  rau.volume = (typeof S !== 'undefined' && S.vol != null) ? S.vol : 1;
  /* a live stream that drops: reconnect once quietly */
  rau.addEventListener('stalled', () => { if (!R.on || rau.paused) return; setTimeout(() => { if (R.on && R.wait && !rau.paused) { const s = R.st; rau.src = s.url; rPlay(); } }, 6000); });

  /* ---------- hook into the player ---------- */
  const _ui = ui; ui = function () { _ui(); if (R.on) rUI(); };
  const _pi = pi; pi = function () { if (R.on) return rPi(); _pi(); };
  const _media = media; media = function () { if (R.on) return msMeta(); _media(); };
  const _start = start; start = function () { if (R.on) return rPlay(); return _start.apply(this, arguments); };
  const _load = load; load = function (i, play) { if (R.on && play !== false) stop(true); return _load.apply(this, arguments); };
  /* "pause" from anywhere (sleep timer, remote, Media Session) pauses the radio too */
  au.pause = function () { if (R.on) _origPause.call(rau); return _origPause.call(au); };
  au.addEventListener('volumechange', () => { rau.volume = au.volume; rau.muted = au.muted; });
  const _toggle = A.toggle; A.toggle = (...a) => { if (!R.on) return _toggle(...a); rau.paused ? rPlay() : _origPause.call(rau); };
  const _next = A.next, _prev = A.prev;
  A.next = (...a) => R.on ? step(1) : _next(...a);
  A.prev = (...a) => R.on ? step(-1) : _prev(...a);
  const _fav = A.fav; A.fav = (b, id, ...r) => { if (R.on && !id && b && b.id === 'bH') return favToggle(R.st); return _fav(b, id, ...r); };
  const _lyr = A.lyr; A.lyr = (...a) => { if (R.on) return; return _lyr(...a); };
  const _open = A.open; A.open = (...a) => { if (R.on) $('#big').classList.remove('lyr'); return _open(...a); };
  ['b10', 'f10'].forEach(k => { const f = A[k]; A[k] = (...a) => R.on ? undefined : f(...a); });
  /* keyboard: space / N / P follow the radio while it plays */
  document.addEventListener('keydown', e => {
    if (!R.on || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'p' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); if (e.key === 'n') step(1); if (e.key === 'p') step(-1); }
  }, true);

  const favToggle = s => {
    if (!s) return;
    if (isFav(s.id)) R.favs = R.favs.filter(x => x.id !== s.id); else R.favs = [s, ...R.favs];
    lsSet(LSF, R.favs);
    if (R.on) rUI();
    if (view === 'radio') {
      if (R.mode === 'favs') { lastSecs = null; } 
      const ch = document.querySelector('#view .rch');
      if (ch && (R.favs.length === 0 || (R.favs.length === 1 && isFav(s.id)))) { reloadKeepInputSoft(); return; }
      document.querySelectorAll(`#view .rrow[data-rid="${CSS.escape(s.id)}"] .hrt`).forEach(b => { const f = isFav(s.id); b.classList.toggle('on', f); b.innerHTML = ic('heart', f); });
      if (R.mode === 'favs') refresh();
    }
    toast(isFav(s.id) ? 'Saved to favorite stations' : 'Removed from favorite stations');
  };
  const reloadKeepInputSoft = () => { const y = $('#view').scrollTop; const keep = lastSecs; render(); lastSecs = keep; paintBody(); $('#view').scrollTop = y; if (R.mode === 'favs') refresh(); };

  const findStation = id => R.by[id] || R.favs.find(x => x.id === id) || R.recent.find(x => x.id === id);
  Object.assign(A, {
    rdplay: b => {
      const s = findStation(b.dataset.rid); if (!s) return;
      if (R.on && R.st && R.st.id === s.id) { rau.paused ? rPlay() : _origPause.call(rau); return; }
      const sec = b.closest('.lst');
      const list = sec ? [...sec.querySelectorAll('.rrow')].map(r => findStation(r.dataset.rid)).filter(Boolean) : R.list;
      R.tried = new Set(); R.bad = 0; play(s, list);
    },
    rdfav: b => favToggle(findStation(b.closest('[data-rid]').dataset.rid)),
    rdmode: b => { R.mode = b.dataset.v; R.q = ''; const i = $('#rq'); if (i) i.value = ''; R.playList = null; lastSecs = null; render(); refresh(); },
    rdretry: () => reload()
  });
  R.favs.forEach(s => R.by[s.id] = s);

  /* the Live strip in the big player (where the seek bar goes for songs) */
  const pr = document.querySelector('#big .pr');
  if (pr) pr.insertAdjacentHTML('afterend', '<div id="rlive" class="rlive off"><i></i><span>Live</span></div>');

  /* ---------- Tab remote: "radio <name>", "play radio <name>", "play station <name>"; and play/pause/next while the radio is on ---------- */
  const TOPIC = (window.tabRemote && tabRemote.topic) || 'nortest-7013d8b424a21d78';
  const findAndPlay = async q => {
    try {
      const bq = baseName(q), sc = s => { const b = baseName(s.name); return b === bq ? 0 : b.startsWith(bq) ? 1 : b.includes(bq) ? 2 : 3; };
      const list = tidy(await search({ name: q, limit: 40 }), 3).map((s, i) => [s, sc(s) * 100 + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
      if (!list.length) { toast('No station called ' + q); return false; }
      R.tried = new Set(); R.bad = 0; play(list[0], list); return true;
    } catch (e) { toast("Can't reach the radio directory"); return false; }
  };
  const status = () => {
    if (!R.on || !R.st) return false;
    const txt = `radio: ${R.st.name}${R.now ? ' - ' + R.now : ''} ${rau.paused ? 'paused' : 'playing'}, vol:${Math.round(rau.volume * 100)}`;
    fetch('https://ntfy.sh/' + TOPIC + '-status', { method: 'POST', body: txt }).catch(() => { });
    return true;
  };
  window.nortestRadioNow = () => R.on && R.st ? { id: R.st.id || R.st.url || R.st.name, name: R.st.name || '', call: R.st.call || '', logo: R.st.logo || R.st.favicon || '' } : null;
  window.nortestRadio = {
    remote: c => {
      const m = c.match(/^(?:play\s+)?(?:radio|station)(?:\s+(.+))?$/);
      if (m) {
        if (m[1]) { findAndPlay(m[1]); return true; }
        const s = R.st || R.favs[0] || R.recent[0]; if (s) { R.on && R.st ? rPlay() : play(s); return true; }
        return false;
      }
      if (c === 'radio off' || c === 'stop radio') { stop(); return true; }
      if (!R.on) {
        if (c.startsWith('play ') && c.length > 5) {
          const q = c.slice(5);
          if (!songs.some(s => (s.title + ' ' + s.artist).toLowerCase().includes(q))) { findAndPlay(q); return true; }
        }
        return false;
      }
      if (c === 'pause') { _origPause.call(rau); return true; }
      if (c === 'play' || c === 'resume') { rPlay(); return true; }
      if (c === 'next' || c === 'skip') { step(1); return true; }
      if (c === 'prev' || c === 'back') { step(-1); return true; }
      if (c === 'like' || c === 'fav') { if (!isFav(R.st.id)) favToggle(R.st); return true; }
      if (c === 'now' || c === 'status') return status();
      return false;
    },
    play: (s) => play(slim(s)), stop, state: () => ({ on: R.on, station: R.st, paused: rau.paused, wait: !!R.wait }), el: rau, R
  };
})();
