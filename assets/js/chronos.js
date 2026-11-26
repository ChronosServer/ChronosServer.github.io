(() => {
  document.documentElement.classList.add('js');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url) {
    const r = await fetch(url, {cache: 'no-cache'});
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    const lm = r.headers.get('Last-Modified');
    return {data: await r.json(), at: lm ? new Date(lm) : null};
  }
  function ago(d) {
    if (!d) return 'at an unknown time';
    const s = (Date.now() - d) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function stamp(el, at, maxHours = 12) {
    const stale = at && (Date.now() - at) / 36e5 > maxHours;
    el.className = 'pill' + (stale ? ' stale' : '');
    el.textContent = (stale ? 'Stale, synced ' : 'Synced ') + ago(at);
  }
  function fail(el, e) { el.innerHTML = '<div class="panel err">Could not load data. ' + esc(e.message) + '</div>'; }

  // scroll reveal: one entrance per element, added when it enters the viewport
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), {rootMargin: '0px 0px -10% 0px'});
  // Discord people (members.json, archive.json). Server nicknames can't be trusted (members
  // rename each other as a joke), so a person is their Discord user id, and their name is the
  // account's own: global display name, then username, the nickname only as a last resort.
  const person = {
    name: m => (m && (m.global_name || m.username || m.name)) || '',
    // members.json: `id` (a string: user ids don't fit a JS number, so a numeric one is useless
    // and ignored), or the user id inside the Discord avatar URL (/avatars/<id>/…, /users/<id>/…)
    id: m => (m && typeof m.id === 'string' && m.id ? m.id : ((/\/(?:avatars|users)\/(\d{15,21})\//.exec((m && m.avatar) || '') || [])[1] || null)),
  };
  window.C = {esc, json, ago, stamp, fail, person, reveal: el => io.observe(el)};

  // nav dropdowns. The menu is position:fixed (so the scrolling .links bar cannot clip it) and
  // placed under its button here. .nav has a backdrop-filter, which makes it the containing
  // block for fixed children; it sits at 0,0 so viewport coordinates still line up.
  document.querySelectorAll('.nav .dd').forEach(dd => {
    const btn = dd.querySelector('.dd-btn'), menu = dd.querySelector('.dd-menu');
    const links = dd.closest('.links');
    const items = () => [...menu.querySelectorAll('a')];
    const isOpen = () => !menu.hidden;
    function place() {
      if (!isOpen()) return;
      const r = btn.getBoundingClientRect(), w = menu.offsetWidth;
      menu.style.top = r.bottom + 'px';
      menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    }
    function open(focus) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      place();
      if (focus) { const l = items(); (focus === 'last' ? l[l.length - 1] : l[0]).focus(); }
    }
    function close(refocus) {
      if (!isOpen()) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
    // click also covers Enter and Space, which buttons turn into clicks
    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(e.key === 'ArrowUp' ? 'last' : 'first'); }
      else if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); }
    });
    menu.addEventListener('keydown', e => {
      const l = items(), i = l.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); l[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); l[l.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    dd.addEventListener('focusout', e => { if (!dd.contains(e.relatedTarget)) close(); });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) close(); });
    addEventListener('resize', place);
    if (links) links.addEventListener('scroll', place, {passive: true});
  });

  // narrow screens: the nav links scroll sideways with no scrollbar. Start with the current
  // page's link in view, and fade the right edge while more links are hidden there.
  const bar = document.querySelector('.nav .links');
  if (bar) {
    const nav = bar.closest('.nav');
    const edge = () => nav.classList.toggle('more-r', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
    const cur = bar.querySelector('[aria-current]');
    // run again once the web fonts are in: they make the links wider
    const center = () => {
      if (cur && bar.scrollWidth > bar.clientWidth) {
        const el = cur.closest('.dd') || cur;
        const r = el.getBoundingClientRect(), b = bar.getBoundingClientRect();
        bar.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
      }
      edge();
    };
    center();
    if (document.fonts) document.fonts.ready.then(center);
    bar.addEventListener('scroll', edge, {passive: true});
    addEventListener('resize', edge);
  }

  addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    if (!document.body.classList.contains('kind-home')) return;

    // home only: the photo dims as you scroll past the hero so the sections read on dark
    const dim = document.querySelector('.dim');
    if (dim) {
      let t = 0;
      const f = () => { t = 0; dim.style.opacity = Math.min(1, scrollY / (innerHeight * 0.7)).toFixed(3); };
      addEventListener('scroll', () => { t || (t = requestAnimationFrame(f)); }, {passive: true});
      f();
    }
    // home only: slight pointer parallax on the photo (desktop, motion allowed)
    if (matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)').matches) {
      const bg = document.querySelector('.bg');
      let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
      const tick = () => {
        x += (tx - x) * 0.08; y += (ty - y) * 0.08;
        bg.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
        raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(tick) : 0;
      };
      addEventListener('pointermove', e => {
        tx = (e.clientX / innerWidth - 0.5) * -16; ty = (e.clientY / innerHeight - 0.5) * -10;
        raf || (raf = requestAnimationFrame(tick));
      }, {passive: true});
    }
  });
})();
