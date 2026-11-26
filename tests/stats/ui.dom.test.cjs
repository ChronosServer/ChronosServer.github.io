const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'assets', 'js');
const ORIGIN = 'http://stats.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SEARCH = {
  players: [{ uuid: '11111111-2222-3333-4444-555555555555', name: '<img src=x onerror=alert(1)>' },
            { uuid: '66666666-2222-3333-4444-555555555555', name: null }],
  stats: [{ category: 'minecraft:mined', key: 'minecraft:stone' },
          { category: 'minecraft:used', key: 'minecraft:stone' },
          { category: 'minecraft:crafted', key: 'minecraft:stone_bricks' }],
  objectives: [{ objective: 'digs', servers: ['smp', 'cmp'] }],
};
const META = {
  last_run_at: Math.floor(Date.now() / 1000) - 240,
  servers: [
    { key: 'smp', label: 'SMP', group: 'smp', filters_bots: true },
    { key: 'building', label: 'Building', group: 'cmp', filters_bots: false },
    { key: 'cmp', label: 'CMP', group: 'cmp', filters_bots: false },
    { key: 'cmp2', label: 'CMP 2', group: 'cmp', filters_bots: false },
  ],
  scopes: ['all', 'smp', 'cmps', 'building', 'cmp', 'cmp2'],
  settings: { range_presets: { '1d': 86400, '1w': 604800, '1m': 2592000, '6m': 15724800, '1y': 31536000 } },
};

let browser, page, requests;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (/crafatar\.com|mc-heads\.net/.test(u)) return route.fulfill({ status: 500, body: 'down' });
    if (u.includes('/cache/heads/aaaaaaaa-')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.includes('/cache/heads/')) return route.fulfill({ status: 404, body: 'nope' });
    if (u.includes('/assets/img/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.includes('/cache/items/stone.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (u.includes('/cache/items/')) return route.fulfill({ status: 404, body: 'nope' });
    if (u.includes('/api/stats/search')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH) });
    if (u.startsWith(ORIGIN)) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><div id=c></div></body>' });
    return route.abort();
  });
});
after(async () => { if (browser) await browser.close(); });

async function mount() {
  await page.goto(ORIGIN + '/stats/');
  for (const f of ['chronos.js', 'stats/format.js', 'stats/core.js', 'stats/ui.js']) {
    await page.addScriptTag({ path: path.join(ROOT, f) });
  }
  requests.length = 0;
}

test('head falls back to letter when both services fail', async () => {
  await mount();
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.head('11111111-2222-3333-4444-555555555555', 32)));
  await page.waitForSelector('#c .st-letter');
  assert.equal(await page.textContent('#c .st-letter'), '?');
  assert.equal(await page.locator('#c img').count(), 0);
  const broken = await page.$$eval('img', is => is.filter(i => i.complete && i.naturalWidth === 0).length);
  assert.equal(broken, 0);
  assert.ok(requests.some(u => u.includes('crafatar.com/avatars/11111111')));
  assert.ok(requests.some(u => u.includes('mc-heads.net/avatar/11111111')));
  assert.ok(requests.some(u => u.includes('/cache/heads/11111111-2222-3333-4444-555555555555.png')));
});

test('head tries /cache/heads first', async () => {
  await mount();
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.head('aaaaaaaa-2222-3333-4444-555555555555', 32)));
  await page.waitForFunction(() => { const i = document.querySelector('#c img.st-head'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await page.getAttribute('#c img.st-head', 'src'), '/cache/heads/aaaaaaaa-2222-3333-4444-555555555555.png');
  assert.ok(!requests.some(u => u.includes('crafatar.com/avatars/aaaaaaaa')));
});

test('icon fallback and memo', async () => {
  await mount();
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.icon('missing_thing')));
  await page.waitForSelector('#c .st-letter');
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.icon('missing_thing')));
  assert.equal(await page.locator('#c .st-letter').count(), 2);
  assert.equal(await page.textContent('#c .st-letter'), 'M');
  assert.equal(requests.filter(u => u.includes('/cache/items/missing_thing.png')).length, 1);
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.icon('stone')));
  await page.waitForFunction(() => { const i = document.querySelector('#c img.st-icon'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await page.getAttribute('#c img.st-icon', 'src'), '/cache/items/stone.png');
});

