/* S.act.bin(buckets, bucketSeconds, to, tz?): bin sparse activity buckets into an
 * hour-of-day profile and a weekday x hour grid in the viewer's local time.
 * Slots run from the first bucket to `to` (exclusive); missing slots count as 0. */
(function (root) {
  const S = root.S = root.S || {};

  const CAP_DAYS = 60;

  function localTz(t) {
    const d = new Date(t * 1000);
    return { day: (d.getDay() + 6) % 7, hour: d.getHours(), date: d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate() };
  }

  function bin(buckets, bucketSeconds, to, tz) {
    const f = tz || localTz;
    const hours = new Array(24).fill(0);
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const empty = { hours, grid, days: 0, filled: false };
    if (!Array.isArray(buckets) || !buckets.length || !(bucketSeconds > 0)) return empty;
    const vals = new Map();
    let first = Infinity;
    for (const b of buckets) {
      const t = Number(b && b[0]), n = Number(b && b[1]);
      if (!isFinite(t) || !isFinite(n)) continue;
      vals.set(t, (vals.get(t) || 0) + n);
      if (t < first) first = t;
    }
    if (first === Infinity) return empty;
    let last = -Infinity;
    for (const t of vals.keys()) if (t > last) last = t;
    const end = isFinite(to) ? Math.max(to, first + bucketSeconds) : last + bucketSeconds;
    const hSum = new Array(24).fill(0), hCnt = new Array(24).fill(0);
    const gSum = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const gCnt = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const dates = new Set();
    const cap = Math.ceil(CAP_DAYS * 86400 / bucketSeconds);
    let start = first;
    if ((end - first) / bucketSeconds > cap) start = first + Math.ceil((end - cap * bucketSeconds - first) / bucketSeconds) * bucketSeconds;
    for (let t = start; t < end; t += bucketSeconds) {
      const v = vals.get(t) || 0, z = f(t);
      hSum[z.hour] += v; hCnt[z.hour]++;
      gSum[z.day][z.hour] += v; gCnt[z.day][z.hour]++;
      if (vals.has(t)) dates.add(z.date !== undefined ? z.date : z.day + ':' + Math.floor(t / 86400));
    }
    for (let h = 0; h < 24; h++) {
      hours[h] = hCnt[h] ? hSum[h] / hCnt[h] : 0;
      for (let d = 0; d < 7; d++) grid[d][h] = gCnt[d][h] ? gSum[d][h] / gCnt[d][h] : 0;
    }
    return { hours, grid, days: dates.size, filled: dates.size >= 7 };
  }

  S.act = { bin };
  if (typeof module !== 'undefined') module.exports = S.act;
})(typeof window !== 'undefined' ? window : globalThis);
