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
