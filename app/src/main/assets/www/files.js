/* nortest 1.9.0 - Add songs from Files (from Cadence): pick audio files on the phone and choose where they go -
   a new playlist ("My Files") or one you already have. Songs land in the library as usual (IndexedDB "songs",
   same fields the old importer wrote), a song already in the library is reused instead of copied twice, and the
   playlist's cover comes from the first song that has art, like every playlist here. This replaces the old
   Upload flow: same storage, Carter's flow. */
(() => {
  'use strict';
  if (window.__ntfilesLoaded) return; window.__ntfilesLoaded = 1;
  let picked = [], busy = false;
  const toastMsg = m => { try { if (window.NN && NN.toast) { NN.toastMsg(m); return; } } catch (e) { }
    try { let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); } t.textContent = m; t.classList.add('show'); clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => t.classList.remove('show'), 2600); } catch (e) { } };

  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/gi, ' ').trim();
  const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wave', flac: 'audio/flac', aac: 'audio/aac', webm: 'audio/webm' };
  const tags = f => new Promise(r => window.jsmediatags ? jsmediatags.read(f, { onSuccess: x => r(x.tags), onError: () => r({}) }) : r({}));
  const fb = n => { const b = (n || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim(); const m = b.match(/^(.+?)\s*[-\u2013\u2014]\s*(.+)$/); return m ? { artist: m[1], title: m[2] } : { title: b || 'Untitled', artist: 'Unknown Artist' }; };
  const extOf = (n, t) => { const m = /\.([a-z0-9]{2,5})$/i.exec(n || ''); return m ? m[1].toLowerCase() : ((t || '').split('/')[1] || 'mp3'); };
  const probe = blob => new Promise(res => { const a = new Audio(); a.muted = true; a.preload = 'metadata'; const u = URL.createObjectURL(blob); let done = false; const end = v => { if (done) return; done = true; a.removeAttribute('src'); try { a.load(); } catch (e) { } URL.revokeObjectURL(u); res(v); }; const to = setTimeout(() => end(0), 6000); a.onloadedmetadata = () => { clearTimeout(to); end(isFinite(a.duration) ? a.duration : 0); }; a.onerror = () => { clearTimeout(to); end(0); }; a.src = u; });

  function pick() {
    if (busy) { toastMsg('Still adding your last songs…'); return; }
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'audio/*'; i.multiple = true;
    i.onchange = () => { const fl = [...(i.files || [])].filter(f => f && f.size > 0); if (fl.length) { picked = fl; openSheet(); } };
    i.click();
  }

  const mine = () => pls.find(p => norm(p.name) === 'my files');

  function openSheet() {
    const n = picked.length, m = mine();
    mod(`<h3>Add ${n} song${n === 1 ? '' : 's'} to…</h3>
<p class="mhint">${esc(picked[0].name)}${n > 1 ? ` and ${n - 1} more` : ''}</p>
<label class="mopt"><input type="radio" name="fsd" value="new" ${m ? '' : 'checked'}> New playlist</label>
<input id="fsname" placeholder="Playlist name" value="${esc(m ? 'My Files 2' : 'My Files')}">
<label class="mopt"><input type="radio" name="fsd" value="old" ${m ? 'checked' : ''} ${pls.length ? '' : 'disabled'}> Existing playlist</label>
<select id="fslist" ${m && pls.length ? '' : 'disabled'}>${pls.map(p => `<option value="${p.id}" ${m && p.id === m.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
<div class="mrow"><button class="btn" data-a="fsx">Cancel</button><button class="btn pri" data-a="fsgo">Add ${n} song${n === 1 ? '' : 's'}</button></div>`);
    ['fsname', 'fslist'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('focus', () => { const r = document.querySelector('input[name="fsd"][value="' + (id === 'fsname' ? 'new' : 'old') + '"]'); if (r && !r.disabled) r.checked = true; }); });
  }

  async function makeSong(f) {
    const ext = extOf(f.name, f.type);
    const mime = (f.type && f.type.startsWith('audio/')) ? f.type : (MIME[ext] || 'audio/mpeg');
    const blob = new Blob([await f.arrayBuffer()], { type: mime });  // a copy the app owns
    const dur = await probe(blob);
    const t = await tags(blob), l = t.lyrics;
    const c = t.picture ? new Blob([new Uint8Array(t.picture.data)], { type: t.picture.format }) : null;
    const nm = fb(f.name);
    const title = String(t.title || '').trim() || nm.title;
    const artist = String(t.artist || '').trim() || nm.artist;
    const album = String(t.album || '').trim() || 'Unknown Album';
    const ex = songs.find(s => norm(s.title) === norm(title) && norm(s.artist) === norm(artist));
    if (ex) return ex;                       // already in the library: reuse it, never copy it twice
    const s = { id: crypto.randomUUID(), title, artist, album, lyrics: typeof l === 'string' ? l : (l && l.lyrics) || '', cover: c, blob, fav: false, added: Date.now(), dur };
    songs.push(s); await put('songs', s);
    return s;
  }

  A.fsx = () => { picked = []; closeMod(); };
  A.fsgo = async () => {
    if (busy) return;
    const dest = (document.querySelector('input[name="fsd"]:checked') || {}).value || 'new';
    let pl = dest === 'old' ? pls.find(p => p.id === (document.getElementById('fslist') || {}).value) : null;
    if (!pl) {
      const name = ((document.getElementById('fsname') || {}).value || '').trim().replace(/\s+/g, ' ') || 'My Files';
      pl = pls.find(p => norm(p.name) === norm(name));
      if (!pl) { pl = { id: crypto.randomUUID(), name, songs: [] }; pls.push(pl); await put('playlists', pl); }
    }
    const fl = picked; picked = []; closeMod();
    busy = true;
    let added = 0, already = 0; const bad = [];
    for (let i = 0; i < fl.length; i++) {
      try { const s = await makeSong(fl[i]); if (pl.songs.includes(s.id)) already++; else { pl.songs.push(s.id); added++; } }
      catch (e) { bad.push(fl[i].name); if (e && e.name === 'QuotaExceededError') { toastMsg('Your phone is out of space for more songs'); break; } }
    }
    try { await put('playlists', pl); } catch (e) { }
    busy = false; render();
    const parts = [];
    if (added) parts.push(`Added ${added} song${added === 1 ? '' : 's'} to “${pl.name}”`);
    if (already) parts.push(`${already} ${already === 1 ? 'was' : 'were'} already there`);
    if (bad.length) parts.push(`${bad.length} couldn't be added (${bad.slice(0, 2).join(', ')}${bad.length > 2 ? '…' : ''})`);
    toastMsg(parts.join('. ') || 'Nothing added');
  };

  window.NTFILES = { pick };
})();
