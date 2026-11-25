const test = require('node:test');
const assert = require('node:assert/strict');
const { timeScale, niceMax, trimLeading, stepPath, valueAt, changePoints } = require('../../assets/js/stats/chartmath.js');

test('timeScale linear when live outside range', () => { const x = timeScale(0, 100, null, 0, 1000); assert.equal(x(50), 500); assert.equal(x.split, null); });
test('timeScale split', () => { const x = timeScale(0, 100, 90, 0, 1000); assert.equal(x(90), 450); assert.equal(x(0), 0); assert.equal(x(100), 1000); assert.equal(x.split, 450); assert.equal(x(95), 725); });
test('timeScale stays linear when liveAt is on or outside the range edges', () => {
  for (const live of [0, 100, -5, 150]) { const x = timeScale(0, 100, live, 0, 1000); assert.equal(x.split, null); assert.equal(x(50), 500); }
});
test('timeScale invert round-trips', () => {
  for (const live of [null, 90]) { const x = timeScale(0, 100, live, 58, 1000); for (const t of [0, 30, 90, 95, 100]) assert.ok(Math.abs(x.invert(x(t)) - t) < 1e-9); }
});
test('niceMax', () => { assert.equal(niceMax(0), 1); assert.equal(niceMax(495200), 500000); assert.equal(niceMax(1.3e9), 2e9); assert.equal(niceMax(2.2e6), 2.5e6); });
test('niceMax edges', () => { assert.equal(niceMax(1000), 1000); assert.equal(niceMax(7), 10); assert.equal(niceMax(0.3), 0.5); assert.equal(niceMax(-4), 1); });
test('trimLeading', () => { assert.deepEqual(trimLeading([[1,0],[2,0],[3,5],[4,0]]), [[3,5],[4,0]]); assert.deepEqual(trimLeading([[1,0],[2,0]]), [[2,0]]); assert.deepEqual(trimLeading([]), []); });
test('stepPath', () => { assert.equal(stepPath([[0,0],[10,5]], t=>t, v=>v, 20), 'M0,0H10V5H20'); assert.equal(stepPath([], t=>t, v=>v, 1), ''); });
test('valueAt', () => { const p = [[10,1],[20,2]]; assert.equal(valueAt(p, 5), null); assert.equal(valueAt(p, 10), 1); assert.equal(valueAt(p, 19), 1); assert.equal(valueAt(p, 99), 2); });
test('changePoints', () => assert.deepEqual(changePoints([[[3,1],[1,1]],[[2,1],[3,2]]]), [1,2,3]));

// ---- Task 12b: y domain
const { yDomain } = require('../../assets/js/stats/chartmath.js');
test('yDomain zero-based keeps 0 at the bottom with nice steps', () => {
  const d = yDomain(10, 1741, { zero: true });
  assert.equal(d.min, 0); assert.equal(d.step, 500); assert.equal(d.max, 2000);
  assert.deepEqual(d.ticks, [0, 500, 1000, 1500, 2000]);
});
test('yDomain ranged starts at a nice minimum of the visible values', () => {
  const d = yDomain(41750, 41820, { zero: false });
  assert.equal(d.step, 20); assert.equal(d.min, 41740); assert.equal(d.max, 41820);
  assert.deepEqual(d.ticks, [41740, 41760, 41780, 41800, 41820]);
});
test('yDomain ranged data near 0 still reaches 0', () => {
  assert.equal(yDomain(3, 900, { zero: false }).min, 0);
});
test('yDomain flat, empty and negative ranges', () => {
  const flat = yDomain(500, 500, { zero: false });
  assert.ok(flat.min <= 500 && flat.max > 500 && flat.ticks.length >= 2, JSON.stringify(flat));
  const zero = yDomain(0, 0, { zero: true });
  assert.equal(zero.min, 0); assert.ok(zero.max > 0);
  const neg = yDomain(-30, 12, { zero: true });
  assert.ok(neg.min <= -30 && neg.max >= 12 && neg.ticks.includes(0), JSON.stringify(neg));
  const neg2 = yDomain(-30, -10, { zero: true });
  assert.ok(neg2.min <= -30 && neg2.max === 0, JSON.stringify(neg2));
});
test('yDomain minStep keeps integer counts on whole numbers', () => {
  const d = yDomain(0, 2, { zero: true, minStep: 1 });
  assert.ok(d.step >= 1 && d.ticks.every(t => Number.isInteger(t)), JSON.stringify(d));
});
test('yDomain stays within 2..7 ticks and covers the data', () => {
  for (const [a, b] of [[0, 7], [13, 1e9], [41001, 41999], [-5, 5], [0.1, 0.13]]) {
    const d = yDomain(a, b, { zero: false });
    assert.ok(d.ticks.length >= 2 && d.ticks.length <= 7, a + '..' + b + ' ' + JSON.stringify(d));
    assert.ok(d.min <= a && d.max >= b, a + '..' + b + ' ' + JSON.stringify(d));
  }
});
