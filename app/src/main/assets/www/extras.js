/* nortest 1.6.5 - small extras: select several songs at once, offline notice, "add to home screen" hint.
   (The launch splash lives in index.html so it shows before anything loads.)
   Stored: localStorage nortest_a2hs_hidden (the home-screen hint was closed). Nothing else. */
(() => {
  'use strict';
  const st = document.createElement('style');
  st.textContent = `
.xselb{background:none;border:0;padding:6px 4px;color:var(--lg-acc,var(--md-primary));font:600 14px var(--font);cursor:pointer}
.lmeta .xselb{margin-left:auto;margin-right:10px}
.acts .xselb.btn{padding:0 14px}
body.xsel #view .row[data-id]{padding-left:48px}
body.xsel #view .row[data-id]::before{content:"";position:absolute;left:14px;top:50%;width:20px;height:20px;margin-top:-11px;border-radius:50%;border:2px solid var(--md-outline);box-sizing:border-box;z-index:2}
body.xsel #view .row[data-id].xon::before{border-color:var(--lg-acc,var(--md-primary));background:var(--lg-acc,var(--md-primary)) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.4l4 4 8-8.6' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/14px no-repeat}
body.xsel #view .row[data-id] :is(.hrt,[data-a=dots],.spl,.spok){visibility:hidden}
body.xsel #mini{visibility:hidden}
#xbar{position:fixed;z-index:6;left:16px;right:16px;bottom:calc(14px + var(--nav-h,64px) + 10px + env(safe-area-inset-bottom));height:var(--mini-h,64px);display:none;align-items:center;gap:4px;padding:0 8px 0 18px;border-radius:30px;background:var(--lg-tint-strong,var(--md-surface-container-highest));-webkit-backdrop-filter:blur(var(--lg-blur,20px)) saturate(1.6);backdrop-filter:blur(var(--lg-blur,20px)) saturate(1.6);box-shadow:0 6px 24px rgba(0,0,0,.28);color:var(--lg-fg,var(--md-on-surface))}
body.xsel #xbar{display:flex}
#xbar b{flex:1;min-width:0;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
#xbar button{flex:none;height:40px;padding:0 9px;border:0;border-radius:20px;background:none;color:inherit;font:600 14px var(--font);cursor:pointer}
#xbar button.x{color:var(--lg-acc,var(--md-primary))}
#xbar button[disabled]{opacity:.4;pointer-events:none}
@media (min-width:700px){#xbar{left:256px}}
#offb{position:fixed;z-index:30;left:0;right:0;margin:0 auto;width:max-content;top:calc(env(safe-area-inset-top) + 10px);transform:translateY(-160%);max-width:min(92vw,420px);padding:9px 16px;border-radius:18px;background:var(--md-inverse-surface,#e2e3de);color:var(--md-inverse-on-surface,#2e312e);font-size:13px;font-weight:500;line-height:18px;text-align:center;transition:transform .45s var(--spring,ease);pointer-events:none}
#offb.show{transform:none}
.a2hs{display:flex;align-items:center;gap:12px;margin:2px 0 14px;padding:12px 8px 12px 16px;border-radius:20px;background:var(--md-surface-container-high);font-size:14px;line-height:19px}
.a2hs span{flex:1}.a2hs b{font-weight:600}
.a2hs button{flex:none;width:36px;height:36px;border:0;border-radius:50%;background:none;color:var(--md-on-surface-variant);font-size:20px;cursor:pointer}
.a2hs .btn{width:auto;border-radius:18px;font-size:13px;color:var(--md-on-secondary-container);background:var(--md-secondary-container);padding:0 14px}
`;
  document.head.appendChild(st);
  const T = {};
  const toast = m => { try { if (NN && NN.toast) return NN.toast(m); } catch (e) { } let t = document.querySelector('.toast.b1t'); if (!t) { t = document.createElement('div'); t.className = 'toast b1t'; document.body.appendChild(t); } t.textContent = m; t.classList.add('show'); clearTimeout(T.t); T.t = setTimeout(() => t.classList.remove('show'), 2400); };

  /* ---------- select several songs ---------- */
  const X = { on: false, ids: new Set() };
  const bar = document.createElement('div'); bar.id = 'xbar';
  document.body.appendChild(bar);
  const where = () => view === 'library' || view === 'favorites' || view === 'history' || (view === 'playlists' && sub && typeof cp === 'function' && cp());
  const order = () => [...document.querySelectorAll('#view .row[data-id]')].map(r => r.dataset.id).filter(id => X.ids.has(id));
  const paintBar = () => {
    const n = X.ids.size, all = document.querySelectorAll('#view .row[data-id]').length;
    bar.innerHTML = `<b data-a="xall" title="Select all">${n ? n + ' selected' : 'Tap songs'}</b><button data-a="xplay" ${n ? '' : 'disabled'}>Play</button><button data-a="xq" ${n ? '' : 'disabled'}>Queue</button><button data-a="xpl" ${n ? '' : 'disabled'}>Add</button><button class="x" data-a="xdone">Done</button>`;
  };
  const paintRows = () => document.querySelectorAll('#view .row[data-id]').forEach(r => r.classList.toggle('xon', X.ids.has(r.dataset.id)));
  const enter = () => { X.on = true; X.ids.clear(); document.body.classList.add('xsel'); paintBar(); paintRows(); };
  const exit = () => { if (!X.on) return; X.on = false; X.ids.clear(); document.body.classList.remove('xsel'); paintRows(); };
  document.addEventListener('click', e => {
    if (!X.on) return;
    const row = e.target.closest('#view .row[data-id]');
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    const id = row.dataset.id;
    X.ids.has(id) ? X.ids.delete(id) : X.ids.add(id);
    row.classList.toggle('xon', X.ids.has(id)); paintBar();
  }, true);
  const _render = render;
  render = function () {
    const r = _render.apply(this, arguments);
    if (X.on && !where()) exit();
    if (where()) {
      const host = document.querySelector('#view .lmeta') || document.querySelector('#view .phead .acts') || document.querySelector('#view .lbar') || document.querySelector('#view .chips');
      if (host && document.querySelector('#view .row[data-id]') && !host.querySelector('.xselb')) {
        const b = document.createElement('button'); b.className = host.classList.contains('acts') ? 'btn text xselb' : 'xselb'; b.dataset.a = 'xsel'; b.textContent = 'Select';
        host.classList.contains('lmeta') ? host.insertBefore(b, host.querySelector('select')) : host.appendChild(b);
      }
      if (X.on) { paintRows(); paintBar(); }
    }
    return r;
  };
  const addToPl = async (p, ids) => { let n = 0; for (const id of ids) if (!p.songs.includes(id)) { p.songs.push(id); n++; } await put('playlists', p); return n; };
  Object.assign(A, {
    xsel: () => X.on ? exit() : enter(),
    xdone: exit,
    xall: () => { const rows = [...document.querySelectorAll('#view .row[data-id]')]; if (X.ids.size === rows.length) X.ids.clear(); else rows.forEach(r => X.ids.add(r.dataset.id)); paintRows(); paintBar(); },
    xplay: () => { const ids = order(); exit(); if (ids.length) playList(ids); },
    xq: () => { const ids = order(); if (!ids.length) return; const empty = qi < 0 || !queue.length; queue.push(...ids); empty ? load(queue.length - ids.length, false) : refreshQ(); exit(); toast(ids.length === 1 ? 'Added to queue' : ids.length + ' songs added to queue'); },
    xpl: () => {
      const n = X.ids.size;
      mod(`<h3>Add ${n === 1 ? '1 song' : n + ' songs'} to</h3><div class="mlist">${pls.filter(p => !(sub && p.id === sub && view === 'playlists')).map(p => `<button class="btn wide" data-a="xpin" data-p="${p.id}">${esc(p.name)}</button>`).join('')}</div><input id="xpn" placeholder="New playlist name"><div class="mrow"><button class="btn" data-a="mx">Cancel</button><button class="btn pri" data-a="xpnew">Create playlist</button></div>`);
    },
    xpin: async b => { const p = pls.find(x => x.id === b.dataset.p); if (!p) return; const ids = order(); const n = await addToPl(p, ids); closeMod(); exit(); render(); toast(n ? `Added ${n === 1 ? '1 song' : n + ' songs'} to ${p.name}` : 'Already in ' + p.name); },
    xpnew: async () => { const ids = order(); const p = { id: crypto.randomUUID(), name: ($('#xpn').value || '').trim() || 'New playlist', songs: [...new Set(ids)] }; pls.push(p); await put('playlists', p); closeMod(); exit(); render(); toast('Playlist created'); }
  });
  const _nav = A.nav; A.nav = (...a) => { exit(); return _nav(...a); };
  const _back = A.back; A.back = (...a) => { exit(); return _back(...a); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && X.on) { e.stopImmediatePropagation(); exit(); } }, true);

  /* ---------- offline notice ---------- */
  const ob = document.createElement('div'); ob.id = 'offb'; ob.setAttribute('role', 'status');
  ob.textContent = "You're offline. Songs on your phone still play. Radio and streaming need internet.";
  document.body.appendChild(ob);
  let obT = 0;
  const net = () => {
    clearTimeout(obT);
    if (!navigator.onLine) ob.classList.add('show');
    else if (ob.classList.contains('show')) { ob.textContent = 'Back online'; obT = setTimeout(() => { ob.classList.remove('show'); setTimeout(() => ob.textContent = "You're offline. Songs on your phone still play. Radio and streaming need internet.", 500); }, 1600); }
  };
  addEventListener('offline', net); addEventListener('online', net);
  if (!navigator.onLine) net();

  /* ---------- "put it on your home screen" hint (website only, until closed) ---------- */
  const A2K = 'nortest_a2hs_hidden';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let canPrompt = false;
  addEventListener('beforeinstallprompt', () => { canPrompt = true; if (view === 'library') render(); });
  addEventListener('appinstalled', () => { canPrompt = false; try { localStorage.setItem(A2K, '1'); } catch (e) { } render(); });
  const showA2 = () => !NN && !standalone && !(() => { try { return localStorage.getItem(A2K); } catch (e) { return 1; } })() && (isIOS || canPrompt);
  const _r2 = render;
  render = function () {
    const r = _r2.apply(this, arguments);
    if (view === 'library' && !sub && showA2() && !document.querySelector('#view .a2hs')) {
      const d = document.createElement('div'); d.className = 'a2hs';
      d.innerHTML = isIOS ? '<span>Put Nortest on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</span><button data-a="a2x" aria-label="Close">&times;</button>'
        : '<span>Put Nortest on your home screen so it opens like an app.</span><button class="btn" data-a="a2go">Install</button><button data-a="a2x" aria-label="Close">&times;</button>';
      const pt = document.querySelector('#view .pt'); pt ? pt.after(d) : document.querySelector('#view').prepend(d);
    }
    return r;
  };
  Object.assign(A, {
    a2x: () => { try { localStorage.setItem(A2K, '1'); } catch (e) { } document.querySelectorAll('.a2hs').forEach(x => x.remove()); },
    a2go: () => { const b = document.getElementById('installBtn'); if (b) b.click(); }
  });
  render();
})();
