const { test } = require('node:test');
const assert = require('node:assert/strict');
const act = require('../../assets/js/stats/activity.js');

const utc = t => { const d = new Date(t * 1000); return { day: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours(), date: Math.floor(t / 86400) }; };
const MON10 = Date.UTC(2026, 10, 23, 10, 0, 0) / 1000; // Monday 23 Nov 2026

test('missing slot counts as zero and is averaged', () => {
  const r = act.bin([[MON10, 4]], 900, MON10 + 1800, utc);
  assert.equal(r.hours[10], 4 / 2);
  assert.equal(r.grid[0][10], 2);
  assert.equal(r.days, 1);
  assert.equal(r.filled, false);
});

test('8 days of slots is filled', () => {
  const b = []; for (let i = 0; i < 8; i++) b.push([MON10 + i * 86400, 1]);
  const r = act.bin(b, 900, MON10 + 7 * 86400 + 900, utc);
  assert.equal(r.days, 8);
  assert.equal(r.filled, true);
});

test('empty buckets give zeros', () => {
  const r = act.bin([], 900, MON10, utc);
  assert.equal(r.days, 0);
  assert.equal(r.filled, false);
  assert.equal(r.hours.length, 24);
  assert.ok(r.hours.every(v => v === 0));
  assert.equal(r.grid.length, 7);
  assert.ok(r.grid.every(row => row.length === 24 && row.every(v => v === 0)));
});

test('default tz works and maps Monday to 0', () => {
  const r = act.bin([[MON10, 3]], 900, MON10 + 900);
  const d = new Date(MON10 * 1000);
  assert.equal(r.grid[(d.getDay() + 6) % 7][d.getHours()], 3);
});
