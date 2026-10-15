/* nortest Android app bridge: connects the web player to the native media session.
   Loaded last by index.html inside the Nortest Android app only. */
(function () {
  'use strict';
  var N = window.NortestNative;
  if (!N) return;
  document.documentElement.classList.add('is-android-app');

  var st = document.createElement('style');
  st.textContent = '#installBtn,#iosTip{display:none!important}';
  document.head.appendChild(st);

  function curSong() { try { return (typeof cur !== 'undefined') ? cur : null; } catch (e) { return null; } }
  function ms(x) { return (isFinite(x) && x > 0) ? Math.round(x * 1000) : -1; }

  /* ---- web -> native: playback state ---- */
  var lastSent = 0;
  function sendState() {
    try {
      lastSent = Date.now();
      N.setState(!au.paused && !au.ended, Math.max(0, Math.round((au.currentTime || 0) * 1000)),
        ms(au.duration || (curSong() && curSong().dur)), au.playbackRate || 1);
    } catch (e) { }
  }
  ['play', 'playing', 'pause', 'seeked', 'loadedmetadata', 'durationchange', 'ended', 'ratechange', 'emptied', 'waiting']
    .forEach(function (ev) { au.addEventListener(ev, sendState); });
  au.addEventListener('timeupdate', function () { if (Date.now() - lastSent > 4000) sendState(); });

  /* ---- web -> native: song info + cover art ---- */
  var lastKey = null, lastArt = null;
  function sendArt(s) {
    var key = s && (s.cover || s.art) ? String(s.id) : '';
    if (key === lastArt) return;
    lastArt = key;
    if (!key) { N.setArt('', ''); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var size = Math.min(512, Math.max(img.naturalWidth, img.naturalHeight)) || 512;
        var c = document.createElement('canvas'); c.width = c.height = size;
        var g = c.getContext('2d');
        var r = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        var w = img.naturalWidth * r, h = img.naturalHeight * r;
        g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        if (lastArt === key) N.setArt(key, c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      } catch (e) { N.setArt(key, ''); }
    };
    img.onerror = function () { N.setArt(key, ''); };
    try { img.src = cover(s); } catch (e) { N.setArt(key, ''); }
  }
  function sendMeta() {
    var s = curSong();
    var key = s ? [s.id, s.title, s.artist, s.album, (s.cover || s.art) ? 1 : 0].join('|') : '';
    if (key !== lastKey) {
      lastKey = key;
      try { N.setMetadata(s ? (s.title || '') : '', s ? (s.artist || '') : '', s ? (s.album || '') : '', ms(au.duration || (s && s.dur))); } catch (e) { }
      sendArt(s);
    }
    sendState();
  }
  if (typeof ui === 'function') {
    var _ui = ui;
    ui = function () { var r = _ui.apply(this, arguments); try { sendMeta(); } catch (e) { } return r; };
  }
  au.addEventListener('loadedmetadata', function () { lastKey = null; sendMeta(); });
  setInterval(sendMeta, 3000);
  setTimeout(sendMeta, 500);

  /* ---- native -> web: media buttons (notification, lock screen, headset, car) ---- */
  window.__nortestCmd = function (c, arg) {
    try {
      if (c === 'play') { if (!curSong() && typeof queue !== 'undefined' && queue.length) load(Math.max(0, qi)); else start(); }
      else if (c === 'pause') au.pause();
      else if (c === 'toggle') { if (au.paused) start(); else au.pause(); }
      else if (c === 'next') next();
      else if (c === 'prev') prev();
      else if (c === 'rew') seekBy(-10);
      else if (c === 'ff') seekBy(10);
      else if (c === 'seek') { au.currentTime = Math.max(0, (+arg || 0) / 1000); }
    } catch (e) { console.warn('nortest cmd failed', c, e); }
    setTimeout(sendState, 250);
  };

  /* ---- downloads: blob links (backup .zip) go to the phone's Downloads ---- */
  function saveBlob(blob, name) {
    var id = N.saveStart(name || 'nortest-file', blob.type || 'application/octet-stream');
    if (!id) { N.toast('Could not save ' + name); return Promise.resolve(false); }
    var CH = 768 * 1024, off = 0;
    function step() {
      if (off >= blob.size) { N.saveEnd(id, true); return Promise.resolve(true); }
      var part = blob.slice(off, off + CH);
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result.split(',')[1] || ''); };
        fr.onerror = function () { rej(fr.error); };
        fr.readAsDataURL(part);
      }).then(function (b64) {
        if (!N.saveChunk(id, b64)) throw new Error('write failed');
        off += CH;
        return step();
      });
    }
    return step().catch(function (e) { N.saveEnd(id, false); return false; });
  }
  var _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var href = this.href || '';
    if (this.hasAttribute('download') && /^(blob|data):/.test(href)) {
      var name = this.getAttribute('download') || 'nortest-file';
      fetch(href).then(function (r) { return r.blob(); }).then(function (b) { return saveBlob(b, name); })
        .catch(function () { N.toast('Saving failed'); });
      return;
    }
    return _click.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && /^(blob|data):/.test(a.href || '')) { e.preventDefault(); a.click(); }
  }, true);

  /* ---- fullscreen button -> real immersive mode ---- */
  var fs = false;
  try {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: function () { return fs ? document.documentElement : null; } });
  } catch (e) { }
  Element.prototype.requestFullscreen = function () { fs = true; N.setFullscreen(true); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  document.exitFullscreen = function () { fs = false; N.setFullscreen(false); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
})();
