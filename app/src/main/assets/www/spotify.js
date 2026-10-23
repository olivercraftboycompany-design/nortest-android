/* nortest 1.6.4 (1.6.5: song links, YouTube links, recently pasted, pick another version) - Import from Spotify: paste a Spotify playlist (or album) link and Nortest builds the same playlist
   out of songs that are ALREADY in your library. Nothing is downloaded: Spotify only gives the track list (names,
   artists, lengths, cover). Songs that aren't on your phone STREAM inside Nortest through the official YouTube
   embedded player (or Spotify's own embed when YouTube has nothing), so the whole playlist plays straight through.
   Track lists and YouTube video ids come from nortest-spotify.sites.tab.bot (Spotify's public embed page; up to 1000
   tracks). Imported playlists are normal playlists ({id, name, songs}); streaming songs sit in them as "sp:<id>".
   Stored: localStorage nortest_spotify_imports (per imported link: playlist id, cover, track list) and
   nortest_spotify_yt (cached YouTube video ids). */
(() => {
  'use strict';
  const API = 'https://nortest-spotify.sites.tab.bot/api?u=';
  const LSK = 'nortest_spotify_imports', YTK = 'nortest_spotify_yt', LSR = 'nortest_spotify_recent';
  const YTAPI = 'https://nortest-spotify.sites.tab.bot/yt?';
  const SVG_IMPORT = '<path d="M12 3.8v10.4"/><path d="M7.9 10.3l4.1 4.1 4.1-4.1"/><path d="M4.6 15.2v2.4a2.6 2.6 0 0 0 2.6 2.6h9.6a2.6 2.6 0 0 0 2.6-2.6v-2.4"/>';
  const SVG_OUT = '<path d="M13.4 4.6h6v6"/><path d="M19.4 4.6l-8.2 8.2"/><path d="M17.4 13.6v3.8a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2V8.6a2 2 0 0 1 2-2h3.8"/>';
  const SVG_REFRESH = '<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1"/><path d="M19.4 4.6v3.6h-3.6"/>';
  if (window.SFI) { SFI.sp_import ||= SVG_IMPORT; SFI.sp_out ||= SVG_OUT; SFI.sp_refresh ||= SVG_REFRESH; }

  const ls = () => { try { const v = JSON.parse(localStorage.getItem(LSK)); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
  const lsSet = v => { try { localStorage.setItem(LSK, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const T = {};
  const toast = m => {
    try { if (NN && NN.toast) return NN.toast(m); } catch (e) { }
    let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('show'); clearTimeout(T.t); T.t = setTimeout(() => t.classList.remove('show'), 2600);
  };

  /* ---------- matching: Spotify names vs. the songs in the library ---------- */
  const JUNK = /\b(feat|ft|featuring|with|remaster(ed)?|radio edit|edit|version|single|mono|stereo|explicit|clean|deluxe|bonus|official|audio|video|lyrics?|visualizer|hq|hd|prod|from|live|mix|original|extended|remix(ed)?|re-?recorded|taylor's version|sped up|slowed|acoustic|instrumental)\b/i;
  const deacc = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const base = s => deacc(s).toLowerCase().replace(/[\u2018\u2019\u02bc`´]/g, "'").replace(/&/g, ' and ').replace(/\$/g, 's');
  const clean = s => base(s).replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  /* title without (feat. ...), [Remastered 2011], " - Radio Edit", "feat. X" tails and leading track numbers */
  const normT = t => {
    let s = base(t);
    s = s.replace(/\.(mp3|m4a|flac|wav|ogg|opus|aac|wma)$/, '');
    s = s.replace(/^\s*(\d{1,3}[\s.\-_)]+)(?=\D)/, '');
    s = s.replace(/[\(\[\{]([^\)\]\}]*)[\)\]\}]/g, (m, x) => JUNK.test(x) ? ' ' : m);
    s = s.split(/\s+[-\u2013\u2014|]\s+/).filter((part, i) => i === 0 || !JUNK.test(part)).join(' ');
    s = s.replace(/\s(feat|ft|featuring)\.?\s.*$/, '');
    return clean(s);
  };
  const artistsOf = a => base(a).split(/\s*(?:,|&| and | x | feat\.? | ft\.? | featuring | with |;|\/)\s*/).map(clean).filter(x => x && x !== 'unknown artist' && x !== 'various artists');
  const GM = new Map();
  const grams = s0 => { if (GM.has(s0)) return GM.get(s0); if (GM.size > 20000) GM.clear(); const s = s0.replace(/ /g, ''); const g = new Map(); GM.set(s0, g); for (let i = 0; i < s.length - 1; i++) { const k = s.substr(i, 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const dice = (a, b) => {
    if (a === b) return 1; if (!a || !b) return 0;
    if (a.replace(/ /g, '') === b.replace(/ /g, '')) return 1;
    const A = grams(a), B = grams(b); let n = 0, ta = 0, tb = 0;
    for (const v of A.values()) ta += v; for (const v of B.values()) tb += v;
    for (const [k, v] of A) if (B.has(k)) n += Math.min(v, B.get(k));
    return ta + tb ? 2 * n / (ta + tb) : 0;
  };
  /* what a library song can be called: its tag title/artist, plus "Artist - Title" / "Title - Artist" read from the name */
  const libIndex = () => songs.filter(s => typeof okSong !== 'function' || okSong(s)).map(s => {
    const c = [];
    const ar = artistsOf(s.artist), full = clean(s.artist);
    c.push({ t: normT(s.title), ar, full });
    const parts = String(s.title || '').replace(/\.(mp3|m4a|flac|wav|ogg)$/i, '').split(/\s+[-\u2013\u2014]\s+/);
    if (parts.length === 2) {
      c.push({ t: normT(parts[1]), ar: ar.concat(artistsOf(parts[0])), full: full + ' ' + clean(parts[0]) });
      c.push({ t: normT(parts[0]), ar: ar.concat(artistsOf(parts[1])), full: full + ' ' + clean(parts[1]) });
    }
    return { s, c: c.filter(x => x.t) };
  });
  const artistScore = (spA, cand) => {
    if (!spA.length) return 0.5;
    if (!cand.ar.length && !cand.full) return 0.4;
    let best = 0;
    for (const a of spA) {
      if (!a) continue;
      if (cand.full && (' ' + cand.full + ' ').includes(' ' + a + ' ')) return 1;
      for (const b of cand.ar) best = Math.max(best, dice(a, b));
    }
    return best;
  };
  const matchOne = (tr, idx, byTitle) => {
    const tt = normT(tr.t), spA = artistsOf(tr.a);
    if (!tt) return null;
    let best = null, bs = 0;
    const consider = (e, cand) => {
      const ts = cand.t === tt ? 1 : dice(tt, cand.t);
      if (ts < 0.78) return;
      const as = artistScore(spA, cand);
      let sc = ts * 0.68 + as * 0.32;
      if (as < 0.45 && !(ts === 1 && (!cand.ar.length))) sc -= 0.25;
      if (tr.d && e.s.dur && Math.abs(tr.d - e.s.dur) > 45) sc -= 0.06;
      if (sc > bs) { bs = sc; best = e.s; }
    };
    for (const e of byTitle.get(tt) || []) for (const cand of e.c) if (cand.t === tt) consider(e, cand);
    if (bs < 0.9) { const w = tt.split(' ').filter(x => x.length > 2); for (const e of idx) for (const cand of e.c) { if (Math.abs(cand.t.length - tt.length) > Math.max(6, tt.length * 0.4)) continue; if (w.length && tt.length > 5 && !w.some(x => cand.t.includes(x.slice(0, 4)))) continue; consider(e, cand); } }
    return bs >= 0.74 ? best : null;
  };
  const matchAll = tracks => {
    const idx = libIndex(), byTitle = new Map();
    for (const e of idx) for (const c of e.c) { if (!byTitle.has(c.t)) byTitle.set(c.t, []); byTitle.get(c.t).push(e); }
    return tracks.map(tr => { const s = matchOne(tr, idx, byTitle); return s ? s.id : null; });
  };

  /* ---------- reading a link or a pasted list ---------- */
  const parsePaste = txt => String(txt || '').split(/\r?\n/).map(l => l.replace(/^\s*(\d{1,3}[.)\-:]?\s+|[-*\u2022]\s+)/, '').trim()).filter(Boolean).map(l => {
    let m = l.split(/\s+[-\u2013\u2014]\s+/);
    if (m.length >= 2) return { t: m[0].trim(), a: m.slice(1).join(' - ').trim(), alt: true };
    m = l.split(/\s+by\s+/i);
    if (m.length === 2) return { t: m[0].trim(), a: m[1].trim() };
    return { t: l, a: '' };
  }).slice(0, 1000);
  /* "Song - Artist" and "Artist - Song" both happen; try the other order when the first one finds nothing */
  const matchPaste = tracks => {
    const ids = matchAll(tracks);
    const swap = tracks.map((t, i) => (!ids[i] && t.alt) ? { t: t.a, a: t.t, d: 0 } : null);
    const need = swap.map((x, i) => x ? i : -1).filter(i => i >= 0);
    if (need.length) { const r = matchAll(need.map(i => swap[i])); need.forEach((i, k) => { if (r[k]) { ids[i] = r[k]; const t = tracks[i]; tracks[i] = { t: t.a, a: t.t }; } }); }
    return ids;
  };
  const fetchList = async link => {
    let r;
    try { r = await fetch(API + encodeURIComponent(link), { cache: 'no-store' }); }
    catch (e) { throw new Error('No connection. Check your internet and try again.'); }
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!j || !j.ok) throw new Error((j && j.error) || 'Could not read that playlist right now.');
    return j;
  };
  const shrinkCover = async url => {
    if (!url) return '';
    try {
      const im = new Image(); im.crossOrigin = 'anonymous';
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; setTimeout(rej, 8000); });
      const c = document.createElement('canvas'); c.width = c.height = 300;
      c.getContext('2d').drawImage(im, 0, 0, 300, 300);
      return c.toDataURL('image/jpeg', 0.78);
    } catch (e) { return url; }
  };

  /* ---------- state ---------- */
  let RV = null; /* the review screen: {key, name, owner, cover, url, type, tracks, ids, total, capped, partial, src} */
  const keyOf = j => j.type === 'paste' ? 'paste:' + j.pid : j.type + ':' + j.id;
  const existing = key => { const e = ls()[key]; return e && pls.find(p => p.id === e.pl) ? e : null; };
  const impFor = pid => { const all = ls(); for (const k in all) if (all[k] && all[k].pl === pid) return [k, all[k]]; return null; };
  window.spCover = p => { const x = p && impFor(p.id); return x && x[1].cover ? x[1].cover : ''; };

  const ytURL = t => 'https://www.youtube.com/results?search_query=' + encodeURIComponent((t.t + ' ' + (t.a || '')).trim());
  const spURL = t => t.id ? 'https://open.spotify.com/track/' + t.id : 'https://open.spotify.com/search/' + encodeURIComponent((t.t + ' ' + (t.a || '')).trim());
  const hsh = x => { let h = 0; for (const c of x) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
  const sidOf = t => 'sp:' + (t.yt ? 'y' + t.yt : t.id || 'x' + hsh(clean(t.t) + '|' + clean(t.a)));

  /* streaming songs: song-shaped objects the player can queue (byId finds them), never stored as songs */
  const REG = new Map();
  let YTC = (() => { try { const v = JSON.parse(localStorage.getItem(YTK)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } })();
  const ytArt = sid => { const v = YTC[sid]; return v && v[0] ? 'https://i.ytimg.com/vi/' + v[0] + '/mqdefault.jpg' : ''; };
  const reg = (t, meta) => {
    const id = sidOf(t);
    let s = REG.get(id);
    if (!s) { s = { id, title: t.t, artist: t.a || 'Unknown Artist', album: meta.type === 'track' || meta.type === 'yt' ? '' : meta.name || 'Spotify', dur: t.d || 0, stream: true, spid: t.id || '', art: '', cover: null, fav: false, lyrics: '', added: 0, _pc: '' }; REG.set(id, s); }
    if (t.yt && !(YTC[id] && YTC[id].length)) YTC[id] = [t.yt];
    s.art = ytArt(id) || (meta.type === 'track' && meta.cover) || phFor(s);
    return s;
  };
  const regAll = () => { const all = ls(); for (const k in all) { const e = all[k]; if (!e || !e.tracks) continue; e.tracks.forEach((t, i) => { if (!(e.ids && e.ids[i])) reg(t, e); }); } };
  window.spSong = id => typeof id === 'string' && id.startsWith('sp:') ? REG.get(id) : undefined;
  const isSp = id => typeof id === 'string' && id.startsWith('sp:');
  const STAG = '<small class="ph spst" title="Streams from YouTube">streaming</small>';
  const links = t => `<div class="spl"><a class="btn sm text" href="${esc(spURL(t))}" target="_blank" rel="noopener" aria-label="Open ${esc(t.t)} in Spotify">Spotify</a><a class="btn sm text" href="${esc(ytURL(t))}" target="_blank" rel="noopener" aria-label="Search ${esc(t.t)} on YouTube">YouTube</a></div>`;
  const streamRow = t => { const s = REG.get(sidOf(t)); return `<div class="row spstr ${cur && s && cur.id === s.id ? 'now' : ''}" data-a="sprp" data-id="${esc(sidOf(t))}"><img src="${esc(s ? s.art : PH)}" alt="" loading="lazy"><div class="rm"><b>${esc(t.t)}</b><span>${STAG}${esc(t.a || '')}</span></div>${links(t)}</div>`; };
  const hitRow = (id, t) => { const s = byId(id); if (!s) return ''; const diff = !normT(s.title).includes(normT(t.t)); return `<div class="row sphit ${cur && cur.id === s.id ? 'now' : ''}" data-a="sprp" data-id="${s.id}"><img src="${cover(s)}" alt="" loading="lazy"><div class="rm"><b>${esc(s.title)}</b><span>${esc(s.artist)}${diff ? ' · <i>Spotify: ' + esc(t.t) + '</i>' : ''}</span></div><span class="spok" aria-label="On your phone">${mi('check')}</span></div>`; };
  const tag = h => h.replace(/(data-id="sp:[^"]+"[^>]*>[\s\S]*?<div class="rm"><b>[\s\S]*?<\/b><span>)/g, '$1' + STAG);

  /* ---------- look: existing cards, rows, buttons and sheet; only a few small additions ---------- */
  const st = document.createElement('style');
  st.textContent = `
.card.new.spnew .plus{background:var(--md-surface-container-high);color:var(--md-on-surface)}
.card.new.spnew .plus .msi{width:40px;height:40px}
.sph{margin:2px 0 6px;color:var(--md-on-surface-variant);font-size:14px;line-height:20px}
.spin label{display:block;font-size:13px;font-weight:600;color:var(--md-on-surface-variant);margin:14px 2px 6px}
.spin textarea{min-height:150px;font-size:14px;line-height:20px}
.spin .sperr{min-height:20px;margin:10px 2px 0;font-size:13px;color:var(--md-error,#ffb4ab)}
.spin .spsw{display:inline-block;margin-top:12px;padding:0 2px;background:none;border:0;color:var(--md-primary);font-size:14px;font-weight:600;cursor:pointer}
.spin .btn[disabled]{opacity:.55;pointer-events:none}
.spbar{height:4px;border-radius:2px;margin:14px 0 2px;overflow:hidden;background:var(--lg-hair,rgba(255,255,255,.1))}
.spbar i{display:block;height:100%;background:var(--lg-acc,var(--md-primary));border-radius:2px}
.spsum{display:flex;align-items:baseline;gap:8px;margin:6px 4px 0;font-size:14px;color:var(--md-on-surface-variant)}
.spsum b{font-size:15px;color:var(--md-on-surface)}
.spnote{margin:8px 4px 0;font-size:13px;line-height:18px;color:var(--md-on-surface-variant)}
.phead.spp img{clip-path:none;border-radius:20px}
.sphit .rm{flex:1;min-width:0}
.sphit .rm b,.sphit .rm span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.sphit .rm i{font-style:normal;opacity:.75}
.spok{flex:none;display:grid;place-items:center;width:36px;color:var(--lg-acc,var(--md-primary))}
.spok .msi{width:20px;height:20px}
.spstr .rm{flex:1;min-width:0}
.spstr .rm b,.spstr .rm span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row .ph.spst{background:var(--lg-hair,rgba(255,255,255,.1));color:var(--md-on-surface-variant)}
.artw{position:relative}
#spv{display:none;position:absolute;left:50%;top:50%;width:min(100cqw,100cqh);height:min(100cqw,100cqh);transform:translate(-50%,-50%);border-radius:28px;overflow:hidden;background:#000}
body.sp-on #spv{display:block}
body.sp-on #bArt{visibility:hidden}
#spvy,#spv iframe{position:absolute;left:0;top:50%;width:100%!important;height:56.25%!important;transform:translateY(-50%);border:0}
#spvs{display:none;position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:152px}
#spv.sp #spvs{display:block}#spv.sp #spvy,#spv.sp iframe#spvy{display:none}
#spvs iframe{position:static;width:100%!important;height:152px!important;transform:none;border-radius:12px}
#spv .sphint{position:absolute;left:12px;right:12px;bottom:12px;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;text-align:center;pointer-events:none}
#spv .sphint[hidden]{display:none}
#spv .spsrc{position:absolute;left:12px;top:10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.7)}
.spl{flex:none;display:flex;flex-direction:column;gap:2px;align-items:flex-end}
#view .spl a.btn.sm{height:26px;padding:0 10px;font-size:12px;border-radius:13px;text-decoration:none;color:var(--md-on-surface-variant);font-weight:600;background:transparent}
.spacts{margin-top:4px}
.spsec{display:flex;align-items:baseline;justify-content:space-between}
#mb .sprec{margin-top:14px}
#mb .sprec .sprh{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;color:var(--md-on-surface-variant);margin:0 2px 6px}
#mb .sprec .sprh button{background:none;border:0;color:var(--md-primary);font-weight:600;font-size:13px;cursor:pointer;padding:4px}
#mb .sprl{display:grid;gap:2px;max-height:180px;overflow:auto;border-radius:14px}
#mb .sprl button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:4px;background:var(--lg-hair,rgba(255,255,255,.06));color:inherit;text-align:left;cursor:pointer}
#mb .sprl img{width:36px;height:36px;border-radius:8px;object-fit:cover;flex:none;background:#3a3f4a}
#mb .sprl span{flex:1;min-width:0}#mb .sprl b,#mb .sprl small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#mb .sprl b{font-size:14px;font-weight:600}#mb .sprl small{font-size:12px;color:var(--md-on-surface-variant)}
.spone{display:flex;gap:14px;align-items:center;margin:12px 0 4px}
.spone img{width:72px;height:72px;border-radius:14px;object-fit:cover;flex:none;background:#3a3f4a}
.spone b{display:block;font-size:17px;font-weight:600;line-height:22px}.spone span{display:block;color:var(--md-on-surface-variant);font-size:14px}
.spone .ph{display:inline-block;margin-top:6px}
.spver button{display:flex;align-items:center;gap:10px;text-align:left;height:auto;min-height:52px;padding:8px 12px;justify-content:flex-start;border-radius:14px}
.spver img{width:64px;height:36px;border-radius:6px;object-fit:cover;flex:none}
.spver span{flex:1;min-width:0;font-weight:500}.spver small{display:block;opacity:.7;font-size:12px}
.spsec small{font-size:13px;font-weight:500;color:var(--md-on-surface-variant);margin-right:6px}
`;
  document.head.appendChild(st);

  /* ---------- recently pasted ---------- */
  const recent = () => { try { const v = JSON.parse(localStorage.getItem(LSR)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const addRecent = (j, u) => { const r = recent().filter(x => x.u !== u && x.k !== j.type + ':' + j.id); r.unshift({ u, k: j.type + ':' + j.id, n: j.name, s: j.type === 'yt' ? 'YouTube song' + (j.owner ? ' · ' + j.owner : '') : j.type === 'track' ? 'Song · ' + j.owner : (j.type === 'album' ? 'Album' : 'Playlist') + ' · ' + nS(j.count || 0), c: j.cover || '', at: Date.now() }); try { localStorage.setItem(LSR, JSON.stringify(r.slice(0, 8))); } catch (e) { } };
  const recentHTML = () => { const r = recent(); return r.length ? `<div class="sprec"><div class="sprh"><span>Recently pasted</span><button data-a="sprclr">Clear</button></div><div class="sprl">${r.map(x => `<button data-a="sprecent" data-u="${esc(x.u)}"><img src="${esc(x.c || PH)}" alt=""><span><b>${esc(x.n)}</b><small>${esc(x.s)}</small></span></button>`).join('')}</div></div>` : ''; };
  /* ---------- one song (a Spotify song or a YouTube / YouTube Music link) ---------- */
  const oneSheet = j => {
    const t = j.tracks[0]; if (!t) return;
    const local = matchAll([t])[0];
    let id = local;
    if (!id) {
      const key = 'single:' + sidOf(t), all = ls();
      all[key] = { pl: null, name: j.name, type: j.type, url: j.url, cover: j.cover || '', at: Date.now(), total: 1, tracks: [{ t: t.t, a: t.a, d: t.d || 0, id: t.id || '', yt: t.yt || '' }], ids: [null] };
      lsSet(all); id = reg(t, all[key]).id;
    }
    const s = byId(id);
    mod(`<div class="spin"><h3>Song</h3><div class="spone"><img src="${esc(local ? cover(s) : (j.cover || s.art))}" alt=""><div><b>${esc(s.title)}</b><span>${esc(s.artist)}</span>${local ? '<small class="ph">on your phone</small>' : STAG}</div></div>
<div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn tonal" data-a="sponeadd" data-id="${esc(id)}">Add to playlist</button><button class="btn pri" data-a="sponeplay" data-id="${esc(id)}">${mi('play_arrow', 1)}Play now</button></div></div>`);
  };
  /* ---------- screens ---------- */
  const sheet = (mode, val, err) => mod(`<div class="spin"><h3>Paste a playlist or song</h3>
<p class="sph">${mode === 'paste' ? 'Paste one song per line, like <b>Song - Artist</b>.' : 'Paste a Spotify playlist, album or song, or a YouTube song. Songs on your phone play from your phone, the rest stream.'}</p>
${mode === 'paste' ? `<label for="spn">Playlist name</label><input id="spn" type="text" placeholder="Playlist name" value="${esc((val && val.name) || '')}"><label for="spt">Songs</label><textarea id="spt" placeholder="Blinding Lights - The Weeknd&#10;Levitating - Dua Lipa">${esc((val && val.text) || '')}</textarea>`
      : `<label for="spu">Playlist or song link</label><input id="spu" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://open.spotify.com/playlist/..." value="${esc(val || '')}">${recentHTML()}`}
<div class="sperr" role="status">${esc(err || '')}</div>
<button class="spsw" data-a="spsw" data-m="${mode === 'paste' ? 'link' : 'paste'}">${mode === 'paste' ? 'Use a Spotify link instead' : 'No link? Paste a song list instead'}</button>
<div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn pri" data-a="${mode === 'paste' ? 'sppaste' : 'spgo'}">${mode === 'paste' ? 'Match songs' : 'Import'}</button></div></div>`);

  const reviewHTML = () => {
    const r = RV, n = r.tracks.length, hit = r.ids.filter(Boolean).length, str = n - hit, ex = existing(r.key);
    const pct = n ? Math.round(hit / n * 100) : 0;
    const rows = r.tracks.map((t, i) => r.ids[i] ? hitRow(r.ids[i], t) : streamRow(t)).join('');
    const note = r.capped ? `<p class="spnote">This playlist has ${r.total} songs. Nortest reads the first ${n}.</p>` : r.partial ? `<p class="spnote">Spotify only sent the first ${n} songs this time. Import again later to get the rest.</p>` : '';
    return `<div class="dhead"><button class="ib" data-a="spback" aria-label="Back">${mi('keyboard_arrow_down')}</button></div>
<div class="phead spp"><img src="${esc(r.cover || PH)}" alt=""><div><small>${r.type === 'album' ? 'Spotify album' : r.type === 'paste' ? 'Pasted list' : 'Spotify playlist'}</small><h2>${esc(r.name)}</h2><span>${esc(r.owner ? r.owner + ' · ' : '')}${nS(n)}</span>
<div class="spbar"><i style="width:${pct}%"></i></div><div class="spsum"><b>${hit} of ${n}</b> on your phone${str ? ' · ' + str + ' will stream' : ''}</div>
<div class="acts spacts"><button class="btn pri" data-a="spsave">${mi('playlist_add')}${ex ? 'Update playlist' : 'Save playlist'}</button><button class="btn tonal" data-a="spplay">${mi('play_arrow', 1)}Play</button></div></div></div>${note}
<div class="lst">${rows}</div>`;
  };

  /* imported playlist page: the normal playlist page (streaming songs tagged) plus "Update from Spotify" */
  const extraParts = p => {
    const x = impFor(p.id); if (!x) return null;
    const [k, e] = x;
    return { chips: `<div class="chips"><button class="chip" data-a="spupd" data-k="${esc(k)}">${mi('sp_refresh')}${k.startsWith('paste:') ? 'Match again' : 'Update from Spotify'}</button>${e.url ? `<a class="chip" href="${esc(e.url)}" target="_blank" rel="noopener" style="text-decoration:none">${mi('sp_out')}Open in Spotify</a>` : ''}</div>` };
  };

  const _pHTML = window.pHTML;
  window.pHTML = function () {
    if (RV && view === 'playlists') return reviewHTML();
    const p = cp();
    let h = _pHTML.apply(this, arguments);
    if (p) {
      h = tag(h);
      const x = extraParts(p);
      if (!x) return h;
      const i = h.indexOf('</div></div></div>');
      return i >= 0 ? h.slice(0, i + 18) + x.chips + h.slice(i + 18) : x.chips + h;
    }
    return h.replace(/(<div class="card new" data-a="pnew">[\s\S]*?<b>New playlist<\/b><span>&nbsp;<\/span><\/div>)/, `$1<div class="card new spnew" data-a="spopen"><div class="plus">${mi('sp_import')}</div><b>Import from Spotify</b><span>or a YouTube song</span></div>`);
  };

  const busy = (b, on, label) => { if (!b) return; if (on) { b.dataset.l = b.innerHTML; b.disabled = true; b.textContent = label; } else { b.disabled = false; if (b.dataset.l) b.innerHTML = b.dataset.l; } };
  const openReview = r => { r.tracks.forEach((t, i) => { if (!r.ids[i]) reg(t, r); }); RV = r; view = 'playlists'; sub = 'spimport'; closeMod(); render(); $('#view').scrollTop = 0; };
  const errIn = m => { const e = document.querySelector('.spin .sperr'); if (e) e.textContent = m; else toast(m); };
  const listIds = r => [...new Set(r.tracks.map((t, i) => r.ids[i] || sidOf(t)))];

  const saveImport = async r => {
    const all = ls(), ex = existing(r.key);
    const songsOut = listIds(r);
    let p = ex ? pls.find(q => q.id === ex.pl) : null;
    if (p) { p.songs = songsOut; await put('playlists', p); }
    else { p = { id: crypto.randomUUID(), name: r.name || 'Spotify playlist', songs: songsOut }; pls.push(p); await put('playlists', p); }
    const cov = r.cover && r.cover.startsWith('data:') ? r.cover : await shrinkCover(r.cover) || (ex && ex.cover) || '';
    all[r.key] = { pl: p.id, name: r.name, type: r.type, url: r.url || '', cover: cov, at: Date.now(), total: r.total || r.tracks.length, tracks: r.tracks.map(t => ({ t: t.t, a: t.a, d: t.d || 0, id: t.id || '' })), ids: r.ids, src: r.src || '' };
    if (!lsSet(all)) { all[r.key].cover = ''; lsSet(all); }
    r.tracks.forEach((t, i) => { if (!r.ids[i]) reg(t, all[r.key]); });
    return { p, updated: !!ex };
  };

  Object.assign(A, {
    spopen: () => sheet('link', ''),
    spsw: b => sheet(b.dataset.m === 'paste' ? 'paste' : 'link'),
    spgo: async b => {
      const v = ($('#spu') || {}).value || '';
      if (!v.trim()) return errIn('Paste a link first.');
      busy(b, true, 'Reading playlist...'); errIn('');
      try {
        const j = await fetchList(v.trim());
        addRecent(j, v.trim());
        if (j.type === 'track' || j.type === 'yt') return oneSheet(j);
        busy(b, true, 'Matching songs...');
        await new Promise(r => setTimeout(r, 30));
        const tracks = j.tracks || [];
        openReview({ key: keyOf(j), name: j.name, owner: j.type === 'album' ? j.owner : (j.owner && j.owner !== 'Spotify' ? 'by ' + j.owner : j.owner), cover: j.cover, url: j.url, type: j.type, tracks, ids: matchAll(tracks), total: j.total, capped: j.capped, partial: j.partial, src: v.trim() });
      } catch (e) { busy(b, false); errIn(e.message || 'Could not read that playlist.'); }
    },
    sppaste: () => {
      const name = (($('#spn') || {}).value || '').trim() || 'Pasted playlist', text = ($('#spt') || {}).value || '';
      const tracks = parsePaste(text);
      if (!tracks.length) return errIn('Paste at least one song.');
      const all = ls(); let k = null;
      for (const kk in all) if (kk.startsWith('paste:') && all[kk].name === name && existing(kk)) k = kk;
      const ids = matchPaste(tracks);
      openReview({ key: k || 'paste:' + crypto.randomUUID().slice(0, 8), name, owner: '', cover: '', url: '', type: 'paste', tracks, ids, total: tracks.length });
    },
    spback: () => { RV = null; sub = null; render(); $('#view').scrollTop = 0; },
    sprp: (b, id, e) => { if (e && e.target.closest('a')) return; if (!RV) return; playList(listIds(RV), id); },
    spplay: () => { if (RV) playList(listIds(RV)); },
    spsave: async b => {
      if (!RV) return; busy(b, true, 'Saving...');
      try {
        const { p, updated } = await saveImport(RV);
        RV = null; sub = p.id; render(); $('#view').scrollTop = 0;
        toast(updated ? 'Playlist updated' : 'Playlist saved');
      } catch (e) { busy(b, false); toast('Could not save the playlist'); }
    },
    spupd: async b => {
      const k = b.dataset.k, e = ls()[k]; if (!e) return;
      const done = (ids, n) => { render(); toast(ids.filter(Boolean).length + ' of ' + n + ' on your phone, the rest stream'); };
      if (k.startsWith('paste:')) {
        const tracks = e.tracks || []; const ids = matchAll(tracks);
        await saveImport({ key: k, name: e.name, type: 'paste', url: '', cover: e.cover, tracks, ids, total: tracks.length });
        return done(ids, tracks.length);
      }
      busy(b, true, 'Updating...');
      try {
        const j = await fetchList(e.url || e.src);
        const tracks = j.tracks || [], ids = matchAll(tracks);
        await saveImport({ key: k, name: j.name, type: j.type, url: j.url, cover: j.cover, tracks, ids, total: j.total, capped: j.capped, src: e.src });
        done(ids, tracks.length);
      } catch (x) { busy(b, false); toast(x.message || 'Could not update'); }
    },
    sprecent: b => { const i = $('#spu'); if (i) { i.value = b.dataset.u; A.spgo(document.querySelector('[data-a="spgo"]')); } },
    sprclr: () => { try { localStorage.removeItem(LSR); } catch (e) { } const r = document.querySelector('#mb .sprec'); if (r) r.remove(); },
    sponeplay: (b, id) => { id = b.dataset.id; closeMod(); if (!queue.length || qi < 0) return playList([id]); queue.splice(qi + 1, 0, id); load(qi + 1); },
    sponeadd: (b) => A.topl(b, b.dataset.id),
    spver: async (b, id) => {
      id = b.dataset.id || id; const s = REG.get(id); $('#menu').classList.add('hid'); if (!s) return;
      mod(`<div class="spin"><h3>Wrong song?</h3><p class="sph">Pick the right version of <b>${esc(s.title)}</b>. Nortest remembers your pick.</p><div class="mlist spver"><p class="sph">Looking on YouTube...</p></div><div class="mrow"><button class="btn" data-a="mx">Cancel</button></div></div>`);
      try {
        const r = await fetch(YTAPI + new URLSearchParams({ t: s.title, a: s.artist === 'Unknown Artist' ? '' : s.artist, d: String(s.dur || 0), n: '1' }));
        const j = await r.json(); const v = (j && j.videos) || [];
        const cur0 = (YTC[id] || [])[0];
        const box = document.querySelector('#mb .spver'); if (!box) return;
        box.innerHTML = v.length ? v.map(x => `<button class="btn wide ${x.id === cur0 ? 'pri' : ''}" data-a="spuse" data-v="${esc(x.id)}" data-id="${esc(id)}"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" alt=""><span>${esc(x.title)}<small>${esc(x.owner || '')}${x.len ? ' · ' + fmt(x.len) : ''}</small></span></button>`).join('') : '<p class="sph">No other versions found.</p>';
      } catch (e) { const box = document.querySelector('#mb .spver'); if (box) box.innerHTML = '<p class="sph">Can\'t reach YouTube right now.</p>'; }
    },
    spuse: b => {
      const id = b.dataset.id, vid = b.dataset.v, s = REG.get(id); if (!s) return;
      YTC[id] = [vid, ...(YTC[id] || []).filter(x => x !== vid)]; ytSave();
      s.art = 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg';
      closeMod(); toast('Got it. That version plays from now on');
      if (live() && cur.id === id) { SM.cand = YTC[id]; SM.ci = 0; if (window.YT && YT.Player) ytLoad(vid, true, SM.tok); else sPlay(cur, true); }
      else render();
    },
    spopenx: b => { const s = REG.get(b.dataset.id); $('#menu').classList.add('hid'); if (s) window.open(b.dataset.w === 'yt' ? ytURL({ t: s.title, a: s.artist === 'Unknown Artist' ? '' : s.artist }) : spURL({ t: s.title, a: s.artist, id: s.spid }), '_blank', 'noopener'); }
  });

  /* ================= streaming player (YouTube embed, Spotify embed as fallback) ================= */
  const SM = { on: false, s: null, yt: null, ytP: null, spP: null, spc: null, el: null, playing: false, cand: [], ci: 0, tok: 0, t: 0, d: 0, mode: '', poll: 0, hint: 0, bad: 0, badAt: 0, spWas: false, loaded: '' };
  const live = () => SM.on && cur && cur.stream;
  window.spNow = () => SM.on && cur && cur.stream ? { id: cur.id, title: cur.title, artist: cur.artist, pos: SM.t || 0, dur: SM.d || 0, playing: !!SM.playing } : null;
  window.spCtl = { play: p => { try { p ? sResume() : sPause(); } catch (e) { } }, seek: t => { try { sSeek(t); } catch (e) { } } };
  const _origPause = HTMLMediaElement.prototype.pause;
  const ytSave = () => { const k = Object.keys(YTC); if (k.length > 3000) k.slice(0, k.length - 3000).forEach(x => delete YTC[x]); try { localStorage.setItem(YTK, JSON.stringify(YTC)); } catch (e) { } };
  const ensureEl = () => {
    if (SM.el && document.body.contains(SM.el)) return SM.el;
    const host = document.querySelector('#big .artw'); if (!host) return null;
    const w = document.createElement('div'); w.id = 'spv';
    w.innerHTML = '<div id="spvy"></div><div id="spvs"><div id="spvsi"></div></div><span class="spsrc"></span><div class="sphint" hidden>Tap the video to start</div>';
    host.appendChild(w); SM.el = w; return w;
  };
  const loadScript = (src, flag, ready) => new Promise((res, rej) => {
    if (ready()) return res();
    const s = document.createElement('script'); s.src = src; s.async = true; s.onerror = () => rej(new Error(flag));
    document.head.appendChild(s); setTimeout(() => rej(new Error(flag + ' timeout')), 15000);
    SM['_' + flag] = res;
  });
  const loadYT = () => SM.ytP ||= new Promise((res, rej) => {
    if (window.YT && YT.Player) return res();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev && prev(); } catch (e) { } res(); };
    loadScript('https://www.youtube.com/iframe_api', 'yt', () => false).catch(e => { SM.ytP = null; rej(e); });
  });
  const loadSP = () => SM.spP ||= new Promise((res, rej) => {
    const prev = window.onSpotifyIframeApiReady;
    window.onSpotifyIframeApiReady = api => { try { prev && prev(api); } catch (e) { } res(api); };
    loadScript('https://open.spotify.com/embed/iframe-api/v1', 'sp', () => false).catch(e => { SM.spP = null; rej(e); });
  });
  const vidsFor = async s => {
    if (YTC[s.id] && YTC[s.id].length) return YTC[s.id];
    const r = await fetch(YTAPI + new URLSearchParams({ t: s.title, a: s.artist === 'Unknown Artist' ? '' : s.artist, d: String(s.dur || 0) }));
    const j = await r.json().catch(() => null);
    const v = ((j && j.videos) || []).map(x => x.id);
    if (v.length) { YTC[s.id] = v; ytSave(); }
    return v;
  };
  const setSrc = t => { const e = SM.el && SM.el.querySelector('.spsrc'); if (e) e.textContent = t; };
  const showHint = on => { const e = SM.el && SM.el.querySelector('.sphint'); if (e) e.hidden = !on; };
  const paint = () => {
    if (!live()) return;
    const d = SM.d || cur.dur || 0, t = Math.min(SM.t || 0, d || Infinity), pc = d ? t / d * 100 : 0;
    const sk = $('#seek'); if (sk && document.activeElement !== sk) sk.value = pc;
    const k = $('.sk'); if (k) k.style.setProperty('--p', pc + '%');
    const mp = $('#mProg i'); if (mp) mp.style.width = pc + '%';
    const c = $('#cur'), du = $('#dur'); if (c) c.textContent = fmt(t); if (du) du.textContent = fmt(d);
    try { if ('mediaSession' in navigator && d) navigator.mediaSession.setPositionState({ duration: d, position: Math.max(0, Math.min(t, d)), playbackRate: 1 }); } catch (e) { }
  };
  const tick = () => {
    clearInterval(SM.poll);
    SM.poll = setInterval(() => {
      if (!live()) return;
      if (SM.mode === 'yt' && SM.yt && SM.yt.getCurrentTime) { try { SM.t = SM.yt.getCurrentTime() || 0; SM.d = SM.yt.getDuration() || SM.d; } catch (e) { } }
      paint();
    }, 500);
  };
  /* keep the screen on while a streaming song plays: the embedded player stops when the phone locks */
  let wl = null;
  const wake = on => { try { if (on && !wl && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wl = l; l.addEventListener('release', () => { wl = null; }); }).catch(() => { }); else if (!on && wl) { wl.release().catch(() => { }); wl = null; } } catch (e) { } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live() && SM.playing) wake(true); });
  const setPlaying = p => { wake(p && live()); if (SM.playing === p) return; SM.playing = p; pi(); };
  const quietAu = () => {
    try { _origPause.call(au); } catch (e) { }
    if (au.getAttribute('src')) { const old = url; au.removeAttribute('src'); try { au.load(); } catch (e) { } if (old && old.startsWith('blob:')) URL.revokeObjectURL(old); url = ''; }
  };
  const msHandlers = on => {
    if (!('mediaSession' in navigator)) return;
    const h = on
      ? [['play', () => sResume()], ['pause', () => sPause()], ['stop', () => sPause()], ['nexttrack', () => next()], ['previoustrack', () => A.prev()],
      ['seekbackward', d => sSeek(SM.t - ((d && d.seekOffset) || 10))], ['seekforward', d => sSeek(SM.t + ((d && d.seekOffset) || 10))], ['seekto', d => sSeek(d.seekTime)]]
      : [['play', start], ['pause', () => au.pause()], ['nexttrack', next], ['previoustrack', prev],
      ['seekbackward', d => seekBy(-((d && d.seekOffset) || 10))], ['seekforward', d => seekBy((d && d.seekOffset) || 10)],
      ['seekto', d => { if (d.fastSeek && 'fastSeek' in au) au.fastSeek(d.seekTime); else au.currentTime = d.seekTime; posState(); }],
      ['stop', () => { au.pause(); au.currentTime = 0; posState(); }]];
    h.forEach(([a, f]) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { } });
  };
  const failed = (s, why) => {
    if (!live() || SM.s !== s) return;
    SM.bad = Date.now() - SM.badAt < 8000 ? SM.bad + 1 : 1; SM.badAt = Date.now();
    setPlaying(false);
    if (queue.length > 1 && SM.bad < 5) { toast("Couldn't stream " + s.title + ', skipping'); setTimeout(() => { if (cur === s) next(); }, 700); }
    else toast("Couldn't stream " + s.title);
  };
  const armHint = tok => {
    clearTimeout(SM.hint);
    SM.hint = setTimeout(() => {
      if (tok !== SM.tok || !live() || SM.playing || SM.mode !== 'yt') return;
      let st = -1; try { st = SM.yt.getPlayerState(); } catch (e) { }
      if (st !== 1 && st !== 3) { showHint(true); if ($('#big').classList.contains('hid') || !document.body.classList.contains('big')) toast('Open the player and tap the video to start'); }
    }, 4000);
  };
  const ytLoad = (vid, play, tok) => {
    SM.mode = 'yt'; SM.loaded = SM.s.id; SM.el.classList.remove('sp'); setSrc('YouTube'); showHint(false);
    const s = SM.s; s.art = 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg';
    try { $('#mArt').src = s.art; } catch (e) { }
    media();
    if (!SM.yt) {
      SM.yt = new YT.Player('spvy', {
        width: '100%', height: '100%', videoId: vid,
        playerVars: { playsinline: 1, autoplay: play ? 1 : 0, rel: 0, modestbranding: 1, controls: 1, origin: location.origin },
        events: {
          onReady: e => { try { e.target.setVolume(Math.round((au.muted ? 0 : au.volume) * 100)); if (SM.mode === 'yt' && live() && play) e.target.playVideo(); } catch (x) { } },
          onStateChange: e => {
            if (SM.mode !== 'yt' || !live()) return;
            if (e.data === 1) { setPlaying(true); showHint(false); SM.bad = 0; const v = YTC[SM.s.id]; if (v && SM.ci > 0) { const id = SM.cand[SM.ci]; YTC[SM.s.id] = [id, ...v.filter(x => x !== id)]; ytSave(); SM.ci = 0; SM.cand = YTC[SM.s.id]; } }
            else if (e.data === 2) setPlaying(false);
            else if (e.data === 0) { setPlaying(false); ended(); }
          },
          onError: e => { SM.lastErr = e && e.data; if (SM.mode !== 'yt' || !live()) return; nextCand(); }
        }
      });
    } else { try { play ? SM.yt.loadVideoById(vid) : SM.yt.cueVideoById(vid); } catch (e) { } }
    if (play) armHint(tok);
  };
  const nextCand = () => {
    const s = SM.s, tok = SM.tok;
    SM.ci++;
    if (SM.ci < SM.cand.length) return ytLoad(SM.cand[SM.ci], true, tok);
    spFallback(s, tok, true);
  };
  const spFallback = async (s, tok, play) => {
    if (!s.spid) return failed(s, 'none');
    try { if (SM.yt) SM.yt.pauseVideo(); } catch (e) { }
    let api; try { api = await loadSP(); } catch (e) { return failed(s, 'spapi'); }
    if (tok !== SM.tok) return;
    SM.mode = 'sp'; SM.loaded = s.id; SM.el.classList.add('sp'); setSrc('Spotify preview'); showHint(false); SM.spWas = false;
    const uri = 'spotify:track:' + s.spid;
    const go = c => { try { c.loadUri(uri); if (play) setTimeout(() => { try { c.play(); } catch (e) { } }, 400); } catch (e) { failed(s, 'sp'); } };
    if (SM.spc) return go(SM.spc);
    api.createController(document.getElementById('spvsi'), { uri, width: '100%', height: 152 }, c => {
      SM.spc = c;
      c.addListener('playback_update', e => {
        if (SM.mode !== 'sp' || !live()) return;
        const d = e.data || {}; SM.t = (d.position || 0) / 1000; if (d.duration) SM.d = d.duration / 1000;
        if (!d.isPaused) SM.spWas = true;
        setPlaying(!d.isPaused); paint();
        if (d.isPaused && SM.spWas && d.duration && d.position >= d.duration - 1200) { SM.spWas = false; ended(); }
      });
      if (play) setTimeout(() => { try { c.play(); } catch (e) { } }, 600);
    });
  };
  const sPlay = async (s, play = true) => {
    SM.on = true; SM.s = s; SM.t = 0; SM.d = s.dur || 0; SM.playing = false;
    const tok = ++SM.tok;
    document.body.classList.add('sp-on');
    if (!ensureEl()) return failed(s, 'el');
    tick(); paint(); pi();
    if (play) toastOnce();
    let v = []; try { v = await vidsFor(s); } catch (e) { }
    if (tok !== SM.tok) return;
    SM.cand = v; SM.ci = 0;
    if (!v.length) return spFallback(s, tok, play);
    try { await loadYT(); } catch (e) { return spFallback(s, tok, play); }
    if (tok !== SM.tok) return;
    ytLoad(v[0], play, tok);
  };
  let toasted = false;
  const toastOnce = () => { if (toasted) return; toasted = true; toast('Streaming from YouTube. Keep Nortest open while it plays'); };
  const sPause = () => { if (SM.mode === 'yt' && SM.yt) try { SM.yt.pauseVideo(); } catch (e) { } if (SM.mode === 'sp' && SM.spc) try { SM.spc.pause(); } catch (e) { } setPlaying(false); };
  const sResume = () => {
    if (!live()) return;
    if (SM.loaded !== cur.id) return sPlay(cur, true);
    if (SM.mode === 'yt' && SM.yt) try { SM.yt.playVideo(); armHint(SM.tok); } catch (e) { }
    if (SM.mode === 'sp' && SM.spc) try { SM.spc.resume(); } catch (e) { }
  };
  const sToggle = () => SM.playing ? sPause() : sResume();
  const sSeek = t => { t = Math.max(0, Math.min(t || 0, (SM.d || 1e6) - 0.5)); SM.t = t; if (SM.mode === 'yt' && SM.yt) try { SM.yt.seekTo(t, true); } catch (e) { } if (SM.mode === 'sp' && SM.spc) try { SM.spc.seek(t); } catch (e) { } paint(); };
  const sStop = () => {
    if (!SM.on) return;
    SM.tok++; SM.on = false; SM.playing = false; SM.loaded = ''; SM.s = null;
    clearInterval(SM.poll); clearTimeout(SM.hint);
    try { SM.yt && SM.yt.pauseVideo(); } catch (e) { } try { SM.spc && SM.spc.pause(); } catch (e) { }
    document.body.classList.remove('sp-on'); showHint(false); wake(false);
    msHandlers(false);
  };
  const ended = () => {
    if (window.JAM && JAM.next(true)) return;
    if (S.rep === 2) { sSeek(0); sResume(); }
    else if (S.rep !== 1 && !S.shuf && qi === queue.length - 1) { setPlaying(false); }
    else next();
  };

  /* ---------- hook into the player (same way the Radio does) ---------- */
  const _load = load;
  load = function (i, play = true) {
    const s = byId(queue[i]);
    if (!s || !s.stream) { if (SM.on) sStop(); return _load.apply(this, arguments); }
    if (window.DL && DL.has(s.id)) {
      try { if (window.nortestRadio) nortestRadio.remote('stop radio'); } catch (e) { }
      if (cur && cur.id !== s.id) {
        if (nav === 'back') fwd.push(cur.id);
        else { back.push(cur.id); if (back.length > 200) back.shift(); if (nav !== 'fwd') fwd.length = 0; }
      }
      qi = i; cur = s;
      if (SM.on) sStop();
      quietAu();
      if (play) { hist = [s.id, ...hist.filter(x => x !== s.id)].slice(0, 100); save('hist', hist); }
      ui();
      DL.playLocal(s, play).then(ok => { if (!ok) load(i, play); });
      return;
    }
    if (window.DL && !DL.online()) return DL.skipOffline(i, play);
    try { if (window.nortestRadio) nortestRadio.remote('stop radio'); } catch (e) { }
    if (cur && cur.id !== s.id) {
      if (nav === 'back') fwd.push(cur.id);
      else { back.push(cur.id); if (back.length > 200) back.shift(); if (nav !== 'fwd') fwd.length = 0; }
    }
    qi = i; cur = s;
    quietAu();
    const was = SM.on;
    SM.on = true; SM.s = s; SM.loaded = ''; SM.playing = false; SM.t = 0; SM.d = s.dur || 0;
    document.body.classList.add('sp-on');
    if (!was) msHandlers(true);
    if (play) { hist = [s.id, ...hist.filter(x => x !== s.id)].slice(0, 100); save('hist', hist); sPlay(s, true); }
    else { SM.tok++; ensureEl(); try { SM.yt && SM.yt.pauseVideo(); } catch (e) { } tick(); }
    ui();
  };
  const _ui = ui; ui = function () { if (SM.on && !(cur && cur.stream)) sStop(); _ui.apply(this, arguments); if (live()) paint(); };
  const _pi = pi; pi = function () {
    if (!live()) return _pi.apply(this, arguments);
    const p = !SM.playing;
    ['#mpl', '#bpl'].forEach(i => { const e = $(i); if (e) e.innerHTML = ic(p ? 'play' : 'pause'); });
    $('#big').classList.toggle('paused', p); $('#mini').classList.toggle('paused', p);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'paused' : 'playing';
  };
  const _media = media; media = function () {
    if (!live()) return _media.apply(this, arguments);
    if (!('mediaSession' in navigator)) return;
    const s = cur, base = new URL('icons/', location.href).href;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: s.album, artwork: s.art && !s.art.startsWith('data:image/svg') ? [{ src: s.art, sizes: '320x180' }] : [{ src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch (e) { }
  };
  const _start = start; start = function () { if (live()) return sResume(); return _start.apply(this, arguments); };
  const _aup = au.pause; au.pause = function () { if (live()) sPause(); return _aup.apply(au, arguments); };
  const _toggle = A.toggle; A.toggle = (...a) => live() ? sToggle() : _toggle(...a);
  const _prevA = A.prev; A.prev = (...a) => { if (live() && SM.t > 3) return sSeek(0); return _prevA(...a); };
  ['b10', 'f10'].forEach(k => { const f = A[k]; A[k] = (...a) => live() ? sSeek(SM.t + (k === 'b10' ? -10 : 10)) : f(...a); });
  $('#seek').addEventListener('input', e => { if (live() && SM.d) sSeek(e.target.value / 100 * SM.d); });
  au.addEventListener('volumechange', () => { try { SM.yt && SM.yt.setVolume(Math.round((au.muted ? 0 : au.volume) * 100)); } catch (e) { } });
  const _fav = A.fav; A.fav = (b, id, ...r) => { const s = id ? byId(id) : cur; if (s && s.stream) return toast('Only songs on your phone can be favorites'); return _fav(b, id, ...r); };
  ['edit', 'sdel', 'dhide'].forEach(k => { const f = A[k]; if (f) A[k] = (b, id, ...r) => isSp(id) ? $('#menu').classList.add('hid') : f(b, id, ...r); });
  /* the ... menu on a streaming song: queue it, add it to a playlist, or open it in Spotify / YouTube */
  const _dots = A.dots; A.dots = (b, id, ...r) => {
    if (!isSp(id)) return _dots(b, id, ...r);
    const s = byId(id); if (!s) return;
    const rc = b.getBoundingClientRect(), m = $('#menu');
    const it = [['Play next', 'qnext', 'play_next'], ['Add to queue', 'qadd', 'queue_music'], ...(queue.includes(id) ? [['Remove from queue', 'qrmid', 'playlist_remove']] : []), ['Add to playlist', 'topl', 'playlist_add'],
    ...(view === 'playlists' && sub ? [['Remove from this playlist', 'prm', 'playlist_remove']] : []),
    ...(window.DL ? DL.menuItems(id) : [])];
    m.innerHTML = `<div class="mh"><img src="${esc(s.art)}" alt=""><div><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></div></div>` + it.map(([t, a, ico]) => `<button data-a="${a}" data-id="${esc(id)}" class="mx-${a}">${mi(ico)}<span>${t}</span></button>`).join('') +
      `<button data-a="spver" data-id="${esc(id)}">${mi('sp_refresh')}<span>Wrong song? Pick another</span></button><button data-a="spopenx" data-w="sp" data-id="${esc(id)}">${mi('sp_out')}<span>Open in Spotify</span></button><button data-a="spopenx" data-w="yt" data-id="${esc(id)}">${mi('sp_out')}<span>Find on YouTube</span></button>`;
    m.classList.remove('hid');
    m.style.top = Math.max(8, Math.min(rc.bottom, innerHeight - m.offsetHeight - 8)) + 'px';
    m.style.left = Math.max(8, Math.min(rc.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  };

  /* leaving the review screen any other way closes it */
  const _nav = A.nav; A.nav = (...a) => { RV = null; return _nav(...a); };
  const _back = A.back; A.back = (...a) => { RV = null; return _back(...a); };
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'spu') { e.preventDefault(); A.spgo(document.querySelector('[data-a="spgo"]')); } });
  /* a playlist deleted from Nortest forgets its import too (only our own key is touched) */
  const _pdel = A.pdel; A.pdel = async (...a) => { const id = sub; const r = await _pdel(...a); const x = impFor(id); if (x) { const all = ls(); delete all[x[0]]; lsSet(all); } return r; };

  regAll();
  window.nortestSpotify = { matchAll, normT, parsePaste, fetchList, SM, REG };
  if (view === 'playlists') render();
})();
