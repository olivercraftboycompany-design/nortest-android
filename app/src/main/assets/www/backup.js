/* ---------- nortest Backup & restore ----------
   Back up:  everything in the app (song files, covers, playlists, favourites,
             play counts, history, queue, settings, custom background) into ONE
             .zip file. Songs are stored uncompressed, so a PC can open the zip too.
   Restore:  pick that .zip and it merges back in without duplicating songs.
   Storage:  asks Chrome to keep the songs (navigator.storage.persist) and shows
             how much space is used.                                           */
(() => {
  const BK_VER = 1;
  const DAY = 864e5;

  /* ---------- styles ---------- */
  const st = document.createElement('style');
  st.textContent = `
.bk-card{margin:12px 0;padding:14px;border:1px solid var(--bd);border-radius:14px;background:rgba(255,255,255,.04)}
.bk-card h4{font-size:15px;font-weight:800;margin:0 0 8px;display:flex;align-items:center;gap:8px}
.bk-card p{color:var(--mu);font-size:13px;margin:4px 0}
.bk-card p b{color:var(--tx);font-weight:600}
.bk-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin:10px 0 6px}
.bk-bar i{display:block;height:100%;width:0;background:var(--acc);border-radius:99px;transition:width .2s}
.bk-opt{display:flex!important;gap:12px;align-items:flex-start;margin:8px 0!important;padding:11px 12px;border:1px solid var(--bd);border-radius:12px;cursor:pointer;color:var(--tx)!important}
.mb .bk-opt input[type=radio],.mb .bk-opt input[type=checkbox]{width:20px!important;height:20px;min-width:20px;padding:0!important;margin:1px 0 0;border:0;background:none;accent-color:var(--acc);flex:none;cursor:pointer}
.bk-opt>div{flex:1;min-width:0}
.bk-opt span{display:block;font-weight:600}
.bk-opt small{display:block;color:var(--mu);font-size:12px;font-weight:400;margin-top:2px}
.bk-opt:has(input:checked){border-color:var(--acc);background:rgba(255,255,255,.06)}
.bk-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.bk-row .btn{flex:1 1 auto;text-align:center}
.bk-ok{color:var(--acc)!important}
.bk-warn{color:#ffb84d!important}
.bk-err{color:#ff6b6b!important}
#bkBtn{position:relative}
#bkBtn.due::after{content:'';position:absolute;top:5px;right:7px;width:8px;height:8px;border-radius:50%;background:#ffb84d;box-shadow:0 0 0 2px #08090d}
@media (max-width:700px){#bkBtn{padding:9px 12px}}
`;
  document.head.appendChild(st);

  /* ---------- helpers ---------- */
  const MB = n => {
    if (!n) return '0 MB';
    if (n < 1e6) return Math.max(1, Math.round(n / 1e3)) + ' KB';
    if (n < 1e9) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB';
    return (n / 1e9).toFixed(2) + ' GB';
  };
  const ago = t => {
    if (!t) return 'never';
    const d = Math.floor((Date.now() - t) / DAY);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago';
  };
  const safe = t => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'song';
  const extOf = (b, fb) => {
    const n = (b && b.name) || '';
    const m = n.match(/\.([a-z0-9]{1,5})$/i);
    if (m) return m[1].toLowerCase();
    const t = (b && b.type) || '';
    return ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/webm': 'webm', 'audio/opus': 'opus', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' })[t] || fb;
  };
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- CRC32 + a small "stored" zip writer/reader ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crcUpdate = (c, u8) => { for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; };
  const CHUNK = 4 * 1024 * 1024;
  async function crcBlob(b, onBytes) {
    let c = 0xFFFFFFFF;
    for (let o = 0; o < b.size; o += CHUNK) {
      const u8 = new Uint8Array(await b.slice(o, o + CHUNK).arrayBuffer());
      c = crcUpdate(c, u8);
      onBytes && onBytes(u8.length);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const enc = new TextEncoder();
  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }
  const MAX32 = 0xFFFFFFFF;
  async function makeZip(entries, onBytes) {
    const parts = [], central = [], now = dosTime(new Date());
    let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), blob = e.blob, size = blob.size;
      const crc = await crcBlob(blob, onBytes);
      if (off + 30 + name.length + size > MAX32) throw new Error('TOO_BIG');
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, now.time, true); h.setUint16(12, now.date, true); h.setUint32(14, crc, true);
      h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, blob);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, now.time, true); c.setUint16(14, now.date, true); c.setUint32(16, crc, true);
      c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      central.push(c.buffer, name);
      off += 30 + name.length + size;
      await tick();
    }
    const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
    if (off + cdSize + 22 > MAX32) throw new Error('TOO_BIG');
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  async function readZip(file) {
    const tailLen = Math.min(file.size, 65557);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('NOT_ZIP');
    const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder(), map = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('BAD_ZIP');
      const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true);
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true), lo = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      map.set(name, { method, csize, usize, lo });
      p += 46 + nl + xl + cl;
    }
    const get = async (name, type) => {
      const z = map.get(name);
      if (!z) return null;
      const lh = new DataView(await file.slice(z.lo, z.lo + 30).arrayBuffer());
      const start = z.lo + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = file.slice(start, start + z.csize);
      if (z.method === 0) return new Blob([raw], { type: type || '' });
      if (z.method === 8 && 'DecompressionStream' in window) {
        const b = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        return new Blob([b], { type: type || '' });
      }
      throw new Error('UNSUPPORTED');
    };
    return { map, get };
  }

  /* ---------- play counts (counted after 30 s, or half of a short song) ---------- */
  let plays = {}, counted = false;
  meta('plays').then(p => { plays = p || {}; });
  const _loadBk = load;
  load = function () { counted = false; return _loadBk.apply(this, arguments); };
  au.addEventListener('timeupdate', () => {
    if (counted || !cur || au.paused) return;
    const need = Math.min(30, (au.duration || cur.dur || 60) * 0.5);
    if (au.currentTime >= need) {
      counted = true;
      plays[cur.id] = (plays[cur.id] || 0) + 1;
      save('plays', plays);
    }
  });
  sorters.plays = (a, b) => (plays[b.id] || 0) - (plays[a.id] || 0) || b.added - a.added;
  window.nortestPlays = () => plays;

  /* ---------- storage protection ---------- */
  const SM = navigator.storage || {};
  const isPersisted = async () => { try { return SM.persisted ? await SM.persisted() : null; } catch { return null; } };
  const askPersist = async () => { try { return SM.persist ? await SM.persist() : null; } catch { return null; } };
  const estimate = async () => { try { return SM.estimate ? await SM.estimate() : null; } catch { return null; } };
  /* quietly ask once songs exist (Chrome decides on its own; it never shows a popup) */
  const autoPersist = async () => { if (own().length && (await isPersisted()) === false) await askPersist(); };
  $('#file').addEventListener('change', () => setTimeout(autoPersist, 3000));
  setTimeout(autoPersist, 4000);

  /* ---------- header button + "last backup" nudge ---------- */
  const settingsBtn = document.querySelector('header.top [data-a=settings]');
  if (settingsBtn) settingsBtn.insertAdjacentHTML('beforebegin', `<button class="ib" data-a="backup" id="bkBtn" aria-label="Backup" title="Back up or restore your songs">${typeof mi === 'function' ? mi('backup') : 'Backup'}</button>`);
  let lastBackup = 0;
  const nudge = () => {
    const due = own().length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * DAY);
    const b = $('#bkBtn');
    if (b) { b.classList.toggle('due', due); b.title = due ? `Last backup: ${ago(lastBackup)}. Tap to back up your songs.` : 'Back up or restore your songs'; }
  };
  meta('lastBackup').then(t => { lastBackup = t || 0; setTimeout(nudge, 500); });

  /* ---------- state the panel draws from (so closing it mid-backup is safe) ---------- */
  const B = { mode: 'all', busy: false, prog: 0, msg: '', msgCls: '', file: null, fileUrl: '', fileName: '', rFile: null, rInfo: null, rSettings: true };

  const sizes = () => {
    let audio = 0, covers = 0;
    own().forEach(s => { audio += (s.blob && s.blob.size) || 0; covers += (s.cover && s.cover.size) || 0; });
    return { audio, covers };
  };

  async function panel() {
    const { audio, covers } = sizes();
    const [pers, est] = await Promise.all([isPersisted(), estimate()]);
    const used = est ? est.usage : 0, quota = est ? est.quota : 0;
    const pc = quota ? Math.min(100, used / quota * 100) : 0;
    const canShare = !!(navigator.canShare && B.file && navigator.canShare({ files: [new File([], 'x.zip', { type: 'application/zip' })] }));
    const persHTML = pers === true
      ? '<p class="bk-ok">🔒 Protected: Chrome won\'t auto-delete your songs.</p>'
      : pers === false
        ? '<p class="bk-warn">⚠️ Not protected yet. If your phone runs low on space, Chrome could clear your songs. Installing the app usually fixes this.</p><div class="bk-row"><button class="btn" data-a="bkpersist">Protect my songs</button></div>'
        : '<p>This browser can\'t lock storage, so keep a backup.</p>';
    const lastHTML = own().length
      ? `<p>Last backup: <b>${ago(lastBackup)}</b>${(!lastBackup || Date.now() - lastBackup > 14 * DAY) ? ' · good time for a fresh one' : ''}</p>` : '';

    const r = B.rInfo;
    const restoreHTML = r
      ? `<p>Backup from <b>${esc(new Date(r.created).toLocaleString())}</b></p>
         <p><b>${r.songs}</b> songs (${r.withAudio} with audio) · <b>${r.playlists}</b> playlists · ${r.favs} favourites · ${MB(r.size)}</p>
         ${r.withAudio < r.songs ? `<p class="bk-warn">${r.songs - r.withAudio} songs in this file have no audio (library-only backup). They only come back if the same song is already on this phone.</p>` : ''}
         <label class="chk bk-opt" style="padding:8px 12px"><input type="checkbox" id="bkRS" ${B.rSettings ? 'checked' : ''}><span>Also restore settings, EQ &amp; background</span></label>
         <div class="bk-row"><button class="btn" data-a="bkrcancel" ${B.busy ? 'disabled' : ''}>Cancel</button><button class="btn pri" data-a="bkrgo" ${B.busy ? 'disabled' : ''}>Restore now</button></div>`
      : `<p>Pick a nortest backup (.zip) to bring your songs, playlists and settings back. Songs already here won't be doubled.</p>
         <div class="bk-row"><button class="btn" data-a="bkrpick" ${B.busy ? 'disabled' : ''}>Choose backup file</button></div>`;

    mod(`<h3>Backup &amp; restore</h3>
<div class="bk-card" id="bkProgCard" ${B.busy || B.msg ? '' : 'style="display:none"'}>
  <div class="bk-bar"><i id="bkProg" style="width:${B.prog}%"></i></div>
  <p id="bkMsg" class="${B.msgCls}">${esc(B.msg)}</p>
</div>
<div class="bk-card"><h4>💾 Storage</h4>
  <p><b>${own().length}</b> songs · <b>${pls.length}</b> playlists · audio ${MB(audio)}</p>
  ${est ? `<div class="bk-bar"><i style="width:${Math.max(pc, used ? 1 : 0)}%"></i></div><p>Using <b>${MB(used)}</b> of ${MB(quota)} available to nortest</p>` : ''}
  ${persHTML}
</div>
<div class="bk-card"><h4>⬆️ Back up</h4>
  ${lastHTML}
  <label class="bk-opt"><input type="radio" name="bkmode" value="all" ${B.mode === 'all' ? 'checked' : ''}><div><span>Everything</span><small>Song files + playlists, favourites, play counts and settings · about ${MB(audio + covers + 50e3)}</small></div></label>
  <label class="bk-opt"><input type="radio" name="bkmode" value="lib" ${B.mode === 'lib' ? 'checked' : ''}><div><span>Library only (no audio)</span><small>Playlists, favourites, play counts and settings · tiny file</small></div></label>
  <div class="bk-row"><button class="btn pri" data-a="bkmake" ${B.busy ? 'disabled' : ''}>${B.busy ? 'Working…' : 'Create backup'}</button></div>
  ${B.file ? `<p class="bk-ok">✅ Backup ready: <b>${esc(B.fileName)}</b> · ${MB(B.file.size)}</p>
  <div class="bk-row"><button class="btn pri" data-a="bksave">Save to phone</button>${canShare ? '<button class="btn" data-a="bkshare">Share…</button>' : ''}</div>
  <p>Save it somewhere safe: Google Drive, a PC, or a USB drive. "Save to phone" puts it in Downloads.</p>` : ''}
</div>
<div class="bk-card"><h4>⬇️ Restore</h4>${restoreHTML}</div>
<div class="mrow"><button class="btn pri" data-a="mx">Done</button></div>`);
  }
  const panelOpen = () => !$('#mod').classList.contains('hid') && !!$('#bkProgCard');
  const progress = (pc, msg, cls = '') => {
    B.prog = Math.max(0, Math.min(100, pc)); B.msg = msg; B.msgCls = cls;
    const card = $('#bkProgCard'), bar = $('#bkProg'), m = $('#bkMsg');
    if (card && card.style.display === 'none') { card.style.display = ''; card.scrollIntoView({ block: 'nearest' }); }
    if (bar) bar.style.width = B.prog + '%';
    if (m) { m.textContent = msg; m.className = cls; }
  };
  const refresh = async () => { if (panelOpen()) { await panel(); if (B.msg || B.busy) $('#mb').scrollTop = 0; } };

  /* ---------- back up ---------- */
  async function makeBackup() {
    if (B.busy) return;
    B.busy = true;
    if (B.fileUrl) URL.revokeObjectURL(B.fileUrl);
    B.file = null; B.fileUrl = '';
    refresh();
    try {
      const full = B.mode === 'all';
      const S2 = { ...S };
      const bgFile = full ? await meta('bgFile') : null;
      const entries = [], list = [];
      for (const s of own()) {
        const tag = s.id.slice(0, 8);
        const rec = {
          id: s.id, title: s.title, artist: s.artist, album: s.album, lyrics: s.lyrics || '', synced: s.synced || '', syncTried: !!s.syncTried,
          fav: !!s.fav, added: s.added, dur: s.dur || 0, name: (s.blob && s.blob.name) || '', type: (s.blob && s.blob.type) || '', size: (s.blob && s.blob.size) || 0,
          file: null, cover: null, coverType: (s.cover && s.cover.type) || ''
        };
        if (full && s.blob) { rec.file = `audio/${safe(s.artist + ' - ' + s.title)} [${tag}].${extOf(s.blob, 'mp3')}`; entries.push({ name: rec.file, blob: s.blob }); }
        if (full && s.cover) { rec.cover = `covers/${tag}.${extOf(s.cover, 'jpg')}`; entries.push({ name: rec.cover, blob: s.cover }); }
        list.push(rec);
      }
      let bg = null;
      if (bgFile) { bg = { file: `background/${safe(bgFile.name || 'background')}`, type: bgFile.type || '', name: bgFile.name || '' }; entries.push({ name: bg.file, blob: bgFile }); }
      const manifest = {
        kind: 'nortest-backup', v: BK_VER, created: new Date().toISOString(), mode: full ? 'full' : 'library',
        songs: list, playlists: pls,
        meta: { S: S2, hist, queue, qi, plays },
        bg
      };
      const readme = `nortest backup made ${new Date().toLocaleString()}\n\nTo restore: open nortest, tap Backup, then "Choose backup file" and pick this .zip.\n${full ? 'Your song files are in the audio folder.' : 'This is a library-only backup (no audio files).'}\n`;
      entries.unshift({ name: 'nortest-backup.json', blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) }, { name: 'README.txt', blob: new Blob([readme], { type: 'text/plain' }) });

      const total = entries.reduce((n, e) => n + e.blob.size, 0) || 1;
      let done = 0;
      progress(0, `Packing ${list.length} songs… 0 of ${MB(total)}`);
      const zip = await makeZip(entries, n => {
        done += n;
        progress(done / total * 100, `Packing ${list.length} songs… ${MB(done)} of ${MB(total)}`);
      });
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      B.fileName = `nortest-backup-${full ? '' : 'library-'}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.zip`;
      B.file = zip; B.fileUrl = URL.createObjectURL(zip);
      progress(100, `Backup ready · ${MB(zip.size)}. Tap "Save to phone" to keep it.`, 'bk-ok');
    } catch (e) {
      console.warn('backup failed', e);
      progress(B.prog, e && e.message === 'TOO_BIG'
        ? 'This library is over 4 GB, too big for one file. Use "Library only" and keep your song files on a PC or Drive.'
        : 'Backup failed: ' + ((e && e.message) || e) + '. Try "Library only", or free some space and try again.', 'bk-err');
    } finally {
      B.busy = false;
      refresh();
    }
  }
  async function markBackedUp() {
    lastBackup = Date.now(); await save('lastBackup', lastBackup); nudge();
  }
  function saveFile() {
    if (!B.file) return;
    const a = document.createElement('a');
    a.href = B.fileUrl; a.download = B.fileName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    markBackedUp();
    progress(100, `Saved ${B.fileName} (${MB(B.file.size)}) to Downloads.`, 'bk-ok');
    setTimeout(refresh, 300);
  }
  async function shareFile() {
    if (!B.file) return;
    const f = new File([B.file], B.fileName, { type: 'application/zip' });
    try {
      if (!navigator.canShare || !navigator.canShare({ files: [f] })) throw new Error('nope');
      await navigator.share({ files: [f], title: 'nortest backup' });
      markBackedUp();
      progress(100, 'Shared ✔ Make sure it landed somewhere safe (like Google Drive).', 'bk-ok');
      setTimeout(refresh, 300);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      progress(100, 'Sharing didn\'t work for a file this size. Use "Save to phone" instead.', 'bk-warn');
    }
  }

  /* ---------- restore ---------- */
  const rInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.zip,application/zip,application/x-zip-compressed', hidden: true });
  document.body.appendChild(rInput);
  rInput.onchange = async () => {
    const f = rInput.files[0]; rInput.value = '';
    if (!f) return;
    B.msg = ''; B.prog = 0;
    try {
      progress(0, 'Reading backup…');
      const z = await readZip(f);
      const mb = await z.get('nortest-backup.json', 'application/json');
      if (!mb) throw new Error('NOT_NORTEST');
      const m = JSON.parse(await mb.text());
      if (m.kind !== 'nortest-backup') throw new Error('NOT_NORTEST');
      B.rFile = { file: f, zip: z, m };
      B.rInfo = { created: m.created, songs: m.songs.length, withAudio: m.songs.filter(s => s.file && z.map.has(s.file)).length, playlists: (m.playlists || []).length, favs: m.songs.filter(s => s.fav).length, size: f.size };
      B.msg = '';
    } catch (e) {
      console.warn('restore read failed', e);
      B.rFile = B.rInfo = null;
      B.msg = e && (e.message === 'NOT_ZIP' || e.message === 'NOT_NORTEST' || e.message === 'BAD_ZIP')
        ? 'That file isn\'t a nortest backup. Pick the .zip you saved from this Backup screen.'
        : 'Couldn\'t read that file: ' + ((e && e.message) || e);
      B.msgCls = 'bk-err';
    }
    refresh();
  };

  async function restore() {
    if (B.busy || !B.rFile) return;
    const { zip, m } = B.rFile;
    const withSettings = $('#bkRS') ? $('#bkRS').checked : B.rSettings;
    B.rSettings = withSettings;
    B.busy = true; refresh();
    const res = { added: 0, matched: 0, skipped: 0, pls: 0, plsMerged: 0 };
    try {
      /* what's already on this phone, so nothing is doubled */
      const have = await all('songs');
      const byKey = new Map();
      const keys = s => [
        'id:' + s.id,
        (s.name && s.size) ? 'n:' + s.name.toLowerCase() + '|' + s.size : null,
        s.size ? 't:' + (s.title || '').toLowerCase() + '|' + (s.artist || '').toLowerCase() + '|' + s.size : null
      ].filter(Boolean);
      const keyOf = s => keys({ id: s.id, title: s.title, artist: s.artist, name: s.blob && s.blob.name, size: s.blob && s.blob.size });
      have.forEach(s => keyOf(s).forEach(k => byKey.has(k) || byKey.set(k, s)));
      const idMap = {};
      const total = m.songs.reduce((n, s) => n + (s.file ? s.size || 1 : 1), 0) || 1;
      let done = 0, i = 0;
      for (const r of m.songs) {
        i++;
        progress(done / total * 95, `Restoring song ${i} of ${m.songs.length}…`);
        const hit = keys(r).map(k => byKey.get(k)).find(Boolean);
        if (hit) {
          idMap[r.id] = hit.id;
          let ch = false;
          if (r.fav && !hit.fav) { hit.fav = true; ch = true; }
          if (!hit.lyrics && r.lyrics) { hit.lyrics = r.lyrics; ch = true; }
          if (!hit.synced && r.synced) { hit.synced = r.synced; hit.syncTried = true; ch = true; }
          if (!hit.cover && r.cover && zip.map.has(r.cover)) { hit.cover = await zip.get(r.cover, r.coverType); ch = true; }
          if (ch) await put('songs', hit);
          res.matched++;
        } else if (r.file && zip.map.has(r.file)) {
          const audio = await zip.get(r.file, r.type);
          const s = {
            id: r.id, title: r.title, artist: r.artist, album: r.album, lyrics: r.lyrics || '', synced: r.synced || '', syncTried: !!r.syncTried,
            cover: r.cover && zip.map.has(r.cover) ? await zip.get(r.cover, r.coverType) : null,
            blob: new File([audio], r.name || r.file.split('/').pop(), { type: r.type || audio.type || 'audio/mpeg' }),
            fav: !!r.fav, added: r.added || Date.now(), dur: r.dur || 0
          };
          await put('songs', s);
          keyOf(s).forEach(k => byKey.set(k, s));
          idMap[r.id] = s.id;
          res.added++;
        } else {
          res.skipped++;
        }
        done += r.file ? r.size || 1 : 1;
        if (i % 5 === 0) await tick();
      }
      const mapIds = ids => (ids || []).map(id => idMap[id]).filter(Boolean);

      /* playlists: same playlist (or same name) = merge the songs in; otherwise add it */
      progress(96, 'Restoring playlists…');
      const curPls = await all('playlists');
      for (const p of m.playlists || []) {
        const ids = mapIds(p.songs);
        const ex = curPls.find(x => x.id === p.id) || curPls.find(x => x.name.trim().toLowerCase() === String(p.name || '').trim().toLowerCase());
        if (ex) {
          const before = ex.songs.length;
          ids.forEach(id => { if (!ex.songs.includes(id)) ex.songs.push(id); });
          if (ex.songs.length !== before) await put('playlists', ex);
          res.plsMerged++;
        } else {
          const np = { ...p, id: p.id || crypto.randomUUID(), name: p.name || 'Restored playlist', songs: ids };
          await put('playlists', np); curPls.push(np); res.pls++;
        }
      }

      /* play counts, history, queue */
      const mm = m.meta || {};
      const curPlays = (await meta('plays')) || {};
      Object.entries(mm.plays || {}).forEach(([id, n]) => { const t = idMap[id]; if (t) curPlays[t] = Math.max(curPlays[t] || 0, n); });
      plays = curPlays; await save('plays', plays);
      const curHist = (await meta('hist')) || [];
      const newHist = [...curHist, ...mapIds(mm.hist).filter(id => !curHist.includes(id))].slice(0, 100);
      await save('hist', newHist);
      if (!queue.length && mm.queue && mm.queue.length) {
        const q = mapIds(mm.queue);
        if (q.length) { await save('queue', q); await save('qi', -1); queue = q; qi = -1; }
      }

      /* settings + background */
      if (withSettings && mm.S) {
        const keep = { sink: S.sink };   // the output device belongs to this phone
        Object.assign(S, mm.S, keep);
        await save('S', S);
        if (m.bg && m.bg.file && zip.map.has(m.bg.file)) {
          const b = await zip.get(m.bg.file, m.bg.type);
          const f = new File([b], m.bg.name || 'background', { type: m.bg.type || b.type });
          await save('bgFile', f);
          if (typeof bgFileUrl !== 'undefined') { if (bgFileUrl) URL.revokeObjectURL(bgFileUrl); bgFileUrl = URL.createObjectURL(f); }
        }
      }

      /* reload the player's in-memory library */
      songs = mergeDev(await all('songs')); pls = await all('playlists'); hist = newHist;
      if (cur) cur = byId(cur.id) || cur;
      applyUI(); render(); ui();
      autoPersist();
      const msg = [
        `Restored ✔ ${res.added} song${res.added === 1 ? '' : 's'} added`,
        res.matched ? `${res.matched} already here` : '',
        res.pls ? `${res.pls} playlist${res.pls === 1 ? '' : 's'} added` : '',
        res.plsMerged ? `${res.plsMerged} playlist${res.plsMerged === 1 ? '' : 's'} merged` : '',
        res.skipped ? `${res.skipped} skipped (no audio in this backup)` : ''
      ].filter(Boolean).join(' · ');
      B.rFile = B.rInfo = null;
      progress(100, msg, 'bk-ok');
      window.nortestLastRestore = res;
    } catch (e) {
      console.warn('restore failed', e);
      const full = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
      progress(B.prog, full
        ? 'Your phone ran out of space partway. Songs restored so far are kept; free up space and restore again (nothing gets doubled).'
        : 'Restore stopped: ' + ((e && e.message) || e) + '. Songs restored so far are kept; you can run it again safely.', 'bk-err');
      songs = mergeDev(await all('songs')); pls = await all('playlists'); render();
    } finally {
      B.busy = false;
      refresh();
    }
  }

  /* ---------- wiring ---------- */
  document.addEventListener('change', e => {
    if (e.target.name === 'bkmode') B.mode = e.target.value;
    if (e.target.id === 'bkRS') B.rSettings = e.target.checked;
  });
  Object.assign(A, {
    backup: () => panel(),
    bkmake: () => makeBackup(),
    bksave: () => saveFile(),
    bkshare: () => shareFile(),
    bkrpick: () => rInput.click(),
    bkrcancel: () => { B.rFile = B.rInfo = null; B.msg = ''; panel(); },
    bkrgo: () => restore(),
    bkpersist: async () => {
      const ok = await askPersist();
      B.msg = ok ? '🔒 Done: Chrome will keep your songs.' : 'Chrome said not yet. Installing the app (⋮ → Install app) and using it a bit usually unlocks this.';
      B.msgCls = ok ? 'bk-ok' : 'bk-warn';
      panel();
    }
  });

  /* "last backup" line inside Settings > Backup & restore */
  window.onSettingsRendered = p => {
    const slot = p.querySelector('.bk-slot');
    if (slot) slot.innerHTML = `<div class="li"><div class="lt"><b>Last backup</b><span>${ago(lastBackup)}</span></div></div>`;
  };

  /* deep link: ?backup opens the panel (used by the app shortcut) */
  if (/[?&]backup\b/.test(location.search) || location.hash === '#backup') setTimeout(panel, 600);

  window.nortestBackup = { panel, makeBackup, restore, readZip, makeZip, state: B };
})();
