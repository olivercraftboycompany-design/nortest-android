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
  /* 1.6.5: the radio (its own <audio id="rau">) and streamed songs (YouTube / Spotify embed) also drive the
     native media notification and lock screen, not only the local-song player (#au). */
  function radioSt() { try { var r = window.nortestRadio; var st = r && r.state(); return st && st.on && st.station ? st : null; } catch (e) { return null; } }
  function streamSM() { try { var sp = window.nortestSpotify, SM = sp && sp.SM, s = curSong(); return SM && SM.on && s && s.stream ? SM : null; } catch (e) { return null; } }
  var lastSent = 0;
  function sendState() {
    try {
      lastSent = Date.now();
      var rs = radioSt();
      if (rs) { N.setState(!rs.paused || !!rs.wait, 0, -1, 1); return; }
      var SM = streamSM();
      if (SM) { N.setState(!!SM.playing, Math.max(0, Math.round((SM.t || 0) * 1000)), ms(SM.d || (curSong() && curSong().dur)), 1); return; }
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
    try { var src0 = cover(s); if (/^https?:/i.test(src0) && src0.indexOf(location.origin) !== 0) img.crossOrigin = 'anonymous'; } catch (e) { }
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
  var lastRadioArt = null;
  function sendRadioMeta(rs) {
    var st = rs.station, now = '';
    try { now = (window.nortestRadio.R && window.nortestRadio.R.now) || ''; } catch (e) { }
    var key = 'radio|' + st.id + '|' + st.name + '|' + now;
    if (key !== lastKey) {
      lastKey = key;
      try { N.setMetadata(now || st.name || 'Radio', now ? (st.name || '') : 'Live radio', 'Nortest Radio', -1); } catch (e) { }
      var akey = 'radio:' + st.id;
      if (akey !== lastRadioArt) {
        lastRadioArt = akey; lastArt = null;
        if (st.logo && /^https:/i.test(st.logo)) {
          var img = new Image(); img.crossOrigin = 'anonymous';
          img.onload = function () {
            try {
              var c = document.createElement('canvas'); c.width = c.height = 256;
              var g = c.getContext('2d'), r = Math.min(256 / img.naturalWidth, 256 / img.naturalHeight);
              g.fillStyle = '#111'; g.fillRect(0, 0, 256, 256);
              g.drawImage(img, (256 - img.naturalWidth * r) / 2, (256 - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r);
              if (lastRadioArt === akey) N.setArt(akey, c.toDataURL('image/jpeg', 0.85).split(',')[1]);
            } catch (e) { N.setArt(akey, ''); }
          };
          img.onerror = function () { if (lastRadioArt === akey) N.setArt(akey, ''); };
          img.src = st.logo;
        } else N.setArt(akey, '');
      }
    }
    sendState();
  }
  function sendMeta() {
    var rs = radioSt();
    if (rs) return sendRadioMeta(rs);
    lastRadioArt = null;
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
  if (typeof pi === 'function') {   /* the play/pause icon refresh: radio and streaming call it on every change */
    var _pi = pi;
    pi = function () { var r = _pi.apply(this, arguments); try { sendMeta(); } catch (e) { } return r; };
  }
  try {
    var rau = window.nortestRadio && window.nortestRadio.el;
    if (rau) ['play', 'playing', 'pause', 'waiting', 'emptied', 'error'].forEach(function (ev) { rau.addEventListener(ev, function () { setTimeout(sendMeta, 0); }); });
  } catch (e) { }
  au.addEventListener('loadedmetadata', function () { lastKey = null; sendMeta(); });
  setInterval(sendMeta, 3000);
  setTimeout(sendMeta, 500);

  /* ---- native -> web: media buttons (notification, lock screen, headset, car) ---- */
  window.__nortestCmd = function (c, arg) {
    try {
      var rs = radioSt(), SM = rs ? null : streamSM();
      if (rs) {   /* live radio: play / pause / next / previous station; no seeking */
        var R = window.nortestRadio;
        if (c === 'play') R.remote('play');
        else if (c === 'pause') R.remote('pause');
        else if (c === 'toggle') R.remote(rs.paused ? 'play' : 'pause');
        else if (c === 'next') R.remote('next');
        else if (c === 'prev') R.remote('prev');
      }
      else if (SM) {   /* a streamed song (YouTube / Spotify embed) */
        if (c === 'play') start();
        else if (c === 'pause') au.pause();
        else if (c === 'toggle') A.toggle();
        else if (c === 'next') next();
        else if (c === 'prev') A.prev();
        else if (c === 'rew') A.b10();
        else if (c === 'ff') A.f10();
        else if (c === 'seek' && SM.d) {
          var sk = document.getElementById('seek');
          if (sk) { sk.value = Math.max(0, Math.min(100, (+arg || 0) / 10 / SM.d)); sk.dispatchEvent(new Event('input', { bubbles: true })); }
        }
      }
      else if (c === 'play') { if (!curSong() && typeof queue !== 'undefined' && queue.length) load(Math.max(0, qi)); else start(); }
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

  /* ---- keep the screen on while a song streams (the page asks through the Wake Lock API, which WebView lacks) ---- */
  if (!('wakeLock' in navigator) && typeof N.keepScreenOn === 'function') {
    try {
      var wlN = 0;
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
        request: function () {
          wlN++; N.keepScreenOn(true);
          var done = false, sentinel = {
            type: 'screen', released: false,
            release: function () { if (!done) { done = true; sentinel.released = true; wlN = Math.max(0, wlN - 1); if (!wlN) N.keepScreenOn(false); } return Promise.resolve(); },
            addEventListener: function () { }, removeEventListener: function () { }
          };
          return Promise.resolve(sentinel);
        }
      } });
    } catch (e) { }
  }

  /* ---- fullscreen button -> real immersive mode ---- */
  var fs = false;
  try {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: function () { return fs ? document.documentElement : null; } });
  } catch (e) { }
  Element.prototype.requestFullscreen = function () { fs = true; N.setFullscreen(true); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  document.exitFullscreen = function () { fs = false; N.setFullscreen(false); document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
})();
