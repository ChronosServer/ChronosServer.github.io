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
  window.C = {esc, json, ago, stamp, fail, reveal: el => io.observe(el)};

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
