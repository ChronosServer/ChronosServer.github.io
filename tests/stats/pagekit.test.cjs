const test = require('node:test');
const assert = require('node:assert/strict');
require('../../assets/js/stats/format.js');
require('../../assets/js/stats/core.js');
const kit = require('../../assets/js/stats/pagekit.js');

const D = 86400, NOW = 1795600000;
const meta = {
  servers: [
    { key: 'smp', label: 'SMP', track_stats: true, track_scoreboards: true },
    { key: 'cmp', label: 'CMP', track_stats: true, track_scoreboards: false },
    { key: 'cmp2', label: 'CMP2', track_stats: true, track_scoreboards: false },
  ],
  scope_groups: { cmps: ['cmp', 'cmp2'] },
  tracking_started_at: { smp: NOW - 100 * D, cmp: NOW - 3 * D },
  settings: { range_presets: { '1d': D, '1w': 7 * D } },
};
const st = o => Object.assign({ range: null, from: null, to: null }, o);

test('rangeText', () => {
  assert.equal(kit.rangeText(st({ range: '1w' })), 'in the last week');
  assert.equal(kit.rangeText(st({ range: '3m' })), 'in the last 3 months');
  assert.equal(kit.rangeText(st({ range: 'all' })), 'since tracking began');
  assert.equal(kit.rangeText(st({})), '');
});
test('ranged', () => {
  assert.equal(kit.ranged(st({ range: '1w' })), true);
  assert.equal(kit.ranged(st({ range: 'all' })), false);
  assert.equal(kit.ranged(st({ from: 1, to: 2 })), true);
  assert.equal(kit.ranged(st({})), false);
});
test('sinceText modes', () => {
  const res = { effective_from: NOW - 3 * D, to: NOW };
  // a week asked, the CMP only has 3 days: clamped to its tracking start
  assert.match(kit.sinceText(meta, st({ range: '1w' }), res, ['cmp'], 'all'), /^since tracking began \(/);
  assert.match(kit.sinceText(meta, st({ range: '1w' }), res, ['smp'], 'all'), /^since \d/);
  // not clamped
  assert.equal(kit.sinceText(meta, st({ range: '1w' }), { effective_from: NOW - 7 * D, to: NOW }, ['smp'], 'all'), '');
  // all time
  assert.equal(kit.sinceText(meta, st({}), res, ['cmp'], 'all'), '');
  assert.notEqual(kit.sinceText(meta, st({}), res, ['cmp'], 'always'), '');
  assert.notEqual(kit.sinceText(meta, st({ range: 'all' }), res, ['cmp'], 'all'), '');
  assert.equal(kit.sinceText(meta, st({ range: 'all' }), res, ['cmp'], 'clamped'), '');
});
test('liveNote only when the live start is inside the window', () => {
  assert.equal(kit.liveNote(null, { effective_from: 0, to: 10 }), '');
  assert.equal(kit.liveNote(20, { effective_from: 0, to: 10 }), '');
  assert.match(kit.liveNote(5, { effective_from: 0, to: 10 }), /Shaded/);
});
test('liveNote is its own block', () => {
  assert.match(kit.liveNote(5, { effective_from: 0, to: 10 }), /^<span class="st-note-live">.*<\/span>$/);
});
test('untracked copy names the server or "these servers"', () => {
  assert.equal(kit.untracked(meta, 'cmp', 'scoreboard'), "Scoreboards aren't tracked on CMP.");
  assert.equal(kit.untracked(meta, 'cmps', 'scoreboard'), "Scoreboards aren't tracked on these servers.");
  assert.equal(kit.untracked(meta, 'smp', 'scoreboard'), '');
  assert.equal(kit.untracked(meta, 'all', 'scoreboard'), '');
  assert.equal(kit.untracked(meta, 'cmp', 'stat'), '');
});

test('leader: highest present value when present values differ', () => {
  assert.equal(kit.leader([-3, -5, null]), -3);
  assert.equal(kit.leader([5, 5, null]), null);
  assert.equal(kit.leader([5, null]), null);
  assert.equal(kit.leader([0, 0]), null);
  assert.equal(kit.leader([2, 7, 7]), 7);
  assert.equal(kit.leader([null, null]), null);
});
test('liveNote needs an effective_from', () => {
  assert.equal(kit.liveNote(5, { effective_from: null, to: 10 }), '');
  assert.equal(kit.liveNote(5, { to: 10 }), '');
});

test('boardHref carries the stat, scope and bots', () => {
  assert.equal(kit.boardHref('stat', 'minecraft:mined', 'minecraft:stone', st({ scope: 'smp', bots: true })),
    '/stats/explorer/?scope=smp&bots=true&cat=minecraft%3Amined&key=minecraft%3Astone');
  assert.equal(kit.boardHref('stat', 'minecraft:custom', 'minecraft:play_time', st({ scope: 'cmps', bots: false })),
    '/stats/explorer/?scope=cmps&cat=minecraft%3Acustom&key=minecraft%3Aplay_time');
  assert.equal(kit.boardHref('scoreboard', null, 'dig pickaxe&x', st({ scope: 'all' })),
    '/stats/scoreboards/?scope=all&key=dig%20pickaxe%26x');
});
test('lineStart reads /totals starts per line, else effective_from', () => {
  const res = { effective_from: 100, starts: { smp: 100, cmp: 500, cmp2: null } };
  assert.equal(kit.lineStart(res, 'smp'), 100);
  assert.equal(kit.lineStart(res, 'cmp'), 500);
  assert.equal(kit.lineStart(res, 'cmp2'), null);
  assert.equal(kit.lineStart({ effective_from: 300 }, 'smp'), 300);
  assert.equal(kit.lineStart({ effective_from: 300, starts: {} }, 'smp'), 300);
});
