const test = require('node:test');
const assert = require('node:assert/strict');

let lastFetch = null, fetchImpl = null, store = {}, lsThrows = false, replaced = [];
globalThis.fetch = (url, opts) => { lastFetch = { url, opts }; return fetchImpl(url, opts); };
globalThis.location = { search: '', pathname: '/stats/' };
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
  assert.equal(replaced[0], '/stats/?kind=mined&n=5&flag=true');
  assert.equal(store['stats.scope'], 'smp');
  state.write({ scope: 'all', bots: false, range: '1w', from: null, to: null, kind: 'stat', n: 10, flag: false, q: '' });
  assert.equal(replaced[1], '/stats/?scope=all&range=1w');
  assert.equal(store['stats.scope'], 'all');
  state.write({ scope: 'smp', bots: false, range: null, from: null, to: null, kind: 'stat', n: 10, flag: false, q: '' });
  assert.equal(replaced[2], '/stats/');
  lsThrows = true; assert.doesNotThrow(() => state.write(s)); lsThrows = false;
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
