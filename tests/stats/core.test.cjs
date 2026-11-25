const test = require('node:test');
const assert = require('node:assert/strict');

let lastFetch = null, fetchImpl = null, store = {}, lsThrows = false, replaced = [];
globalThis.fetch = (url, opts) => { lastFetch = { url, opts }; return fetchImpl(url, opts); };
globalThis.location = { search: '', pathname: '/stats/', hash: '' };
globalThis.history = { replaceState: (s, t, u) => replaced.push(u) };
globalThis.localStorage = {
  getItem: k => { if (lsThrows) throw new Error('denied'); return k in store ? store[k] : null; },
  setItem: (k, v) => { if (lsThrows) throw new Error('denied'); store[k] = String(v); },
};
const core = require('../../assets/js/stats/core.js');
const { api, ApiError, errorText, state, scopeInfo, rangeParams } = core;

function resp(status, body, type) {
  return Promise.resolve({
    status, ok: status >= 200 && status < 300,
    headers: { get: h => (h.toLowerCase() === 'content-type' ? (type === undefined ? 'application/json' : type) : null) },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}
const meta = { scopes: ['all', 'smp', 'cmps', 'cmp', 'cmp2'], settings: { range_presets: { '1d': 86400, '1w': 604800 } },
  servers: [{ key: 'smp', filters_bots: true }, { key: 'cmp', filters_bots: false }, { key: 'cmp2', filters_bots: false }] };
function setQ(q) { location.search = q; store = {}; replaced = []; }

test('api builds query and parses json', async () => {
  fetchImpl = () => resp(200, { ok: 1 });
  const r = await api('leaderboard', { kind: 'stat', key: 'minecraft:stone', from: null, to: undefined, x: '', limit: 50 });
  assert.deepEqual(r, { ok: 1 });
  assert.equal(lastFetch.url, '/api/stats/leaderboard?kind=stat&key=minecraft%3Astone&limit=50');
  assert.equal(lastFetch.opts, undefined);
});
test('api throws http error with server message', async () => {
  fetchImpl = () => resp(404, { error: 'player not found' });
  await assert.rejects(api('p'), e => e instanceof ApiError && e.status === 404 && e.kind === 'http' && e.message === 'player not found');
  fetchImpl = () => resp(422, { detail: [{ msg: 'bad' }] });
  await assert.rejects(api('p'), e => e.kind === 'http' && e.status === 422);
});
test('api detects cloudflare html', async () => {
  fetchImpl = () => resp(403, '<!DOCTYPE html><html>', 'text/html');
  await assert.rejects(api('p'), e => e.kind === 'blocked' && e.status === 403);
  fetchImpl = () => resp(200, '  <html>x</html>', 'text/html');
  await assert.rejects(api('p'), e => e.kind === 'blocked');
  fetchImpl = () => resp(200, '\n<html>', 'application/json');
  await assert.rejects(api('p'), e => e.kind === 'blocked');
});
test('api network failure', async () => {
  fetchImpl = () => Promise.reject(new TypeError('failed'));
  await assert.rejects(api('p'), e => e instanceof ApiError && e.kind === 'network');
});
test('errorText', () => {
  const E = (m, s, k) => new ApiError(m, s, k);
  assert.equal(errorText(E('x', 403, 'blocked')), "The stats server didn't answer. Try again in a minute.");
  assert.equal(errorText(E('x', 0, 'network')), "Couldn't reach the stats server. Check your connection and try again.");
  assert.equal(errorText(E('player not found', 404, 'http')), 'No player by that name. Check the spelling or search for them.');
  assert.equal(errorText(E('bad range', 400, 'http')), 'The stats server rejected that request (bad range).');
  assert.equal(errorText(new Error('boom')), "Couldn't reach the stats server. Check your connection and try again.");
});
test('meta memoizes and clears on failure', async () => {
  let n = 0;
  fetchImpl = () => { n++; return n === 1 ? Promise.reject(new TypeError('x')) : resp(200, { scopes: [] }); };
  await assert.rejects(core.meta());
  const a = core.meta(), b = core.meta();
  assert.equal(a, b);
  await a;
  assert.equal(n, 2);
  assert.equal(lastFetch.url, '/api/stats/meta');
});
test('state.read falls back to the first scope when smp is missing', () => {
  setQ(''); store['stats.scope'] = 'junk';
  assert.equal(state.read({ scopes: ['all', 'cmps'] }).scope, 'all');
  assert.equal(state.read({ scopes: [] }).scope, 'smp');
  delete store['stats.scope'];
});
test('state.read defaults to smp', () => {
  setQ('');
  const s = state.read({ scopes: ['all', 'smp', 'cmps', 'cmp'] });
  assert.equal(s.scope, 'smp'); assert.equal(s.bots, false); assert.equal(s.range, null);
  assert.equal(s.from, null); assert.equal(s.to, null);
});
test('state.read rejects bad values', () => {
  setQ('?scope=foo&range=7y&from=abc');
  let s = state.read(meta);
  assert.equal(s.scope, 'smp'); assert.equal(s.range, null); assert.equal(s.from, null);
  setQ('?range=1w'); assert.equal(state.read(meta).range, '1w');
  setQ('?range=all'); assert.equal(state.read(meta).range, 'all');
  setQ('?scope=cmp2'); assert.equal(state.read(meta).scope, 'cmp2');
  setQ(''); store['stats.scope'] = 'all'; assert.equal(state.read(meta).scope, 'all');
  setQ(''); store['stats.scope'] = 'junk'; assert.equal(state.read(meta).scope, 'smp');
  setQ('?bots=true&from=10&to=20'); s = state.read(meta);
  assert.equal(s.bots, true); assert.equal(s.from, 10); assert.equal(s.to, 20);
  lsThrows = true; setQ(''); assert.equal(state.read(meta).scope, 'smp'); lsThrows = false;
});
test('state extras and write', () => {
  setQ('?kind=mined&n=5&flag=true&junk=1');
  const s = state.read(meta, { kind: 'stat', n: 10, flag: false, q: '' });
  assert.equal(s.kind, 'mined'); assert.equal(s.n, 5); assert.equal(s.flag, true); assert.equal(s.q, '');
  state.write(s);
  assert.equal(replaced[0], '/stats/?scope=smp&kind=mined&n=5&flag=true');
  assert.equal(store['stats.scope'], 'smp');
  state.write({ scope: 'all', bots: false, range: '1w', from: null, to: null, kind: 'stat', n: 10, flag: false, q: '' });
  assert.equal(replaced[1], '/stats/?scope=all&range=1w');
  assert.equal(store['stats.scope'], 'all');
  state.write({ scope: 'smp', bots: false, range: null, from: null, to: null, kind: 'stat', n: 10, flag: false, q: '' });
  assert.equal(replaced[2], '/stats/?scope=smp');
  lsThrows = true; assert.doesNotThrow(() => state.write(s)); lsThrows = false;
});
test('state.read validates from/to and range precedence', () => {
  for (const q of ['?from=-5&to=10', '?from=1.5&to=10', '?from=%20&to=10', '?from=0x10&to=20', '?from=30&to=20', '?from=5']) {
    setQ(q); const s = state.read(meta);
    assert.equal(s.from, null, q); assert.equal(s.to, null, q);
  }
  setQ('?from=0&to=20'); let s = state.read(meta); assert.equal(s.from, 0); assert.equal(s.to, 20);
  setQ('?range=1w&from=1&to=2'); s = state.read(meta);
  assert.equal(s.range, '1w'); assert.equal(s.from, null); assert.equal(s.to, null);
});
test('state.write: range suppresses from/to, explicit defaults, keeps hash', () => {
  setQ(''); location.hash = '#top';
  state.write({ scope: 'smp', bots: false, range: '1w', from: 1, to: 2, k: 'a' }, { k: 'a' });
  assert.equal(replaced[0], '/stats/?scope=smp&range=1w#top');
  state.write({ scope: 'smp', bots: false, range: null, from: 1, to: 2 });
  assert.equal(replaced[1], '/stats/?scope=smp&from=1&to=2#top');
  location.hash = '';
});
test('errorText 5xx', () => {
  assert.equal(errorText(new ApiError('boom', 502, 'http')), 'The stats server had a problem (HTTP 502). Try again in a minute.');
});
test('scopeInfo with scope_groups', () => {
  const m = { scope_groups: { cmps: ['cmp', 'cmp2'] }, servers: meta.servers };
  assert.deepEqual(scopeInfo(m, 'all'), { servers: ['smp', 'cmp', 'cmp2'], hasSmp: true, parts: ['smp', 'cmps'] });
  assert.deepEqual(scopeInfo(m, 'cmps'), { servers: ['cmp', 'cmp2'], hasSmp: false, parts: ['cmps'] });
  assert.deepEqual(scopeInfo(m, 'cmp'), { servers: ['cmp'], hasSmp: false, parts: ['cmp'] });
});
test('scopeInfo fallback without scope_groups', () => {
  assert.deepEqual(scopeInfo(meta, 'all'), { servers: null, hasSmp: true, parts: ['all'] });
  assert.equal(scopeInfo(meta, 'cmps').hasSmp, false);
  assert.equal(scopeInfo(meta, 'smp').hasSmp, true);
  assert.equal(scopeInfo(meta, 'cmp').hasSmp, false);
});
test('rangeParams', () => {
  assert.deepEqual(rangeParams({ range: '1w', from: null, to: null }), { range: '1w' });
  assert.deepEqual(rangeParams({ from: 1, to: 2 }), { from: 1, to: 2 });
  assert.deepEqual(rangeParams({ range: null, from: null, to: null }), {});
});

// ---- Task 12b: shared helpers
const M12 = {
  servers: [
    { key: 'smp', label: 'SMP', filters_bots: true, track_stats: true, track_scoreboards: true },
    { key: 'cmp', label: 'CMP', filters_bots: false, track_stats: true, track_scoreboards: false },
    { key: 'cmp2', label: 'CMP2', filters_bots: false, track_stats: false, track_scoreboards: false },
  ],
  scope_groups: { cmps: ['cmp', 'cmp2'] },
  live_started_at: { smp: 100, cmp: 300, cmp2: 200 },
};
test('liveAt takes the latest live start of the scope', () => {
  assert.equal(core.liveAt(M12, 'all'), 300);
  assert.equal(core.liveAt(M12, 'cmps'), 300);
  assert.equal(core.liveAt(M12, 'smp'), 100);
  assert.equal(core.liveAt(M12, 'cmp2'), 200);
});
test('liveAt with a missing map or missing servers', () => {
  assert.equal(core.liveAt(Object.assign({}, M12, { live_started_at: undefined }), 'all'), null);
  const partial = Object.assign({}, M12, { live_started_at: { smp: 100, cmp2: 200 } });
  assert.equal(core.liveAt(partial, 'cmps'), 200);     // cmp missing: max of the rest
  assert.equal(core.liveAt(partial, 'all'), 200);
  assert.equal(core.liveAt(partial, 'cmp'), null);     // none of the scope's servers have one
  // no scope_groups: 'all' still covers every server
  const flat = { servers: M12.servers, live_started_at: { smp: 100, cmp: 300 } };
  assert.equal(core.liveAt(flat, 'all'), 300);
  assert.equal(core.liveAt(flat, 'smp'), 100);
});
test('tracked: true when any server in the scope tracks the kind', () => {
  assert.equal(core.tracked(M12, 'all', 'scoreboard'), true);
  assert.equal(core.tracked(M12, 'smp', 'scoreboard'), true);
  assert.equal(core.tracked(M12, 'cmps', 'scoreboard'), false);
  assert.equal(core.tracked(M12, 'cmp', 'scoreboard'), false);
  assert.equal(core.tracked(M12, 'cmps', 'stat'), true);
  assert.equal(core.tracked(M12, 'cmp2', 'stat'), false);
  // flags missing (older backend) or unknown server: treated as tracked
  assert.equal(core.tracked({ servers: [{ key: 'smp' }] }, 'smp', 'scoreboard'), true);
  assert.equal(core.tracked(M12, 'nope', 'scoreboard'), true);
  assert.equal(core.tracked(null, 'smp', 'stat'), true);
});
test('memo shares one request per path and params, and forgets failures', async () => {
  let n = 0, fail = true;
  fetchImpl = () => { n++; return fail ? Promise.reject(new TypeError('x')) : resp(200, { n }); };
  const get = core.memo();
  const a = get('keys', { scope: 'smp' });
  assert.equal(get('keys', { scope: 'smp' }), a);
  await assert.rejects(a);
  fail = false;
  const b = get('keys', { scope: 'smp' });
  assert.notEqual(b, a);
  assert.deepEqual(await b, { n: 2 });
  assert.equal(get('keys', { scope: 'smp' }), b);
  await get('keys', { scope: 'all' });
  assert.equal(n, 3);
  assert.notEqual(core.memo()('keys', { scope: 'smp' }), b);   // each page cache is separate
});

test('serverLines: one line per server in the scope, API order', () => {
  const m = {
    servers: [{ key: 'smp' }, { key: 'building' }, { key: 'cmp' }, { key: 'cmp2' }],
    scope_groups: { cmps: ['building', 'cmp', 'cmp2'] },
  };
  assert.deepEqual(core.serverLines(m, 'smp'), ['smp']);
  assert.deepEqual(core.serverLines(m, 'cmps'), ['building', 'cmp', 'cmp2']);
  assert.deepEqual(core.serverLines(m, 'all'), ['smp', 'building', 'cmp', 'cmp2']);
  assert.deepEqual(core.serverLines(m, 'cmp2'), ['cmp2']);
  assert.deepEqual(core.serverLines({ servers: m.servers }, 'cmp'), ['cmp']);
});
