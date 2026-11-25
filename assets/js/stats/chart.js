/* S.chart(el, opts): SVG step chart with split time axis, hover and keyboard tooltips.
 *
 * Classes emitted (styled in assets/css/stats.css):
 *   .st-chart        wrapper div (position:relative set inline)
 *   svg.st-plot      the chart (focusable, tabindex=0)
 *   .st-grid         horizontal gridlines      .st-axis    axis label text (y and x)
 *   rect.st-zone     shaded BACKUPS span       .st-zonel   zone labels (.st-zonel-live for LIVE)
 *   path.st-line     one per series (stroke = series color)
 *   path.st-area     fill under the line, only when there is exactly one series
 *   circle.st-dot    imported points (t < liveAt)
 *   line.st-cross    hover crosshair           circle.st-mark  hover marker per series
 *   .st-tip          HTML tooltip; .st-tip-date, .st-tip-row, .st-tip-key (swatch), .st-tip-val
 *   .st-empty        empty state (no svg)
 *   .st-valuecard    single-point fallback; .st-vc-row, .st-vc-label, .st-vc-val, .st-vc-date
 * Series colors go in as presentation attributes so CSS can still restyle.
 * Value axis (S.cm.yDomain): opts.zero (default true) keeps 0 on the axis, for all-time
 * totals; zero:false starts at a nice value below the visible data, so a short range shows
 * the change. opts.axis(maxAbsRaw) -> {div, suffix, minStep} (S.fmt.axisUnit) puts the ticks
 * on nice numbers in display units ("41,800 h"); without it ticks are raw and use opts.format.
 * The viewBox width follows the wrapper's content width (ResizeObserver, debounced), so one
 * unit is one CSS pixel and axis text stays readable on phones; 1000 when it can't be measured.
 */