test('icon accepts a site path', async () => {
  await mount();
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.icon('/assets/img/cat-broken.png', 20)));
  assert.equal(await page.getAttribute('#c img.st-icon', 'src'), '/assets/img/cat-broken.png');
});

test('autocomplete escapes and navigates', async () => {
  await mount();
  await page.evaluate(() => {
    const c = document.getElementById('c');
    c.innerHTML = '<input id=q>';
    window.picked = [];
    S.ui.autocomplete(document.getElementById('q'), { onPick: it => window.picked.push(it) });
    window.alerted = false; window.alert = () => { window.alerted = true; };
  });
  assert.equal(await page.getAttribute('#q', 'role'), 'combobox');
  await page.focus('#q');
  await page.keyboard.type('sto');
  await page.waitForSelector('[role=listbox] [role=option]');
  assert.equal(await page.getAttribute('#q', 'aria-expanded'), 'true');
  // only one debounced request for three keystrokes
  assert.equal(requests.filter(u => u.includes('/api/stats/search')).length, 1);
  assert.ok(requests.some(u => u.includes('/api/stats/search?q=sto&limit=10')));
  const lb = page.locator('[role=listbox]');
  const text = await lb.textContent();
  assert.ok(text.includes('<img src=x onerror=alert(1)>'), text);
  assert.ok(text.includes('66666666'), text);
  for (const g of ['Players', 'Stats', 'Objectives']) assert.ok(text.includes(g), text);
  const imgs = await lb.locator('img').evaluateAll(is => is.filter(i => !i.classList.contains('st-head') && !i.classList.contains('st-icon')).length);
  assert.equal(imgs, 0);
  // stone: one key heading with Mined + Used sub-options
  assert.equal(await lb.locator('.st-ac-key').count(), 1);
  assert.equal(await lb.locator('[role=option][data-type=stat]').count(), 3);
  await page.keyboard.press('ArrowDown');
  const active = await page.getAttribute('#q', 'aria-activedescendant');
  assert.ok(active);
  assert.equal(await page.getAttribute('#' + active, 'aria-selected'), 'true');
  await page.keyboard.press('Enter');
  const picked = await page.evaluate(() => window.picked);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].type, 'player');
  assert.equal(picked[0].uuid, '11111111-2222-3333-4444-555555555555');
  assert.equal(await page.getAttribute('#q', 'aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => window.alerted), false);
  // Esc closes
  await page.keyboard.type('n');
  await page.waitForSelector('[role=listbox] [role=option]', { state: 'visible' });
  await page.keyboard.press('Escape');
  assert.ok(!(await lb.isVisible()));
});

test('controls hide bots toggle on cmps', async () => {
  await mount();
  await page.evaluate(meta => {
    window.changes = [];
    window.st = { scope: 'cmps', bots: false, range: null, from: null, to: null };
    window.ctl = S.ui.controls(document.getElementById('c'), meta, window.st, s => window.changes.push(JSON.parse(JSON.stringify(s))), { range: true });
  }, META);
  const seg = await page.locator('.st-seg[data-kind=scope] button').allTextContents();
  assert.deepEqual(seg, ['ALL', 'SMP', 'CMPS']);
  const opts = await page.$$eval('.st-controls select option', os => os.map(o => o.value));
  assert.deepEqual(opts, ['', 'building', 'cmp', 'cmp2']);
  assert.equal(await page.getAttribute('.st-seg[data-kind=scope] button[data-value=cmps]', 'aria-pressed'), 'true');
  assert.ok(!(await page.locator('.st-controls input[type=checkbox]').isVisible()));
  await page.click('.st-seg[data-kind=scope] button[data-value=smp]');
  assert.ok(await page.locator('.st-controls input[type=checkbox]').isVisible());
  assert.equal(await page.getAttribute('.st-seg[data-kind=scope] button[data-value=smp]', 'aria-pressed'), 'true');
  const range = await page.locator('.st-seg[data-kind=range] button').allTextContents();
  assert.deepEqual(range, ['1D', '1W', '1M', '6M', '1Y', 'ALL', 'CUSTOM']);
  await page.click('.st-seg[data-kind=range] button[data-value="1w"]');
  const last = (await page.evaluate(() => window.changes)).pop();
  assert.equal(last.range, '1w');
  assert.equal(last.scope, 'smp');
  const search = await page.evaluate(() => location.search);
  assert.ok(search.includes('range=1w'), search);
  assert.ok(search.includes('scope=smp'), search);
  assert.match(await page.textContent('.st-synced'), /^Synced 4 min ago$/);
  await page.evaluate(() => window.ctl.setSynced(Math.floor(Date.now() / 1000) - 7200));
  assert.match(await page.textContent('.st-synced'), /^Stale, synced 2 h ago$/);
  assert.ok(await page.locator('.st-synced.stale').count() === 1);
});

