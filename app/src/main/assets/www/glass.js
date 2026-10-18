/* nortest 1.3 - Liquid Glass helpers: tab bar icons, album-art tinted background,
   "paused" art shrink, and a solid-tint fallback if blur makes this phone lag.
   Only touches looks: no songs, settings or storage are changed. */
(() => {
  const $ = s => document.querySelector(s);
  const root = document.documentElement;

  /* tab bar icons (SF Symbols-ish outlines) */
  const P = {
    library: '<path d="M5 4v16M9 4v16M13.5 4.5l5 15"/>',
    favorites: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    albums: '<rect x="3.5" y="6" width="14" height="14" rx="2.5"/><path d="M7 3.5h11a2.5 2.5 0 0 1 2.5 2.5v11"/><circle cx="10.5" cy="13" r="2.2"/>',
    artists: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
    queue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M15 14.5v5l4-2.5z"/>',
    playlists: '<path d="M4 6h10M4 11h10M4 16h6"/><circle cx="17" cy="17" r="2.5"/><path d="M19.5 17V7l2 1"/>',
    history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
  };
  const icons = () => {
    document.querySelectorAll('#nav button[data-v]').forEach(b => {
      if (b.querySelector('.ni')) return;
      const p = P[b.dataset.v]; if (!p) return;
      b.insertAdjacentHTML('afterbegin', `<svg class="ni" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`);
    });
  };
  const nav = $('#nav');
  if (nav) { icons(); new MutationObserver(icons).observe(nav, { childList: true }); }

  /* album-art tint: sample the cover into 3 colors for the background */
  const DEF = ['#2b4bff', '#8a2bff', '#12c2a0'];
  const cv = document.createElement('canvas'); cv.width = cv.height = 24;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const hsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  };
  const css = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const setT = c => { root.style.setProperty('--t1', c[0]); root.style.setProperty('--t2', c[1]); root.style.setProperty('--t3', c[2]); };
  let lastSrc = '', isPH = s => !s || s.startsWith('data:image/svg');
  const tint = src => {
    if (src === lastSrc) return; lastSrc = src;
    if (isPH(src)) { setT(DEF); return; }
    const im = new Image();
    im.onload = () => {
      if (src !== lastSrc) return;
      try {
        cx.clearRect(0, 0, 24, 24); cx.drawImage(im, 0, 0, 24, 24);
        const d = cx.getImageData(0, 0, 24, 24).data, bins = {};
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
          if (l < .08 || l > .94) continue;
          const k = s < .18 ? 'g' : Math.round(h / 30) % 12, w = .2 + s * (1 - Math.abs(l - .5));
          const o = bins[k] || (bins[k] = { w: 0, h: 0, s: 0, l: 0, x: 0, y: 0 });
          const a = h * Math.PI / 180;
          o.w += w; o.x += Math.cos(a) * w; o.y += Math.sin(a) * w; o.s += s * w; o.l += l * w;
        }
        const top = Object.entries(bins).filter(([k]) => k !== 'g').map(([, o]) => o).sort((a, b) => b.w - a.w);
        if (!top.length) { setT(['#4a4f66', '#2c3042', '#6b7088']); return; }
        const col = o => css((Math.atan2(o.y, o.x) * 180 / Math.PI + 360) % 360, Math.min(.9, Math.max(.45, o.s / o.w + .1)), Math.min(.55, Math.max(.36, o.l / o.w)));
        const c = top.slice(0, 3).map(col);
        while (c.length < 3) c.push(c[c.length - 1]);
        setT(c);
      } catch (e) { setT(DEF); }   /* a cover the browser won't let us read: keep the default colors */
    };
    im.onerror = () => setT(DEF);
    im.src = src;
  };
  const art = $('#mArt');
  if (art) {
    new MutationObserver(() => tint(art.getAttribute('src') || '')).observe(art, { attributes: true, attributeFilter: ['src'] });
    tint(art.getAttribute('src') || '');
  }

  /* now playing: the cover shrinks a little while paused */
  const au = $('#au'), big = $('#big');
  if (au && big) {
    const st = () => big.classList.toggle('paused', au.paused);
    ['play', 'pause', 'emptied', 'ended'].forEach(e => au.addEventListener(e, st)); st();
  }

  /* if blurred glass makes scrolling lag on this phone, switch to solid tinted glass for this session */
  const view = $('#view');
  if (view && window.requestAnimationFrame && !/[?&]glass=full/.test(location.search)) {
    let on = false, last = 0, n = 0, slow = 0, wins = 0, stopT = 0;
    const tick = t => {
      if (last) { n++; if (t - last > 34) slow++; }
      last = t;
      if (n >= 90) {
        wins++;
        const r = slow / n;
        n = slow = 0;
        if (r > .45) { if (wins >= 2 || r > .7) { document.body.classList.add('ng-lite'); return; } }
        else wins = 0;
      }
      if (on) requestAnimationFrame(tick);
    };
    view.addEventListener('scroll', () => {
      clearTimeout(stopT); stopT = setTimeout(() => { on = false; last = 0; }, 200);
      if (!on && !document.body.classList.contains('ng-lite')) { on = true; requestAnimationFrame(tick); }
    }, { passive: true });
  }
})();
