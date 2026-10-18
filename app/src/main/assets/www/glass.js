/* nortest 1.5 - Liquid Glass engine.
   Real refraction: every live glass surface gets its own SVG filter whose displacement map is generated for
   that surface's exact size and corner radius (strongest at the rounded rim, zero in the middle), with the red
   and blue channels displaced by slightly different amounts (chromatic fringe). Used as
   backdrop-filter:url(#lg-N) blur() saturate() where Chromium supports SVG backdrop filters; otherwise blur +
   saturate + the specular rim. Only looks: no song, playlist or setting storage changes (S.glass is new). */
'use strict';
const LG = (() => {
  const H = document.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const ua = navigator.userAgent;
  /* Chromium (Chrome, Samsung Internet, Android WebView) renders url() in backdrop-filter; Safari/Firefox parse it but don't */
  /* 1.5.1: Android (phones, WebView, Samsung Internet) reports support but draws nothing, which left glass see-through on a real Samsung; refraction is desktop Chromium only */
  const svgOK = !!(window.CSS && CSS.supports('backdrop-filter', 'url(#a)')) && /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS|Android|Mobile|SamsungBrowser|; wv\)/.test(ua);
  if (!(window.CSS && CSS.supports('backdrop-filter', 'blur(2px)'))) H.classList.add('no-svg-bf');
  if (/Android/.test(ua)) H.classList.add('lg-android');
  const LIVE_MAX = 4;                      /* at most 4 refracting surfaces at once */
  const SURF = [                           /* priority order; first visible ones win */
    { sel: '#nav', depth: 1.0 }, { sel: '#mini', depth: 1.0 },
    { sel: '#big.show .npp', depth: 1.0 }
  ];
  let mode = 'full', svg, defs, seq = 0;
  const live = new Map();                  /* element -> {id, key, filter} */
  const mq = matchMedia('(prefers-reduced-motion: reduce)');

  const ensureSvg = () => {
    if (svg) return;
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(NS, 'defs'); svg.appendChild(defs); document.body.appendChild(svg);
  };

  /* displacement map for a w x h rounded rect, radius r, lens band b (px). R = x shift, G = y shift, 128 = none.
     Pixels near the rim sample from further inside (a convex lens edge), with a circular bevel profile. */
  const mapCache = new Map();
  const makeMap = (w, h, r, b) => {
    const k = [w, h, r, b].join('x'); if (mapCache.has(k)) return mapCache.get(k);
    const s = Math.min(1, 220 / Math.max(w, h)) ;         /* generate small, the map is smooth; feImage scales it */
    const W = Math.max(8, Math.round(w * s)), Hh = Math.max(8, Math.round(h * s));
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const x = c.getContext('2d'), im = x.createImageData(W, Hh), d = im.data;
    const hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const px = (i + .5) / s - hw, py = (j + .5) / s - hh;
      const qx = Math.abs(px) - (hw - rr), qy = Math.abs(py) - (hh - rr);
      let nx, ny, dist;
      if (qx > 0 && qy > 0) { const L = Math.hypot(qx, qy) || 1; dist = rr - L; nx = qx / L * Math.sign(px); ny = qy / L * Math.sign(py); }
      else if (qx > qy) { dist = rr - qx; nx = Math.sign(px); ny = 0; }
      else { dist = rr - qy; nx = 0; ny = Math.sign(py); }
      const t = Math.max(0, Math.min(1, dist / b));
      const m = t >= 1 ? 0 : Math.pow(1 - t, 1.6);   /* strongest at the rim, fading to a clear center */
      const o = (j * W + i) * 4;
      d[o] = 128 - nx * m * 127; d[o + 1] = 128 - ny * m * 127; d[o + 2] = 128; d[o + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    const url = c.toDataURL('image/png'); mapCache.set(k, url); return url;
  };

  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const buildFilter = (id, w, h, r, depth, blurPx) => {
    const band = Math.min(Math.max(18, Math.min(w, h) * 0.5), 46);
    const sc = Math.round(band * 2.1 * depth);         /* how far the rim bends light, in px */
    const f = el('filter', { id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    f.appendChild(el('feImage', { href: makeMap(w, h, r, band), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }));
    /* frost first (inside the filter, so it can't be dropped), then bend the frosted backdrop */
    f.appendChild(el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: blurPx, edgeMode: 'duplicate', result: 'frost' }));
    /* chromatic aberration: red bends most, blue least */
    [['r', 1.06, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['g', 0.94, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['b', 0.82, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0']].forEach(([c, k, mx]) => {
      f.appendChild(el('feDisplacementMap', { in: 'frost', in2: 'map', scale: (sc * k).toFixed(1), xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + c }));
      f.appendChild(el('feColorMatrix', { in: 'd' + c, type: 'matrix', values: mx, result: 'c' + c }));
    });
    f.appendChild(el('feComposite', { in: 'cr', in2: 'cg', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'rg' }));
    f.appendChild(el('feComposite', { in: 'rg', in2: 'cb', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'rgb' }));
    f.appendChild(el('feColorMatrix', { in: 'rgb', type: 'saturate', values: 1.7 }));
    return f;
  };

  const visible = e => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('.hid'); };
  const radiusOf = (e, w, h) => { const v = parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0; return Math.min(v, w / 2, h / 2); };

  const drop = e => { const o = live.get(e); if (!o) return; o.filter.remove(); e.style.removeProperty('--lg-url'); e.classList.remove('lg-live'); live.delete(e); };
  let pending = 0;
  const refresh = () => {
    pending = 0;
    if (mode !== 'full' || !svgOK) { [...live.keys()].forEach(drop); return; }
    ensureSvg();
    const want = [];
    for (const s of SURF) { document.querySelectorAll(s.sel).forEach(e => { if (want.length < LIVE_MAX && visible(e)) want.push([e, s.depth]); }); }
    [...live.keys()].forEach(e => { if (!want.some(w => w[0] === e)) drop(e); });
    want.forEach(([e, depth]) => {
      /* offsetWidth ignores the press-wobble transform */
      const w = Math.round(e.offsetWidth), h = Math.round(e.offsetHeight), r = Math.round(radiusOf(e, w, h));
      const key = [w, h, r, depth].join('|'), o = live.get(e);
      if (o && o.key === key) return;
      if (o) o.filter.remove();
      const id = 'lg-' + (++seq), f = buildFilter(id, w, h, r, depth, e.id === 'menu' || e.id === 'mb' ? 8 : 3.6);
      defs.appendChild(f);
      live.set(e, { id, key, filter: f });
      e.style.setProperty('--lg-url', `url(#${id})`);
      e.classList.add('lg-live');
    });
  };
  const soon = () => { if (!pending) pending = requestAnimationFrame(() => setTimeout(refresh, 30)); };

  /* ---------- mode: Full / Light / Off, plus reduce motion ---------- */
  const apply = () => {
    const S_ = typeof S !== 'undefined' ? S : {};
    mode = ['full', 'light', 'off'].includes(S_.glass) ? S_.glass : 'full';
    H.dataset.glass = mode;
    H.classList.toggle('lg-svg', svgOK && mode === 'full');
    H.classList.toggle('lg-still', !!S_.rmotion || mq.matches);
    /* the iOS look: rounded square art unless he picked a shape */
    H.dataset.art = 'rounded';   /* 1.5.1: the M3 cookie/circle masks are gone; glass art is always a rounded square */
    soon();
  };

  /* ---------- library color field: the playing (or last) cover, huge and slowly drifting ---------- */
  let lastCover = '';
  const coverTick = () => {
    let src = '';
    try { if (typeof cur !== 'undefined' && cur && typeof cover === 'function') src = cover(cur); } catch (e) { }
    if (!src) { try { const im = document.querySelector('#view img[src]:not([src^="data:image/svg"])'); if (im) src = im.src; } catch (e) { } }
    if (src && src.startsWith('data:image/svg')) src = '';
    if (src === lastCover) return;
    lastCover = src;
    H.style.setProperty('--lg-cover', src ? `url("${src.replace(/"/g, '%22')}")` : 'none');
    H.classList.toggle('lg-hascover', !!src);
    /* a tiny pre-blurred copy for opaque panels (settings): no live blur layers needed there */
    if (!src) { H.style.removeProperty('--lg-cover-soft'); return; }
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { if (src !== lastCover) return; try {
      const c = document.createElement('canvas'); c.width = c.height = 18; const x = c.getContext('2d');
      x.filter = 'blur(2px) saturate(1.6)'; x.drawImage(im, -3, -3, 24, 24);
      H.style.setProperty('--lg-cover-soft', `url("${c.toDataURL('image/png')}")`);
    } catch (e) { H.style.removeProperty('--lg-cover-soft'); } };
    im.src = src;
  };

  /* ---------- tab bar: the active indicator is a glass droplet that slides and stretches ---------- */
  let dropEl, lastX = null;
  const placeDrop = () => {
    const nav = document.getElementById('nav'); if (!nav) return;
    if (!dropEl || !nav.contains(dropEl)) { dropEl = document.createElement('i'); dropEl.className = 'lg-drop'; nav.prepend(dropEl); lastX = null; }
    const on = nav.querySelector('button.on'); if (!on) { dropEl.style.opacity = 0; return; }
    const nr = nav.getBoundingClientRect(), br = on.getBoundingClientRect();
    if (!nr.width) return;
    const w = Math.min(br.width + 6, 84), x = br.left - nr.left + (br.width - w) / 2;
    dropEl.style.opacity = 1; dropEl.style.width = w + 'px';
    if (lastX === null || H.classList.contains('lg-still')) { dropEl.style.transform = `translateX(${x}px)`; lastX = x; return; }
    if (Math.abs(x - lastX) < 1) return;
    const dx = x - lastX;
    dropEl.animate([
      { transform: `translateX(${lastX}px) scale(1,1)` },
      { transform: `translateX(${lastX + dx * .55}px) scale(${1 + Math.min(.45, Math.abs(dx) / 260)},.82)`, offset: .45 },
      { transform: `translateX(${x + dx * .04}px) scale(.94,1.06)`, offset: .78 },
      { transform: `translateX(${x}px) scale(1,1)` }
    ], { duration: 560, easing: 'cubic-bezier(.3,.7,.2,1)' });
    dropEl.style.transform = `translateX(${x}px)`; lastX = x;
  };

  /* ---------- gooey press: glass stretches on touch and wobbles back ---------- */
  const PRESS = '#nav button,#mini .ib,.gb,.chip,.btn,.fab,.seg button,.tacts .ib,.bt .ib,.bb .ib,.tr>.ib,.sh .ib,#menu button,.cs-item';
  document.addEventListener('pointerdown', e => {
    if (H.classList.contains('lg-still')) return;
    const t = e.target.closest(PRESS); if (!t || t.disabled) return;
    const pill = t.closest('#nav,#mini');
    t.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12,.9)' }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
    if (pill) pill.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.025,.965)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    const up = () => {
      removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      t.getAnimations().forEach(a => a.cancel());
      t.animate([{ transform: 'scale(1.12,.9)' }, { transform: 'scale(.95,1.06)' }, { transform: 'scale(1.025,.98)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)' });
      if (pill) { pill.getAnimations().forEach(a => a.cancel()); pill.animate([{ transform: 'scale(1.025,.965)' }, { transform: 'scale(.99,1.02)' }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.3,1)' }); }
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }, { passive: true });

  /* ---------- scroll: if live refraction makes scrolling drop frames, use plain blur while moving ---------- */
  let scrollT = 0, frames = [], adaptive = false, lastF = 0, sampling = false;
  const sample = ts => { if (lastF) frames.push(ts - lastF); lastF = ts; if (frames.length < 24) requestAnimationFrame(sample); else { sampling = false; frames.sort((a, b) => a - b); if (frames[Math.floor(frames.length * .75)] > 24) adaptive = true; } };
  const onScroll = () => {
    if (mode !== 'full') return;
    if (!adaptive && !sampling && frames.length < 24) { sampling = true; lastF = 0; requestAnimationFrame(sample); }
    if (!adaptive) return;
    H.classList.add('lg-scrolling'); clearTimeout(scrollT); scrollT = setTimeout(() => H.classList.remove('lg-scrolling'), 200);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  /* ---------- watch for surfaces opening, closing and resizing ---------- */
  const ro = new ResizeObserver(soon);
  const watch = () => SURF.forEach(s => document.querySelectorAll(s.sel.replace('#big.show ', '#big ')).forEach(e => ro.observe(e)));
  const mo = new MutationObserver(ms => {
    let n = false, d = false;
    for (const m of ms) {
      const t = m.target;
      if (t.id === 'nav' || (t.parentElement && t.parentElement.id === 'nav') || (t.closest && t.closest('#nav'))) d = true;
      if (m.type === 'childList' && t.id === 'nav') { n = true; d = true; }
      if (t.matches && t.matches('#menu,#mod,#mb,#big,#mini,#setp,#qp')) n = true;
    }
    if (d) requestAnimationFrame(placeDrop);
    if (n) { watch(); soon(); }
  });
  const start = () => {
    /* Now Playing controls get a glass panel */
    const hl = document.querySelector('#big .bc > .hl'); if (hl && !hl.classList.contains('npp')) hl.classList.add('npp');
    apply(); watch(); coverTick(); placeDrop(); refresh();
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => { placeDrop(); soon(); });
    setInterval(coverTick, 1200);
    mq.addEventListener && mq.addEventListener('change', apply);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { apply, refresh, soon, svgOK: () => svgOK, live: () => [...live.keys()].map(e => e.id || e.className), mode: () => mode };
})();

/* range fill for the glass sliders */
const lgRange = e => { if (!e || e.type !== 'range') return; const mn = +e.min || 0, mx = +e.max || 100; e.style.setProperty('--v', ((e.value - mn) / (mx - mn) * 100) + '%'); };
document.addEventListener('input', e => lgRange(e.target), true);
setInterval(() => document.querySelectorAll('#vol,#setp input[type=range]').forEach(lgRange), 700);

/* Settings: Glass effects Full / Light / Off (in the Look group) */
window.glassRow = () => `<div class="li col"><div class="lt"><b>Glass effects</b><span>${LG.svgOK() ? 'Full bends light at the edges. Light is blur only.' : 'Full adds the deepest glass. Light is simpler, Off is solid.'}</span></div><div class="seg" role="group" data-seg="glass">${[['full', 'Full'], ['light', 'Light'], ['off', 'Off']].map(([v, t]) => `<button data-a="lgset" data-v="${v}" class="${(S.glass || 'full') === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>`;
Object.assign(A, { lgset: b => { S.glass = b.dataset.v; save('S', S); LG.apply(); settings(); } });
const _applyUIGlass = applyUI;
applyUI = function () { _applyUIGlass(); LG.apply(); };