test('custom range converts dates to local day bounds', async () => {
  await mount();
  await page.evaluate(meta => {
    window.changes = [];
    S.ui.controls(document.getElementById('c'), meta, { scope: 'smp', bots: false, range: null, from: null, to: null },
      s => window.changes.push(JSON.parse(JSON.stringify(s))), { range: true });
  }, META);
  assert.ok(!(await page.locator('.st-custom').isVisible()));
  await page.click('.st-seg[data-kind=range] button[data-value=custom]');
  assert.ok(await page.locator('.st-custom').isVisible());
  await page.fill('.st-custom input[name=from]', '2026-11-01');
  await page.fill('.st-custom input[name=to]', '2026-11-03');
  const last = (await page.evaluate(() => window.changes)).pop();
  const want = await page.evaluate(() => [new Date(2026, 10, 1).getTime() / 1000, new Date(2026, 10, 3, 23, 59, 59).getTime() / 1000]);
  assert.equal(last.range, null);
  assert.equal(last.from, want[0]);
  assert.equal(last.to, want[1]);
});

test('table sorts and pages', async () => {
  await mount();
  await page.evaluate(() => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ name: 'p' + i, value: i }));
    window.tbl = S.ui.table(document.getElementById('c'), {
      columns: [{ id: 'name', label: 'Player' }, { id: 'value', label: 'Value', num: true, sort: true }],
      rows, rowHtml: r => '<td>' + S.fmt.esc(r.name) + '</td><td>' + r.value + '</td>',
    });
  });
  assert.equal(await page.locator('#c tbody tr').count(), 50);
  assert.ok((await page.textContent('#c .st-pager')).includes('Showing 1–50 of 120'));
  await page.click('#c .st-pg[data-page="3"]');
  assert.equal(await page.locator('#c tbody tr').count(), 20);
  assert.equal(await page.textContent('#c tbody tr:first-child td:first-child'), 'p100');
  assert.equal(await page.getAttribute('#c .st-pg[data-page="3"]', 'aria-current'), 'page');
  await page.click('#c th[data-col=value] button');
  assert.equal(await page.getAttribute('#c th[data-col=value]', 'aria-sort'), 'descending');
  assert.equal(await page.textContent('#c tbody tr:first-child td:last-child'), '119');
  assert.equal(await page.locator('#c tbody tr').count(), 50);
  await page.click('#c .st-pg-next');
  assert.equal(await page.textContent('#c tbody tr:first-child td:last-child'), '69');
  await page.click('#c th[data-col=value] button');
  assert.equal(await page.textContent('#c tbody tr:first-child td:last-child'), '0');
});

test('pager hides for one page', async () => {
  await mount();
  await page.evaluate(() => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ name: 'p' + i, value: i }));
    S.ui.table(document.getElementById('c'), {
      columns: [{ id: 'name', label: 'Player' }], rows, rowHtml: r => '<td>' + r.name + '</td>',
    });
  });
  assert.equal(await page.locator('#c tbody tr').count(), 50);
  assert.equal(await page.locator('#c .st-pager').count(), 0);
});