(function (root) {
  const S = root.S = root.S || {};
  const NS = 'http://www.w3.org/2000/svg';
  const W_DEFAULT = 1000, W_MIN = 240, PAD_L = 58, PAD_B = 26, PAD_T = 14;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = 86400, YEAR = 365.25 * DAY;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n1 = v => String(+v.toFixed(1));

  function fmtDate(t) {
    if (S.fmt && S.fmt.date) return S.fmt.date(t);
    return new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const hhmm = t => { const d = new Date(t * 1000); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  const dayLabel = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const unix = d => d.getTime() / 1000;

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // X tick labels for [t0, t1] drawn into `px` pixels (viewBox units).
  // > 2 years: years; >= 2 days (or `days` forced): days ("24 Nov"), month starts when crowded; else hours.
  function ticks(t0, t1, px, days) {
    const max = Math.max(1, Math.floor(px / 75)), span = t1 - t0, out = [];
    const pick = (list, steps) => {
      for (const s of steps) { const l = list.filter((_, i) => i % s === 0); if (l.length <= max) return l; }
      return list.filter((_, i) => i % steps[steps.length - 1] === 0).slice(0, max);
    };
    if (span > 2 * YEAR) {
      const list = [];
      for (let y = new Date(t0 * 1000).getFullYear() + 1; ; y++) {
        const t = unix(new Date(y, 0, 1)); if (t > t1) break; list.push({ t, label: String(y) });
      }
      return pick(list, [1, 2, 5, 10, 20]);
    }
    if (span >= 2 * DAY || days) {
      const list = [], d = new Date(t0 * 1000); d.setHours(0, 0, 0, 0);
      while (unix(d) < t0) d.setDate(d.getDate() + 1);
      while (unix(d) <= t1 && list.length < 800) { list.push({ t: unix(d), label: dayLabel(d) }); d.setDate(d.getDate() + 1); }
      for (const s of [1, 2, 3, 7, 14]) { const l = list.filter((_, i) => i % s === 0); if (l.length <= max) return l; }
      const months = list.filter(x => new Date(x.t * 1000).getDate() === 1);
      return pick(months, [1, 2, 3, 6, 12]);
    }
    const list = [], d = new Date(t0 * 1000); d.setMinutes(0, 0, 0);
    while (unix(d) < t0) d.setHours(d.getHours() + 1);
    while (unix(d) <= t1 && list.length < 100) { list.push({ t: unix(d), label: hhmm(unix(d)) }); d.setHours(d.getHours() + 1); }
    for (const s of [1, 2, 3, 6, 12]) {
      const l = list.filter(x => new Date(x.t * 1000).getHours() % s === 0); if (l.length <= max) return l;
    }
    return list.filter(x => new Date(x.t * 1000).getHours() === 0);
  }

  function clean(points) {
    return (points || []).filter(p => p && isFinite(p[0]) && isFinite(p[1])).slice().sort((a, b) => a[0] - b[0]);
  }

  S.chart = function (el, initial) {
    const cm = S.cm;
    let opts = null, first = true, model = null, idx = -1, W = W_DEFAULT, ro = null, roTimer = null;

    const wrap = document.createElement('div');
    wrap.className = 'st-chart';
    wrap.style.position = 'relative';
    el.appendChild(wrap);

    // Content-box width of the wrapper in CSS px, or null when not laid out (hidden, detached).
    function measure() {
      const cw = wrap.clientWidth;
      if (!cw) return null;
      const cs = root.getComputedStyle ? root.getComputedStyle(wrap) : null;
      const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      const w = Math.round(cw - padX);
      return w > 0 ? Math.max(W_MIN, w) : null;
    }

    function render() {
      W = measure() || W_DEFAULT;
      const height = opts.height || 300;
      const from = +opts.from, to = +opts.to > +opts.from ? +opts.to : +opts.from + 1;
      const format = opts.format || (v => String(v));
      const raw = (opts.series || []).map(s => Object.assign({}, s, { points: clean(s.points) }));
      // Trim leading zeros first, so a series that only starts counting late collapses to one point.
      const live = raw.filter(s => s.points.length).map(s => Object.assign({}, s, { points: cm.trimLeading(s.points) }));
      const hadFocus = !!(model && document.activeElement === model.svg);
      model = null; idx = -1;

      if (!live.length) {
        wrap.innerHTML = '<div class="st-empty">' + esc(opts.emptyText || 'No data for this range.') + '</div>';
        return;
      }
      if (live.every(s => s.points.length === 1)) {
        wrap.innerHTML = '<div class="st-valuecard">' + live.map(s => {
          const p = s.points[0];
          return '<div class="st-vc-row"><span class="st-vc-label">' + esc(s.label) + '</span> <span class="st-vc-val">' +
            esc(format(p[1])) + '</span> <span class="st-vc-date">' + esc(fmtDate(p[0])) + '</span></div>';
        }).join('') + '</div>';
        return;
      }

      const series = live;
      const bot = height - PAD_B, top = PAD_T;
      const tx = cm.timeScale(from, to, opts.liveAt == null ? null : +opts.liveAt, PAD_L, W);
      const x = t => tx(Math.max(from, Math.min(to, t)));
      // y range over what is visible: the value carried into `from`, then points up to `to`
      const zero = opts.zero !== false;
      let lo = Infinity, hi = -Infinity;
      for (const s of series) {
        const c = cm.valueAt(s.points, from);
        if (c != null) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
        for (const p of s.points) if (p[0] >= from && p[0] <= to) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
      }
      if (!isFinite(lo)) { lo = 0; hi = 0; }
      if (!zero) {
        // points before `from` would sit below a raised axis: start each line at its carried value
        for (const s of series) {
          const c = cm.valueAt(s.points, from), rest = s.points.filter(p => p[0] > from);
          s.points = c == null ? rest : [[from, c]].concat(rest);
        }
      }
      const unit = (opts.axis && opts.axis(Math.max(Math.abs(lo), Math.abs(hi)))) || { div: 1, suffix: null, minStep: 0 };
      const dom = cm.yDomain(lo / unit.div, hi / unit.div, { zero, minStep: unit.minStep });
      const y = v => bot - (v / unit.div - dom.min) / ((dom.max - dom.min) || 1) * (bot - top);
      const tickLabel = t => (opts.axis && S.fmt && S.fmt.tick ? S.fmt.tick(t, dom.step, unit.suffix, Math.max(Math.abs(dom.min), Math.abs(dom.max))) : format(t * unit.div));

      let g = '';
      if (tx.split != null) {
        g += '<rect class="st-zone" x="' + PAD_L + '" y="' + top + '" width="' + n1(tx.split - PAD_L) + '" height="' + (bot - top) + '" fill="rgba(229,169,60,.05)"/>' +
          '<text class="st-zonel" x="' + (PAD_L + 8) + '" y="' + (top + 14) + '" fill="var(--amber)">BACKUPS</text>' +
          '<text class="st-zonel st-zonel-live" x="' + n1(tx.split + 8) + '" y="' + (top + 14) + '" fill="var(--teal)">LIVE · EVERY 15 MIN</text>';
      }
      for (const t of dom.ticks) {
        const yy = n1(y(t * unit.div));
        g += '<line class="st-grid" x1="' + PAD_L + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="currentColor" stroke-opacity=".08"/>' +
          '<text class="st-axis" x="' + (PAD_L - 8) + '" y="' + n1(+yy + 4) + '" text-anchor="end" fill="currentColor">' + esc(tickLabel(t)) + '</text>';
      }
      const segs = tx.split != null ? [[from, +opts.liveAt], [+opts.liveAt, to]] : [[from, to]];
      let lastX = -Infinity;
      segs.forEach(([a, b], i) => {
        for (const k of ticks(a, b, x(b) - x(a), i === 1)) {
          const xx = x(k.t);
          if (xx < PAD_L + 18 || xx > W - 18 || xx - lastX < 60) continue;
          lastX = xx;
          g += '<text class="st-axis" x="' + n1(xx) + '" y="' + (height - 6) + '" text-anchor="middle" fill="currentColor">' + esc(k.label) + '</text>';
        }
      });
      if (series.length === 1) {
        const s = series[0], d = cm.stepPath(s.points, x, y, to);
        g += '<path class="st-area" d="' + d + 'V' + n1(bot) + 'H' + n1(x(s.points[0][0])) + 'Z" fill="' + esc(s.color) + '" fill-opacity=".08" stroke="none"/>';
      }
      for (const s of series) {
        g += '<path class="st-line" data-id="' + esc(s.id) + '" d="' + cm.stepPath(s.points, x, y, to) + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="2"/>';
      }
      if (tx.split != null) {
        for (const s of series) for (const p of s.points) {
          if (p[0] < +opts.liveAt && p[0] >= from && p[0] <= to) {
            g += '<circle class="st-dot" cx="' + n1(x(p[0])) + '" cy="' + n1(y(p[1])) + '" r="3" fill="' + esc(s.color) + '"/>';
          }
        }
      }
      g += '<line class="st-cross" x1="0" x2="0" y1="' + top + '" y2="' + bot + '" stroke="currentColor" stroke-opacity=".35" visibility="hidden"/>';
      for (const s of series) g += '<circle class="st-mark" r="4" fill="' + esc(s.color) + '" visibility="hidden"/>';

      const label = series.map(s => s.label).join(', ');
      wrap.innerHTML = '<svg class="st-plot" xmlns="' + NS + '" viewBox="0 0 ' + W + ' ' + height + '" width="100%" style="display:block;height:auto;overflow:visible" tabindex="0" role="img" aria-label="' +
        esc('Chart: ' + label + '. Use arrow keys to step through changes.') + '">' + g + '</svg>' +
        '<div class="st-tip" role="status" aria-live="polite" hidden style="position:absolute;top:0;left:0;pointer-events:none;display:none"></div>';

      const cps = cm.changePoints(series.map(s => s.points)).filter(t => t >= from && t <= to);
      model = { series, x, tx, y, from, to, format, cps, short: to - from < 2 * DAY,
        svg: wrap.querySelector('svg'), tip: wrap.querySelector('.st-tip'),
        cross: wrap.querySelector('.st-cross'), marks: wrap.querySelectorAll('.st-mark') };

      if (hadFocus) model.svg.focus();
      if (first) { first = false; if (!reducedMotion()) drawIn(); }
    }

    function drawIn() {
      wrap.querySelectorAll('path.st-line').forEach(p => {
        if (!p.animate || !p.getTotalLength) return;
        const len = p.getTotalLength();
        if (!(len > 0)) return;
        p.animate([{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }],
          { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }

    function show(t) {
      const m = model; if (!m) return;
      const xx = m.x(t);
      m.cross.setAttribute('x1', n1(xx)); m.cross.setAttribute('x2', n1(xx));
      m.cross.setAttribute('visibility', 'visible');
      let rows = '';
      m.series.forEach((s, i) => {
        const v = S.cm.valueAt(s.points, t), mk = m.marks[i];
        if (v == null) { mk.setAttribute('visibility', 'hidden'); }
        else { mk.setAttribute('cx', n1(xx)); mk.setAttribute('cy', n1(m.y(v))); mk.setAttribute('visibility', 'visible'); }
        rows += '<div class="st-tip-row"><i class="st-tip-key" style="background:' + esc(s.color) + '"></i>' +
          '<span class="st-tip-label">' + esc(s.label) + '</span>: <span class="st-tip-val">' + esc(v == null ? '–' : m.format(v)) + '</span></div>';
      });
      m.tip.innerHTML = '<div class="st-tip-date">' + esc(fmtDate(t) + (m.short ? ' · ' + hhmm(t) : '')) + '</div>' + rows;
      m.tip.hidden = false; m.tip.style.display = '';
      const sr = m.svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      const px = sr.left - wr.left + xx * sr.width / W;
      const right = px > wr.width / 2;
      m.tip.style.left = px + 'px';
      m.tip.style.top = (sr.top - wr.top + 8) + 'px';
      m.tip.style.transform = right ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)';
    }

    function hide() {
      const m = model; if (!m) return;
      m.tip.hidden = true; m.tip.style.display = 'none';
      m.cross.setAttribute('visibility', 'hidden');
      m.marks.forEach(mk => mk.setAttribute('visibility', 'hidden'));
    }

    function onMove(e) {
      const m = model; if (!m) return;
      const r = m.svg.getBoundingClientRect();
      if (!r.width) return;
      const vx = (e.clientX - r.left) * W / r.width;
      const vy = (e.clientY - r.top) * W / r.width;
      if (vx < PAD_L || vx > W || vy < 0 || vy > r.height * W / r.width) { hide(); return; }
      idx = -1;
      show(m.tx.invert(vx));
    }

    function onKey(e) {
      const m = model; if (!m || !m.cps.length || e.target !== m.svg) return;
      const n = m.cps.length;
      if (e.key === 'ArrowRight') idx = Math.min(n - 1, idx + 1);
      else if (e.key === 'ArrowLeft') idx = idx < 0 ? n - 1 : Math.max(0, idx - 1);
      else if (e.key === 'Home') idx = 0;
      else if (e.key === 'End') idx = n - 1;
      else if (e.key === 'Escape') { idx = -1; hide(); return; }
      else return;
      e.preventDefault();
      show(m.cps[idx]);
    }

    function onBlur(e) { if (model && e.target === model.svg) { idx = -1; hide(); } }

    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', hide);
    wrap.addEventListener('keydown', onKey);
    wrap.addEventListener('focusout', onBlur);
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(() => {
        clearTimeout(roTimer);
        roTimer = setTimeout(() => {
          const w = measure();
          if (opts && w && w !== W) render();
        }, 150);
      });
      ro.observe(wrap);
    }

    opts = Object.assign({}, initial);
    render();

    return {
      update(next) { opts = Object.assign({}, opts, next); render(); },
      destroy() {
        wrap.removeEventListener('mousemove', onMove);
        wrap.removeEventListener('mouseleave', hide);
        wrap.removeEventListener('keydown', onKey);
        wrap.removeEventListener('focusout', onBlur);
        if (ro) ro.disconnect();
        clearTimeout(roTimer);
        wrap.remove();
        model = null;
      }
    };
  };

  if (typeof module !== 'undefined') module.exports = S.chart;
})(typeof window !== 'undefined' ? window : globalThis);
