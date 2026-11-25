/* S.viz.clock(el, hours, {now}) and S.viz.heatmap(el, grid): hand-drawn SVG.
 * Classes (styled in stats.css): .st-viz (svg), .st-clock-seg, .st-clock-idle, .st-clock-ring,
 * .st-clock-now, .st-clock-sub, .st-axis, .st-heat-cell, .st-heat-day.
 * All text is fixed labels or numbers, nothing from the API. */
(function (root) {
  const S = root.S = root.S || {};
  const NS = 'http://www.w3.org/2000/svg';
  const pad2 = n => String(n).padStart(2, '0');
  const num = v => (isFinite(v) && v > 0 ? Number(v) : 0);
  const avgText = v => (Math.round(v * 10) / 10).toString();
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function mk(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function svg(el, vb, label) {
    const s = mk('svg', { class: 'st-viz', viewBox: vb, role: 'img', 'aria-label': label });
    el.textContent = '';
    el.appendChild(s);
    return s;
  }

  function clock(el, hours, opts) {
    const now = (opts && opts.now) || new Date();
    const v = Array.from({ length: 24 }, (_, i) => num(hours && hours[i]));
    const mx = Math.max(...v);
    const size = 340, c = size / 2, r0 = size * 0.2, r1 = size * 0.46;
    let bi = 0;
    for (let h = 1; h < 24; h++) if (v[h] > v[bi]) bi = h;
    const label = mx > 0
      ? `Busiest hour: ${pad2(bi)}:00, ${avgText(v[bi])} players on average`
      : 'No player activity recorded yet';
    const s = svg(el, `-16 -16 ${size + 32} ${size + 32}`, label);
    s.appendChild(mk('circle', { class: 'st-clock-ring', cx: c, cy: c, r: r1, fill: 'none', stroke: 'rgba(235,232,230,.08)' }));
    s.appendChild(mk('circle', { class: 'st-clock-ring', cx: c, cy: c, r: r0, fill: 'none', stroke: 'rgba(235,232,230,.14)' }));
    const p = (a, r) => `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`;
    for (let h = 0; h < 24; h++) {
      const a0 = (h / 24) * 2 * Math.PI - Math.PI / 2 + 0.02;
      const a1 = ((h + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.02;
      const ratio = mx > 0 ? v[h] / mx : 0;
      const rr = r0 + (r1 - r0) * ratio;
      let seg;
      if (v[h] > 0) {
        seg = mk('path', {
          class: 'st-clock-seg', fill: 'var(--teal)', opacity: (0.45 + 0.55 * ratio).toFixed(3),
          d: `M${p(a0, r0)}L${p(a0, rr)}A${rr},${rr} 0 0 1 ${p(a1, rr)}L${p(a1, r0)}A${r0},${r0} 0 0 0 ${p(a0, r0)}Z`
        });
      } else {
        seg = mk('path', { class: 'st-clock-seg st-clock-idle', stroke: 'rgba(235,232,230,.25)', fill: 'none', d: `M${p(a0, r0)}L${p(a0, r0 + 3)}` });
      }
      seg.appendChild(mk('title', {}, `${pad2(h)}:00, ${avgText(v[h])} players on average`));
      s.appendChild(seg);
      if (h % 6 === 0) {
        s.appendChild(mk('text', {
          class: 'st-axis', 'text-anchor': 'middle',
          x: (c + (r1 + 12) * Math.cos(a0 + 0.13)).toFixed(1),
          y: (c + (r1 + 12) * Math.sin(a0 + 0.13) + 4).toFixed(1)
        }, pad2(h)));
      }
    }
    s.appendChild(mk('text', { class: 'st-clock-now', x: c, y: c - 2, 'text-anchor': 'middle' }, `${pad2(now.getHours())}:00`));
    s.appendChild(mk('text', { class: 'st-axis st-clock-sub', x: c, y: c + 14, 'text-anchor': 'middle' }, 'your time'));
    return s;
  }

  function heatmap(el, grid) {
    const g = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => num(grid && grid[d] && grid[d][h])));
    let mx = 0, bd = 0, bh = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (g[d][h] > mx) { mx = g[d][h]; bd = d; bh = h; }
    const label = mx > 0
      ? `Busiest slot: ${DAYS[bd]} ${pad2(bh)}:00, ${avgText(mx)} players on average`
      : 'No player activity recorded yet';
    const LW = 34, TH = 18, CW = 28, CH = 24, GAP = 2;
    const s = svg(el, `0 0 ${LW + 24 * CW} ${TH + 7 * CH}`, label);
    for (let h = 0; h < 24; h += 6) s.appendChild(mk('text', { class: 'st-axis', x: LW + h * CW, y: 11 }, pad2(h)));
    for (let d = 0; d < 7; d++) {
      s.appendChild(mk('text', { class: 'st-axis st-heat-day', x: 0, y: TH + d * CH + CH / 2 + 4 }, DAYS[d]));
      for (let h = 0; h < 24; h++) {
        const val = g[d][h];
        const r = mk('rect', {
          class: 'st-heat-cell', x: LW + h * CW + GAP / 2, y: TH + d * CH + GAP / 2,
          width: CW - GAP, height: CH - GAP, rx: 2,
          fill: val > 0 ? 'var(--teal)' : 'rgba(235,232,230,.05)',
          opacity: val > 0 ? (0.15 + 0.85 * val / mx).toFixed(3) : 1
        });
        r.appendChild(mk('title', {}, `${DAYS[d]} ${pad2(h)}:00, ${avgText(val)} players on average`));
        s.appendChild(r);
      }
    }
    return s;
  }

  S.viz = { clock, heatmap };
  if (typeof module !== 'undefined') module.exports = S.viz;
})(typeof window !== 'undefined' ? window : globalThis);