test('pager gaps and ends', async () => {
  await mount();
  const got = await page.evaluate(() => {
    const el = document.getElementById('c');
    const seen = [];
    const pg = S.ui.pager(el, { total: 4000, pageSize: 50, page: 40, onPage: n => seen.push(n) });
    const labels = Array.from(el.querySelectorAll('.st-pg, .st-pg-gap')).map(b => b.textContent);
    const cur = el.querySelector('[aria-current="page"]').textContent;
    const count = el.querySelector('.st-pager-count').textContent;
    el.querySelector('.st-pg-next').click();
    pg.set(4000, 1);
    const prevDisabled = el.querySelector('.st-pg-prev').disabled;
    pg.set(30, 1);
    return { labels, cur, count, seen, prevDisabled, gone: el.querySelector('.st-pager') === null };
  });
  assert.deepEqual(got.labels, ['1', '…', '39', '40', '41', '…', '80']);
  assert.equal(got.cur, '40');
  assert.equal(got.count, 'Showing 1,951–2,000 of 4,000');
  assert.deepEqual(got.seen, [41]);
  assert.equal(got.prevDisabled, true);
  assert.equal(got.gone, true);
});

test('tabs, empty and error', async () => {
  await mount();
  await page.evaluate(() => {
    window.sel = [];
    S.ui.tabs(document.getElementById('c'), [{ id: 'a', label: 'All stats', count: 12 }, { id: 'b', label: 'Firsts' }], id => window.sel.push(id));
  });
  assert.equal(await page.locator('#c [role=tab]').count(), 2);
  assert.equal(await page.getAttribute('#c [role=tab][data-id=a]', 'aria-selected'), 'true');
  await page.focus('#c [role=tab][data-id=a]');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(() => window.sel), ['b']);
  assert.equal(await page.getAttribute('#c [role=tab][data-id=b]', 'aria-selected'), 'true');
  await page.evaluate(() => S.ui.empty(document.getElementById('c'), '<b>Nothing</b> yet'));
  assert.equal(await page.textContent('#c .st-empty'), '<b>Nothing</b> yet');
  await page.evaluate(() => S.ui.error(document.getElementById('c'), new S.ApiError('HTTP 502', 502, 'http')));
  assert.match(await page.textContent('#c .panel.err'), /HTTP 502/);
});

