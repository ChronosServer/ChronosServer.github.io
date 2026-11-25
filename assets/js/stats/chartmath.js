/* S.cm: pure chart maths (scales, step paths, lookups). No DOM. */
(function (root) {
  const S = root.S = root.S || {};

  // Time -> x. When liveAt falls strictly inside (t0, t1) the axis is split:
  // [t0, liveAt] takes the first 45% of [x0, x1], [liveAt, t1] the rest.
  function timeScale(t0, t1, liveAt, x0, x1) {
    const span = (t1 - t0) || 1;
    let fn, inv, split = null;
    if (liveAt != null && t0 < liveAt && liveAt < t1) {
      split = x0 + (x1 - x0) * 0.45;
      fn = t => t <= liveAt
        ? x0 + (t - t0) / (liveAt - t0) * (split - x0)
        : split + (t - liveAt) / (t1 - liveAt) * (x1 - split);
      inv = x => x <= split
        ? t0 + (x - x0) / (split - x0) * (liveAt - t0)
        : liveAt + (x - split) / (x1 - split) * (t1 - liveAt);
    } else {
      fn = t => x0 + (t - t0) / span * (x1 - x0);
      inv = x => t0 + (x - x0) / ((x1 - x0) || 1) * span;
    }
    fn.split = split;
    fn.invert = inv;
    return fn;
  }

  // Smallest 1/2/2.5/5 x 10^k that is >= v. Non-positive -> 1.
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const base = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) {
      const n = +(m * base).toPrecision(12);
      if (n >= v) return n;
    }
    return +(10 * base).toPrecision(12);
  }

  // Drop leading zero points; an all-zero series keeps only its last point.
  function trimLeading(points) {
    if (!points.length) return [];
    const i = points.findIndex(p => p[1] !== 0);
    return i === -1 ? [points[points.length - 1]] : points.slice(i);
  }

  const n1 = v => String(+v.toFixed(1));

  // Step-after path, extended horizontally to tEnd.
  function stepPath(points, x, y, tEnd) {
    if (!points.length) return '';
    let d = 'M' + n1(x(points[0][0])) + ',' + n1(y(points[0][1]));
    for (let i = 1; i < points.length; i++) d += 'H' + n1(x(points[i][0])) + 'V' + n1(y(points[i][1]));
    return d + 'H' + n1(x(tEnd));
  }

  // Value of a step-after series at t (points sorted by time); null before the first point.
  function valueAt(points, t) {
    let v = null;
    for (const p of points) { if (p[0] <= t) v = p[1]; else break; }
    return v;
  }

  // Sorted unique timestamps across all series.
  function changePoints(seriesList) {
    const set = new Set();
    for (const pts of seriesList) for (const p of pts) set.add(p[0]);
    return [...set].sort((a, b) => a - b);
  }

  // Smallest 1/2/2.5/5 x 10^k that is >= v (and >= minStep); 2.5 only from 25 up, so
  // whole-number units keep whole-number steps.
  function niceStep(v, minStep) {
    v = Math.max(v, minStep || 0);
    if (!(v > 0)) return minStep || 1;
    const base = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of base >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10]) {
      const n = +(m * base).toPrecision(12);
      if (n >= v - 1e-12 * base) return n;
    }
    return +(10 * base).toPrecision(12);
  }

  // Value axis for data spanning [lo, hi] (in display units). zero: the axis includes 0
  // (all-time totals); otherwise it starts at a nice step below the smallest visible value,
  // so a short range shows the actual change. Returns {min, max, step, ticks}, 2..7 ticks.
  function yDomain(lo, hi, opts) {
    const o = opts || {};
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 0; }
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    if (o.zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (hi === lo) {
      if (hi === 0) hi = Math.max(1, o.minStep || 0);
      else {
        const pad = Math.abs(hi) * 0.05;
        if (o.zero && lo === 0) hi += pad; else { lo -= pad; hi += pad; }
      }
    }
    let step = niceStep((hi - lo) / 4, o.minStep);
    let min, max;
    for (;;) {
      min = Math.floor(lo / step + 1e-9) * step;
      max = Math.ceil(hi / step - 1e-9) * step;
      if (max === min) max = min + step;
      if ((max - min) / step <= 6) break;
      step = niceStep(step * 1.01, o.minStep);
    }
    // data close to 0 above it: start at 0 rather than a step just above it
    if (!o.zero && min > 0 && min <= step) min = 0;
    const ticks = [];
    for (let v = min; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
    return { min: +min.toPrecision(12), max: +max.toPrecision(12), step, ticks };
  }

  S.cm = { timeScale, niceMax, niceStep, yDomain, trimLeading, stepPath, valueAt, changePoints };
  if (typeof module !== 'undefined') module.exports = S.cm;
})(typeof window !== 'undefined' ? window : globalThis);