test('autocomplete pick cancels a pending search', async () => {
  await mount();
  await page.evaluate(() => {
    document.getElementById('c').innerHTML = '<input id=q>';
    window.picked = [];
    S.ui.autocomplete(document.getElementById('q'), { onPick: it => window.picked.push(it) });
  });
  await page.focus('#q');
  await page.keyboard.type('sto');
  await page.waitForSelector('[role=listbox] [role=option]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('n');          // starts a new 120 ms debounce
  await page.keyboard.press('Enter');     // pick before it fires
  assert.equal((await page.evaluate(() => window.picked)).length, 1);
  await page.waitForTimeout(400);
  assert.ok(!(await page.locator('[role=listbox]').isVisible()));
  assert.equal(await page.getAttribute('#q', 'aria-expanded'), 'false');
  assert.equal(requests.filter(u => u.includes('/api/stats/search')).length, 1);
});

test('controls clear bots when leaving SMP data', async () => {
  await mount();
  await page.evaluate(meta => {
    window.changes = [];
    S.ui.controls(document.getElementById('c'), meta, { scope: 'smp', bots: true, range: null, from: null, to: null },
      s => window.changes.push(JSON.parse(JSON.stringify(s))), { range: true });
  }, META);
  assert.equal(await page.isChecked('.st-controls input[type=checkbox]'), true);
  await page.click('.st-seg[data-kind=scope] button[data-value=cmps]');
  const last = (await page.evaluate(() => window.changes)).pop();
  assert.equal(last.scope, 'cmps');
  assert.equal(last.bots, false);
  assert.ok(!(await page.evaluate(() => location.search)).includes('bots='));
  await page.selectOption('.st-controls select', 'cmp2');
  assert.equal((await page.evaluate(() => window.changes)).pop().bots, false);
});

test('scope split follows meta.scope_groups when present', async () => {
  await mount();
  const meta = {
    last_run_at: null,
    servers: [
      { key: 'smp', label: 'SMP', group: 'smp', filters_bots: true },
      { key: 'creative', label: 'Creative', group: 'cmp', filters_bots: false },
      { key: 'cmp', label: 'CMP', group: 'cmp', filters_bots: false },
      { key: 'cmp2', label: 'CMP 2', group: 'cmp', filters_bots: false },
    ],
    scope_groups: { cmps: ['cmp', 'cmp2'] },
    scopes: ['all', 'smp', 'creative', 'cmps', 'cmp', 'cmp2'],
    settings: { range_presets: {} },
  };
  const split = await page.evaluate(m => { const r = S.ui.splitScopes(m); return { seg: r.seg, sel: r.sel }; }, meta);
  assert.deepEqual(split, { seg: ['all', 'smp', 'creative', 'cmps'], sel: ['cmp', 'cmp2'] });
  await page.evaluate(m => S.ui.controls(document.getElementById('c'), m,
    { scope: 'cmp', bots: false, range: null, from: null, to: null }, () => {}, {}), meta);
  assert.deepEqual(await page.locator('.st-seg[data-kind=scope] button').allTextContents(), ['ALL', 'SMP', 'CREATIVE', 'CMPS']);
  assert.equal(await page.inputValue('.st-controls select'), 'cmp');
  assert.equal(await page.locator('.st-seg[data-kind=scope] button[aria-pressed=true]').count(), 0);
  assert.ok(!(await page.locator('.st-controls input[type=checkbox]').isVisible()));
});

test('tip shows on hover and focus, one at a time', async () => {
  await mount();
  await page.evaluate(() => {
    const c = document.getElementById('c');
    c.innerHTML = '<p style="margin:80px"><span id=t1 data-tip="First &lt;b&gt;tip" tabindex=0>A</span> <span id=t2 data-tip="Second tip" tabindex=0>B</span></p>';
    S.ui.tip(c);
  });
  await page.hover('#t1');
  const bubble = page.locator('.st-bubble');
  await bubble.waitFor({ state: 'visible' });
  assert.equal(await bubble.textContent(), 'First <b>tip');
  assert.equal(await page.getAttribute('#t1', 'aria-describedby'), await bubble.getAttribute('id'));
  await page.focus('#t2');
  assert.equal(await bubble.textContent(), 'Second tip');
  assert.equal(await page.locator('.st-bubble').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await bubble.isVisible(), false);
});

test('tip toggles on tap', async () => {
  const ctx = await browser.newContext({ hasTouch: true });
  const tp = await ctx.newPage();
  await tp.route('**/*', r => r.request().url().startsWith(ORIGIN)
    ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body><div id=c></div></body>' }) : r.abort());
  await tp.goto(ORIGIN + '/stats/');
  for (const f of ['chronos.js', 'stats/format.js', 'stats/core.js', 'stats/ui.js']) await tp.addScriptTag({ path: path.join(ROOT, f) });
  await tp.evaluate(() => {
    const c = document.getElementById('c');
    c.innerHTML = '<p style="margin:80px"><span id=t1 data-tip="Tap tip" tabindex=0>A</span></p><p id=away style="height:300px">x</p>';
    S.ui.tip(c);
  });
  await tp.tap('#t1');
  assert.equal(await tp.locator('.st-bubble').isVisible(), true);
  await tp.tap('#away');
  assert.equal(await tp.locator('.st-bubble').isVisible(), false);
  await ctx.close();
});

test('autocomplete sends spaces as underscores', async () => {
  await mount();
  await page.evaluate(() => {
    document.getElementById('c').innerHTML = '<input id=q>';
    S.ui.autocomplete(document.getElementById('q'), { onPick: () => {} });
  });
  await page.focus('#q');
  await page.keyboard.type('  redstone   block ');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/api/stats/search')));
  await page.waitForTimeout(50);
  const qs = requests.filter(u => u.includes('/api/stats/search')).map(u => new URL(u).searchParams.get('q'));
  assert.ok(qs.length > 0);
  assert.equal(qs[qs.length - 1], 'redstone_block');
  assert.equal(await page.inputValue('#q'), '  redstone   block ');
});

test('open autocomplete lifts its blurred panel above later panels', async () => {
  await mount();
  await page.evaluate(() => {
    document.getElementById('c').innerHTML = '<section id=box style="backdrop-filter:blur(4px)"><div><input id=q></div></section><div id=later style="backdrop-filter:blur(4px)">later</div>';
    S.ui.autocomplete(document.getElementById('q'), { onPick: () => {} });
  });
  await page.focus('#q');
  await page.keyboard.type('sto');
  await page.waitForSelector('[role=listbox] [role=option]');
  assert.equal(await page.evaluate(() => document.getElementById('box').classList.contains('st-ac-host')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('box').classList.contains('st-ac-host')), false);
});

test('pager keeps keyboard focus on page change', async () => {
  await mount();
  await page.evaluate(() => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ name: 'p' + i, value: i }));
    S.ui.table(document.getElementById('c'), {
      columns: [{ id: 'name', label: 'Player' }], rows, rowHtml: r => '<td>' + r.name + '</td>',
    });
  });
  await page.focus('#c .st-pg-next');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'st-pg-next');
  await page.focus('#c .st-pg[data-page="3"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.page), '3');
  assert.equal(await page.getAttribute('#c .st-pager-count', 'aria-live'), 'polite');
});

test('pager built with focus: true focuses the current page', async () => {
  await mount();
  const cur = await page.evaluate(() => {
    S.ui.pager(document.getElementById('c'), { total: 300, pageSize: 50, page: 2, focus: true });
    return document.activeElement.getAttribute('aria-current') + ':' + document.activeElement.textContent;
  });
  assert.equal(cur, 'page:2');
});

test('icon never loads a protocol-relative or foreign path', async () => {
  await mount();
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.icon('//evil.test/x', 20)));
  await page.waitForSelector('#c .st-letter');
  assert.ok(!requests.some(u => new URL(u).host === 'evil.test'));
});
test('autocomplete sends include_bots only when opts.bots() is on', async () => {
  await mount();
  await page.evaluate(() => {
    document.getElementById('c').innerHTML = '<input id=q>';
    window.botsOn = false;
    S.ui.autocomplete(document.getElementById('q'), { onPick: () => {}, bots: () => window.botsOn });
  });
  const last = () => { const u = requests.filter(x => x.includes('/api/stats/search')).pop(); return u && new URL(u).searchParams; };
  await page.focus('#q');
  await page.keyboard.type('chez');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('q=chez')));
  await page.waitForTimeout(50);
  assert.equal(last().get('include_bots'), null);
  await page.evaluate(() => { window.botsOn = true; });
  await page.keyboard.type('l');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('q=chezl')));
  await page.waitForTimeout(50);
  assert.equal(last().get('include_bots'), 'true');
});
test('our head cache stays first after many players without a cached head', async () => {
  await mount();
  await page.evaluate(() => {
    const c = document.getElementById('c');
    for (let k = 0; k < 5; k++) c.appendChild(S.ui.head('1111111' + k + '-2222-3333-4444-555555555555', 32));
  });
  await page.waitForFunction(() => document.querySelectorAll('#c .st-letter, #c span.st-head').length >= 5 || document.querySelectorAll('#c img.st-head').length === 0);
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('c').appendChild(S.ui.head('aaaaaaaa-2222-3333-4444-555555555555', 32)));
  await page.waitForFunction(() => { const i = document.querySelector('#c img.st-head[src*="aaaaaaaa"]'); return i && i.complete; });
  assert.equal(await page.getAttribute('#c img.st-head[src*="aaaaaaaa"]', 'src'), '/cache/heads/aaaaaaaa-2222-3333-4444-555555555555.png');
});
