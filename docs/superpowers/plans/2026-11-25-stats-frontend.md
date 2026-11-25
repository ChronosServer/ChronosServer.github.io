# Chronos Stats Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the six-page Stats section (Overview, Explorer, Scoreboards, Player, Compare, Milestones) of chronosmc.com against the live `/api/stats/*` API, in the existing Chronos design system.

**Architecture:** Jekyll pages under `stats/` share a small set of classic (non-module) browser scripts in `assets/js/stats/` that hang off one `window.S` namespace: pure logic (formatting, chart maths, activity binning) is written so Node can `require` it for tests; DOM pieces render hand-drawn SVG. Each page has one script in `assets/js/stats/pages/`. A stdlib Python dev server proxies `/api/stats/*` to the live site for local work.

**Tech Stack:** Jekyll 4.2, vanilla JS (ES2020, no modules, no deps), SVG, CSS; tests with Node 22 `node:test` + globally installed Playwright (Chromium); Python 3.13 stdlib (`unittest`) for the dev server.

**Spec:** `docs/superpowers/specs/2026-11-25-stats-frontend-design.md` (read it first, with `STATS_API.md` and `CLAUDE.md`). Approved mockups: `.superpowers/brainstorm/1007-1795595369/content/overview.html` (option A) and `player-v2.html`; their CSS and drawing code are a valid starting point.

## Global Constraints

- No npm packages, no bundler, no jQuery/Bootstrap, no chart library. Every new site JS/CSS `<script>`/`<link>` carries `?v={{ site.time | date: '%s' }}`.
- API calls: relative `/api/stats/...` URLs only, default `fetch` caching, **never** a cache-buster param, no polling faster than 5 min.
- Every string from the API (names, keys, objectives, categories) goes through `C.esc()` before reaching `innerHTML`.
- Default scope on every page: `smp`. Servers and scopes are shown in API order, never sorted, never hardcoded.
- Nothing hardcoded from data: categories, keys, objectives, servers, scopes, range presets, limits and badge thresholds come from `/meta`, `/meta.settings` and `/keys`. The only curated list is Overview's 4 headline keys.
- Design tokens from `assets/css/chronos.css` (`--panel --line --teal --amber --red --ok --mute --ink --display --sans --mono --ease`). SMP line = `var(--teal)`, CMPs line = `#c9b37e` (`--cmp`). Headers are Syncopate, uppercase. Stats CSS classes are prefixed `st-` (the home page already owns `.tile`, `.tiles`, `.row`).
- `earliest_known: 1` → "earliest known holder" / "before tracking", no date. `approximate: 1` → "by <date>" in amber. Dates are `en-GB` short: `24 Nov 2026`.
- Item icon `/cache/items/<id>.png`; head chain Crafatar → mc-heads → lettered square; never a broken image.
- `prefers-reduced-motion: reduce` disables all draw-in/entrance animation.
- Copy: plain sentence case, specific, no "Explore our…" filler, no `→` appended to links. Errors say what happened and what to do.
- New repo-only paths (`tests`, `tools`, `docs`) stay in `_config.yml` `exclude`.

## Review Focus

1. **Hostile or missing player names** (`<img onerror=…>`, `null` names): rendered as text; null shows `uuid.slice(0,8)`. → tests in Task 2 (`playerName`) and Task 6 (`head`/autocomplete escape).
2. **Single-point and empty series** (custom window between backups, new stat): chart shows a value card or empty state, never a broken path or NaN. → Task 3 tests.
3. **Cloudflare HTML / 4xx / network failure** from the API: a readable `.panel.err`, page stays usable. → Task 4 tests.
4. **Bad URL state** (`?scope=foo`, `?range=7y`, `?p=` unknown player): falls back to defaults or shows the 404 copy, no exception. → Task 4 (`state.read`) and Task 10 (player 404).
5. **Missing item icons and Crafatar outages:** fallback square, no repeated failing requests. → Task 6 tests.

---

## File map

| Path | Responsibility |
|---|---|
| `tools/dev_server.py` | Serve `_site/`, proxy `/api/stats/*` |
| `tests/test_dev_server.py` | unittest for the proxy |
| `assets/js/stats/format.js` | `S.fmt`: numbers, units, labels, badges, spotlight text, date labels (pure) |
| `assets/js/stats/chartmath.js` | `S.cm`: time/value scales, step paths, valueAt, trim (pure) |
| `assets/js/stats/activity.js` | `S.act`: activity binning (pure) |
| `assets/js/stats/core.js` | `S.api`, `S.ApiError`, `S.errorText`, `S.meta`, `S.state`, `S.scopeInfo`, `S.rangeParams` |
| `assets/js/stats/chart.js` | `S.chart(el, opts)` SVG step chart with hover/keyboard |
| `assets/js/stats/viz.js` | `S.viz.clock`, `S.viz.heatmap` |
| `assets/js/stats/ui.js` | `S.ui`: head, icon, controls bar, autocomplete, tabs, paged table, empty/error |
| `assets/js/stats/pages/*.js` | One per page |
| `assets/css/stats.css` | All Stats styles |
| `_layouts/stats.html` | Chained on `default`; loads stats CSS/JS |
| `stats/{index,explorer,scoreboards,player,compare,milestones}.html` | Pages |
| `_data/nav.yml`, `_layouts/default.html`, `assets/css/chronos.css`, `assets/js/chronos.js`, `index.html` | Nav dropdown + home tile |
| `tests/stats/*.test.cjs` | Node tests (pure + Playwright DOM) |
| `tools/check_stats.cjs` | Playwright smoke + screenshots of every Stats page via the dev server |

**Module pattern for every `assets/js/stats/*.js` file** (lets Node `require` the pure ones):

```js
(function (root) {
  const S = root.S = root.S || {};
  /* ... */ S.fmt = { compact, display /* ... */ };
  if (typeof module !== 'undefined') module.exports = S.fmt;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Running tests:** `node --test tests/stats/` (DOM tests need `NODE_PATH` = output of `npm root -g` so `require('playwright')` resolves; set it in the command: PowerShell `$env:NODE_PATH = (npm root -g); node --test tests/stats/`). Python: `python -m unittest tests.test_dev_server -v`.

---

### Task 1: Dev server proxy

**Files:**
- Create: `tools/dev_server.py`, `tests/test_dev_server.py`, `tests/__init__.py` (empty)
- Modify: `_config.yml` (add `tests` to `exclude`)

**Interfaces:**
- Produces: `python tools/dev_server.py [--port 4000]` serving `_site/` at `http://localhost:4000` (prints that URL), forwarding `/api/stats/*` to `os.environ.get("STATS_API_ORIGIN", "https://www.chronosmc.com")`. Module exposes `make_server(port: int, site_dir: str, origin: str) -> http.server.ThreadingHTTPServer` for tests.

- [ ] **Step 1: Write failing tests** in `tests/test_dev_server.py`. Start a fake upstream `ThreadingHTTPServer` on port 0 that records request headers and answers `/api/stats/meta?x=1` with `200`, body `{"ok":1}`, headers `ETag: W/"abc"`, `Cache-Control: public, max-age=60`, `Content-Type: application/json`; and answers any request with `If-None-Match: W/"abc"` with `304`. Start `make_server(0, <tmp dir with index.html "hi">, "http://127.0.0.1:<up>")`. Tests:
  - `test_static_served`: GET `/` → 200, body `hi`.
  - `test_proxy_passes_path_query_and_headers`: GET `/api/stats/meta?x=1` → 200, body `{"ok":1}`, response `ETag == 'W/"abc"'`, `Cache-Control` and `Content-Type` unchanged; upstream saw path `/api/stats/meta?x=1`, a `User-Agent` containing `Mozilla/5.0`, and `Host` equal to the origin's host.
  - `test_proxy_304`: GET with `If-None-Match: W/"abc"` → status 304 passed through.
  - `test_upstream_error_status_passed`: upstream path `/api/stats/player/nobody` returns 404 JSON → client gets 404 and the same body.
  - `test_non_stats_api_not_proxied`: GET `/api/status` → 404 from the static server (only `/api/stats/` is forwarded).
- [ ] **Step 2: Run** `python -m unittest tests.test_dev_server -v` → FAIL (module missing).
- [ ] **Step 3: Implement `tools/dev_server.py`** with `http.server.SimpleHTTPRequestHandler` (directory = site dir) and `urllib.request` for forwarding; only GET; forward `If-None-Match`; send `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36` and `Host`; on `HTTPError` relay its status/headers/body; copy back only `Content-Type`, `ETag`, `Cache-Control`; for `/` paths ending in `/` serve `index.html`. `main()` parses `--port` (default 4000), uses `_site` next to the repo root, prints `Chronos dev server: http://localhost:<port>  (API -> <origin>)`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Prove it live.** `curl -s -o NUL -w "%{http_code}" -A "Mozilla/5.0" https://www.chronosmc.com/api/stats/meta` → `200`; run `bundle exec jekyll build`, start the server in the background, `curl -s -o NUL -w "%{http_code}" http://localhost:4000/api/stats/meta` → `200`. Record both codes in the task report.
- [ ] **Step 6: Commit** `feat(stats): local dev server proxying /api/stats`.

### Task 2: `S.fmt`: formatting, labels, badges, spotlight

**Files:**
- Create: `assets/js/stats/format.js`, `tests/stats/format.test.cjs`

**Interfaces:**
- Produces `S.fmt`:
  - `compact(n: number) -> string`
  - `display(category: string, key: string, raw: number) -> {text: string, exact: string}`
  - `statLabel(category: string|null, key: string) -> {cat: string, name: string, full: string}` (`category` null/`'scoreboard'` → objective: `cat ''`, `name` = key unchanged)
  - `itemId(key: string) -> string` (strip namespace)
  - `playerName(p: {uuid, name}) -> string`
  - `date(unix: number) -> string` (`'24 Nov 2026'`)
  - `when(row: {at, earliest_known, approximate}) -> {kind: 'exact'|'by'|'earliest', text: string}`
  - `badge(badgeKey: string, badges: object /* meta.settings.badges */) -> {name, family, tier: number /* 1-based, 0 = retired/untiered */, art: string|null, desc: string}`
  - `spotlight(spot: object, serverLabel: string) -> string` (escaped HTML; name in `<b>`, ratio in `<span class="st-num">`)
  - constants `CATEGORY`, `VERB`, `NOUN`, and `HEADLINES = [['minecraft:custom','minecraft:play_time','Hours played'], ['minecraft:custom','minecraft:walk_one_cm','Distance walked'], ['minecraft:custom','minecraft:mob_kills','Mobs killed'], ['minecraft:custom','minecraft:deaths','Deaths']]` (the one curated list; used by Overview and Player)

- [ ] **Step 1: Write failing tests** (`require('../../assets/js/stats/format.js')`):

```js
test('compact', () => {
  assert.equal(compact(1552), '1,552'); assert.equal(compact(9999), '9,999');
  assert.equal(compact(20000), '20K'); assert.equal(compact(21700), '21.7K');
  assert.equal(compact(500500), '500.5K'); assert.equal(compact(1e6), '1M');
  assert.equal(compact(55490136), '55.5M'); assert.equal(compact(3460000000), '3.46B');
  assert.equal(compact(0), '0');
});
test('display units', () => {
  assert.equal(display('minecraft:custom','minecraft:play_time',125365377).text, '1,741 h');
  assert.equal(display('minecraft:custom','minecraft:play_time',36000).text, '30 min');
  assert.equal(display('minecraft:custom','minecraft:walk_one_cm',105920516).text, '1,059 km');
  assert.equal(display('minecraft:custom','minecraft:walk_one_cm',45000).text, '450 m');
  assert.equal(display('minecraft:custom','minecraft:damage_dealt',12345).text, '1,235');   // tenths
  assert.equal(display('minecraft:mined','minecraft:stone',1234567).text, '1.2M');
  assert.equal(display('minecraft:mined','minecraft:stone',1234567).exact, '1,234,567');
  assert.equal(display('minecraft:custom','minecraft:sneak_time',72000*20000).text, '20K h');
});
test('labels', () => {
  assert.deepEqual(statLabel('minecraft:used','minecraft:redstone_torch'), {cat:'Used', name:'Redstone torch', full:'Used · Redstone torch'});
  assert.deepEqual(statLabel('minecraft:custom','minecraft:leave_game'), {cat:'', name:'Leave game', full:'Leave game'});
  assert.equal(statLabel(null,'p.bedrock').full, 'p.bedrock');
  assert.equal(playerName({uuid:'b733bdf3-ed4c-48cb', name:null}), 'b733bdf3');
  assert.equal(playerName({uuid:'x', name:'<b>'}), '<b>');            // escaping is the renderer's job
});
test('when', () => {
  assert.deepEqual(when({at:1795528256, earliest_known:0, approximate:1}), {kind:'by', text:'by 24 Nov 2026'});
  assert.deepEqual(when({at:1795528256, earliest_known:1, approximate:0}), {kind:'earliest', text:''});
  assert.deepEqual(when({at:1795528256, earliest_known:0, approximate:0}), {kind:'exact', text:'24 Nov 2026'});
});
test('badges', () => {
  const B = {firsts:[1,10,50], top1:[1,10,50], big_numbers:[1000000,10000000], category_tiers:[100000,1000000,10000000]};
  assert.equal(badge('firsts:10', B).name, 'Pioneer');
  assert.equal(badge('top1:50', B).name, 'Legend');
  assert.equal(badge('milestone:10000000', B).name, 'Ten-Millionaire');
  assert.equal(badge('cat:minecraft:picked_up:3', B).name, 'Collector III');
  assert.equal(badge('cat:minecraft:picked_up:3', B).art, 'hopper');
  assert.equal(badge('veteran', B).name, 'Veteran');
  assert.equal(badge('night_owl', B).name, 'Night Owl');
  assert.equal(badge('firsts:20', B).tier, 0);              // retired tier
  assert.equal(badge('firsts:20', B).name, 'Firsts');
});
test('spotlight escapes and follows templates', () => {
  const s = spotlight({trigger:'outlier', name:'Papi<script>', category:'minecraft:used', key:'minecraft:crimson_hyphae', value:38, detail:{median:2.5, ratio:15.2, holders:18}}, 'CMP');
  assert.ok(s.includes('Papi&lt;script&gt;'));
  assert.equal(s.replace(/<[^>]+>/g,''), 'Papi&lt;script&gt; has used 15.2× more crimson hyphae than the average player');
  assert.equal(spotlight({trigger:'rare', name:'A', category:'minecraft:mined', key:'minecraft:sponge', value:3, detail:{holders:4}}, 'SMP').replace(/<[^>]+>/g,''), 'Only 4 players have ever mined sponge. A has 3.');
  assert.equal(spotlight({trigger:'mover', name:'T', category:'minecraft:custom', key:'minecraft:play_time', value:3473310, detail:{from:2149856, delta:1323454}}, 'CMP').replace(/<[^>]+>/g,''), "T's play time went from 30 h to 48 h this week");
  assert.equal(spotlight({trigger:null}, ''), '');
});
```

- [ ] **Step 2: Run** `node --test tests/stats/format.test.cjs` → FAIL.
- [ ] **Step 3: Implement `assets/js/stats/format.js`.** Rules:
  - `compact`: `<1e4` → `Math.round(n).toLocaleString('en-US')`; `<1e6` → `n/1e3` `toFixed(1)` with trailing `.0` trimmed + `K`; `<1e9` → same with `M`; else `toFixed(2)` trimmed of trailing zeros + `B`.
  - `display`: `_one_cm` → `raw/100` m; `≥1000 m` → `compact(round(raw/1e5))+' km'`, else `round(m)+' m'`. Tick keys exactly `play_time, total_world_time, time_since_death, time_since_rest, sneak_time` → hours `raw/72000`; `<1 h` → `round(raw/1200)+' min'`, else `compact(round(h))+' h'`. `damage_*` → `compact(raw/10)`. Else `compact(raw)`. `exact` = `raw.toLocaleString('en-US')` for counts, or the full unit value to 1 decimal + unit for unit stats (e.g. `'1,741.2 h'`).
  - `CATEGORY` names: mined Mined, used Used, crafted Crafted, broken Broken, picked_up Picked up, dropped Dropped, killed Killed, killed_by Killed by, custom `''`; unknown category → title-cased id.
  - `VERB`: mined mined, used used, crafted crafted, broken broken, picked_up picked up, dropped dropped, killed killed, killed_by `been killed by`.
  - `NOUN` (badges): mined Miner, used Builder, crafted Crafter, broken Toolbreaker, picked_up Collector, dropped Dropper, killed Hunter, killed_by Victim.
  - `badge`: tier names by position in the matching settings list: firsts → Trailblazer/Pioneer/Founder (art `spyglass`), top1 → Champion/Dominator/Legend (`gold_block`), `milestone:<n>` against `big_numbers` → Millionaire/Ten-Millionaire (`experience_bottle`); `cat:<category>:<1|2|3>` → `NOUN + ' ' + I/II/III` (art: mined `diamond_pickaxe`, used `bricks`, crafted `crafting_table`, picked_up `hopper`, others null), desc `"<Category> total ≥ <compact(category_tiers[t-1])>"`; veteran/regular/night_owl/overtaker → Veteran/Regular/Night Owl/Overtaker (art null). Number not in list → tier 0, generic name Firsts / Number one / Big number. `desc` strings: firsts `"<n> real first(s) on this server"`, top1 `"#1 in <n> stat(s) at once"`, milestone `"One stat past <compact(n)>"`, veteran `"<veteran_hours> h played"` (fallback 1,000), regular `"Active on <days> of the last <window_days> days"`, night_owl `"Mostly plays <start>:00–<end>:00"`, overtaker `"Passed the player above in a rivalry"`.
  - `spotlight` templates (thing = `statLabel(...).name` lowercased; values through `display(...).text`; `{relative}` = `C.ago`-style via a local helper): non-custom per STATS_API table with `VERB`; `custom` category: outlier `"{name}'s {thing} is {ratio}× the average player's"`, rare `"Only {holders} players have any {thing}. {name} has {value}."`, recent_milestone `"{name} passed {threshold} {thing} {relative}"`, recent_first `"{name} was the first on {server} to get any {thing}"`, mover `"{name}'s {thing} went from {from} to {value} this week"`. `trigger: null` → `''`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(stats): formatting, labels, badges and spotlight text`.

### Task 3: Chart maths + SVG step chart

**Files:**
- Create: `assets/js/stats/chartmath.js`, `assets/js/stats/chart.js`, `tests/stats/chartmath.test.cjs`, `tests/stats/chart.dom.test.cjs`

**Interfaces:**
- Produces `S.cm` (pure):
  - `timeScale(t0, t1, liveAt|null, x0, x1) -> fn(t)->x` with property `split` (x of `liveAt`, or `null` when linear). Piecewise iff `liveAt` and `t0 < liveAt < t1`: `[t0,liveAt]` maps to the first 45% of `[x0,x1]`.
  - `niceMax(v) -> number` (≥ v, 1/2/2.5/5 × 10^k; 0 → 1)
  - `trimLeading(points) -> points` (drop leading `value === 0` points before the first non-zero; all-zero → last point only; `[]` → `[]`)
  - `stepPath(points, x, y, tEnd) -> string` (`M x,y` then `H x V y` per point, final `H x(tEnd)`; `''` for `[]`)
  - `valueAt(points, t) -> number|null`
  - `changePoints(seriesList) -> number[]` (sorted unique timestamps)
- Produces `S.chart(el, opts) -> {update(opts), destroy()}`, `opts = {series: [{id, label, color, points: [[t,v],...]}], from, to, liveAt: number|null, format: (v)=>string, height: number = 300, emptyText: string}`.

- [ ] **Step 1: Write failing pure tests**:

```js
test('timeScale linear when live outside range', () => { const x = timeScale(0, 100, null, 0, 1000); assert.equal(x(50), 500); assert.equal(x.split, null); });
test('timeScale split', () => { const x = timeScale(0, 100, 90, 0, 1000); assert.equal(x(90), 450); assert.equal(x(0), 0); assert.equal(x(100), 1000); assert.equal(x.split, 450); assert.equal(x(95), 725); });
test('niceMax', () => { assert.equal(niceMax(0), 1); assert.equal(niceMax(495200), 500000); assert.equal(niceMax(1.3e9), 2e9); assert.equal(niceMax(2.2e6), 2.5e6); });
test('trimLeading', () => { assert.deepEqual(trimLeading([[1,0],[2,0],[3,5],[4,0]]), [[3,5],[4,0]]); assert.deepEqual(trimLeading([[1,0],[2,0]]), [[2,0]]); assert.deepEqual(trimLeading([]), []); });
test('stepPath', () => { assert.equal(stepPath([[0,0],[10,5]], t=>t, v=>v, 20), 'M0,0H10V5H20'); assert.equal(stepPath([], t=>t, v=>v, 1), ''); });
test('valueAt', () => { const p = [[10,1],[20,2]]; assert.equal(valueAt(p, 5), null); assert.equal(valueAt(p, 10), 1); assert.equal(valueAt(p, 19), 1); assert.equal(valueAt(p, 99), 2); });
test('changePoints', () => assert.deepEqual(changePoints([[[3,1],[1,1]],[[2,1],[3,2]]]), [1,2,3]));
```

- [ ] **Step 2: Write failing DOM tests** (`chart.dom.test.cjs`: launch Chromium, `page.setContent('<div id=c style="width:800px"></div>')`, `addScriptTag({path})` for `chartmath.js` then `chart.js`, call `S.chart` via `page.evaluate`):
  - `renders one path per non-empty series` → 2 series in → 2 `path.st-line` elements, no `NaN` in any `d` attribute.
  - `empty series shows emptyText` → all `points: []` → element `.st-empty` with the text, no `svg`.
  - `single point renders value card` → every series ≤1 point → `.st-valuecard` containing `format(value)`, no `path.st-line`.
  - `split axis draws backups zone` → `liveAt` inside range → one `rect.st-zone`; `liveAt: null` → none.
  - `hover shows tooltip` → `mouse.move` over the plot → `.st-tip` visible with the date and each series label + formatted value.
  - `keyboard steps through change points` → focus svg (`tabindex=0`), press ArrowRight twice → tooltip date equals the 2nd change point's date.
- [ ] **Step 3: Run** `node --test tests/stats/` → FAIL.
- [ ] **Step 4: Implement `chartmath.js`** per signatures.
- [ ] **Step 5: Implement `chart.js`.** SVG `viewBox="0 0 1000 <height>"` scaled to width; left padding 58, bottom 26; 4 gridlines labelled with `opts.format`; x labels = years when the span > 2 years, else days (`24 Nov`) — in a split chart, years on the backups side and days on the live side; zone `rect.st-zone` + labels `BACKUPS` (amber) and `LIVE · EVERY 15 MIN` (teal); lines via `trimLeading` + `stepPath`, class `st-line`, `stroke=color`; points with `t < liveAt` get `circle.st-dot`; area fill only when there is exactly one series. Hover: vertical crosshair + `.st-tip` (HTML, absolutely positioned) listing `date` and `label: format(valueAt)` per series. Keyboard: `ArrowLeft/Right/Home/End` over `changePoints`. Draw-in: `stroke-dasharray` animation once on first render unless reduced motion. `update(opts)` re-renders; `destroy()` removes listeners.
- [ ] **Step 6: Run tests** → PASS.
- [ ] **Step 7: Commit** `feat(stats): SVG step chart with split time axis and tooltips`.

### Task 4: Core: API client, meta, URL state, scopes

**Files:**
- Create: `assets/js/stats/core.js`, `tests/stats/core.test.cjs`

**Interfaces:**
- Produces on `S`:
  - `class ApiError extends Error {status: number, kind: 'http'|'blocked'|'network'}`
  - `api(path: string, params?: object) -> Promise<any>` — URL `/api/stats/<path>?<params without null/undefined/''>`; uses global `fetch` with no cache option.
  - `errorText(err) -> string`
  - `meta() -> Promise<Meta>` (memoized per page)
  - `state.read(meta, extraDefaults?: object) -> {scope, bots: boolean, range: string|null, from: number|null, to: number|null, ...extras}`; `state.write(st)` → `history.replaceState` + `localStorage['stats.scope']`
  - `scopeInfo(meta, scope) -> {servers: string[]|null, hasSmp: boolean, parts: string[]}`
  - `rangeParams(st) -> {range}|{from,to}|{}`

- [ ] **Step 1: Write failing tests** (Node; stub `globalThis.fetch`, `globalThis.location`, `globalThis.history`, `globalThis.localStorage` before `require`):
  - `api builds query and parses json`: `api('leaderboard', {kind:'stat', key:'minecraft:stone', from:null, limit:50})` requests exactly `/api/stats/leaderboard?kind=stat&key=minecraft%3Astone&limit=50`.
  - `api throws http error with server message`: 404 `{"error":"player not found"}` → `ApiError` `status 404`, `kind 'http'`, `message 'player not found'`; 422 `{"detail":[...]}` → `kind 'http'`.
  - `api detects cloudflare html`: 403 `text/html` `<!DOCTYPE html>` → `kind 'blocked'`; also 200 with an HTML body → `kind 'blocked'`.
  - `api network failure`: fetch rejects → `kind 'network'`.
  - `errorText`: blocked → `"The stats server didn't answer. Try again in a minute."`; network → `"Couldn't reach the stats server. Check your connection and try again."`; http 404 player → `"No player by that name. Check the spelling or search for them."`; other http → `"The stats server rejected that request (<message>)."`.
  - `state.read defaults to smp`: empty query, meta.scopes `['all','smp','cmps','cmp']` → `scope 'smp'`, `bots false`, `range null`.
  - `state.read rejects bad values`: `?scope=foo&range=7y&from=abc` → `scope 'smp'`, `range null`, `from null`; `?range=1w` → `'1w'` (valid = keys of `meta.settings.range_presets` + `'all'`); `?scope=cmp2` with cmp2 in scopes → `'cmp2'`; localStorage `stats.scope='all'` and no query → `'all'`.
  - `scopeInfo with scope_groups`: meta with `scope_groups:{cmps:['cmp','cmp2']}`, servers smp(filters_bots) cmp cmp2 → `scopeInfo(m,'all')` = `{servers:['smp','cmp','cmp2'], hasSmp:true, parts:['smp','cmps']}`; `'cmps'` → `hasSmp:false, parts:['cmps']`; `'cmp'` → `{servers:['cmp'], hasSmp:false, parts:['cmp']}`.
  - `scopeInfo fallback without scope_groups`: `'all'` → `{servers:null, hasSmp:true, parts:['all']}`; `'cmps'` → `hasSmp:false`; `'smp'` → `hasSmp:true`.
  - `rangeParams`: `{range:'1w'}` → `{range:'1w'}`; `{from:1,to:2}` → `{from:1,to:2}`; none → `{}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `core.js`.** Fallback rule for `hasSmp` without `scope_groups`: `true` for `'all'` and for any single-server scope whose server has `filters_bots`, else `false`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(stats): API client, URL state and scope helpers`.

### Task 5: Activity binning, pulse clock and heatmap

**Files:**
- Create: `assets/js/stats/activity.js`, `assets/js/stats/viz.js`, `tests/stats/activity.test.cjs`

**Interfaces:**
- Produces `S.act.bin(buckets: [t, n][], bucketSeconds: number, to: number, tz?: (t)=>{day:0..6 /*Mon=0*/, hour:0..23}) -> {hours: number[24], grid: number[7][24], days: number, filled: boolean}` — slots run from the first bucket to `to` in steps of `bucketSeconds`; missing slots count as 0; each cell is the average over the slots that fall in it; `days` = distinct local dates with any slot; `filled = days >= 7`. Default `tz` uses the browser's local time.
- Produces `S.viz.clock(el, hours, {now: Date})` and `S.viz.heatmap(el, grid)` (SVG; teal intensity by value / max; hour labels 00/06/12/18; weekday labels Mon–Sun; `title` on each cell with the average).

- [ ] **Step 1: Write failing tests** (inject a UTC `tz` for determinism):
  - two slots 900 s apart at hour 10 UTC Monday with values 4 and 0 (second missing from buckets) → `hours[10] === 2`, `grid[0][10] === 2`, `days === 1`, `filled === false`.
  - 8 days of slots → `filled === true`.
  - empty buckets → all zeros, `days 0`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `activity.js`, then `viz.js` (draw code can follow the mockup's `clock()`). **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(stats): activity binning, pulse clock and heatmap`.

### Task 6: UI kit: heads, icons, controls, autocomplete, tabs, tables

**Files:**
- Create: `assets/js/stats/ui.js`, `tests/stats/ui.dom.test.cjs`

**Interfaces:**
- Consumes: `S.fmt`, `S.api`, `S.meta`, `S.state`, `S.scopeInfo`, `C.esc`, `C.ago`.
- Produces `S.ui`:
  - `head(uuid: string, size = 32) -> HTMLElement` (img: Crafatar `https://crafatar.com/avatars/<uuid>?size=<size>&overlay` → on error mc-heads `https://mc-heads.net/avatar/<uuid>/<size>` → on error `span.st-letter` with `?`)
  - `icon(id: string, size = 24, letter = id[0]) -> HTMLElement` (img `/cache/items/<id>.png` lazy → on error `span.st-letter`; ids that failed once are remembered in a `Set` and rendered as letters directly)
  - `controls(el, meta, st, onChange(st), {range: boolean}) -> {setSynced(lastRunAt)}`: scope segmented buttons for `meta.scopes` that are `all`, group scopes or ungrouped servers (others go into a `<select>` "Server"), bots checkbox shown only when `S.scopeInfo(meta, st.scope).hasSmp`, range buttons from `range_presets` + `ALL` + `Custom` (two `<input type=date>`), synced pill via `C.stamp`-like logic using `meta.last_run_at` (stale after 1 h). Writes URL via `S.state.write`.
  - `autocomplete(input, {onPick(item: {type:'player'|'stat'|'objective', ...})})`: debounce 120 ms on `/search?q=&limit=10`; groups Players / Stats / Objectives; stats with the same key across categories listed under one key with category sub-options; ArrowUp/Down, Enter, Esc; `role=combobox`/`listbox` ARIA.
  - `tabs(el, [{id, label, count?}], onSelect(id))`
  - `table(el, {columns: [{id, label, num?, sort?}], rows, pageSize = 50, sortBy, rowHtml(row) -> string, onRow?(row)})` — client-side sort + "Load more"
  - `empty(el, text)`, `error(el, err)` (`.panel.err` with `S.errorText`)
- [ ] **Step 1: Write failing DOM tests** (route `**/crafatar.com/**` to 500, `**/mc-heads.net/**` to 500, `**/cache/items/missing_thing.png` to 404, `**/cache/items/stone.png` to a 1×1 png, `**/api/stats/search**` to fixture JSON):
  - `head falls back to letter when both services fail` → after load, element is `.st-letter`, zero broken `img` (`naturalWidth 0`) in the DOM.
  - `icon fallback and memo` → `icon('missing_thing')` twice → only one request to that URL; both render `.st-letter`. `icon('stone')` → img.
  - `autocomplete escapes and navigates` → fixture player name `<img src=x onerror=alert(1)>` renders as text (no `img` inside the listbox except heads); ArrowDown+Enter calls `onPick` with the first item.
  - `controls hide bots toggle on cmps` → scope cmps → no bots checkbox; smp → checkbox present; clicking `1W` calls `onChange` with `range:'1w'` and the URL contains `range=1w`.
  - `table sorts and pages` → 120 rows, pageSize 50 → 50 rows, "Load more" → 100; clicking the value header sorts descending.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(stats): UI kit (heads, icons, controls, autocomplete, tables)`.

### Task 7: Stats layout, CSS, nav dropdown, home tile, smoke checker

**Files:**
- Create: `_layouts/stats.html`, `assets/css/stats.css`, `stats/index.html` (placeholder body `<div class="page"><h1>Stats</h1><div id="st-app"></div></div>`, replaced in Task 8), `tools/check_stats.cjs`
- Modify: `_data/nav.yml`, `_layouts/default.html`, `assets/css/chronos.css`, `assets/js/chronos.js`, `index.html`

**Interfaces:**
- Produces: `layout: stats` (front matter on every Stats page: `layout: stats`, `permalink`, `title`, `bg: chronos_spawn`, `page_js: <name>`). The stats layout has `layout: default`, outputs `{{ content }}` and then script tags (each with `?v=`) for `format.js, chartmath.js, activity.js, core.js, chart.js, viz.js, ui.js` and `pages/{{ page.page_js }}.js`. `default.html` adds `<link rel="stylesheet" href="/assets/css/stats.css?v=…">` in `<head>` when `page.url contains '/stats/'`.
- Produces: `node tools/check_stats.cjs [baseUrl=http://localhost:4000]` → visits all six Stats URLs at 1400×900 and 390×844, fails (exit 1) on any console error, page error, or same-origin response ≥ 400 (except `/cache/items/` 404s, which are expected), and writes screenshots to `%TEMP%/stats-shots/<page>-<width>.png`. Prints one line per page.
- [ ] **Step 1: nav.yml**: insert after Status: `- {title: Stats, url: /stats/, desc: "Every stat on every server, with history", hint: "Live", children: [{title: Overview, url: /stats/}, {title: Explorer, url: /stats/explorer/}, {title: Scoreboards, url: /stats/scoreboards/}, {title: Player, url: /stats/player/}, {title: Compare, url: /stats/compare/}, {title: Milestones, url: /stats/milestones/}]}`.
- [ ] **Step 2: default.html**: an entry with `children` renders `<div class="dd"><button class="dd-btn" aria-expanded="false" aria-haspopup="true">Stats ▾</button><div class="dd-menu" hidden>…links…</div></div>`; `aria-current` on the button when `page.url` starts with `/stats/`, and on the matching child. The menu is positioned `fixed` under the button (computed in JS from `getBoundingClientRect`) so `.links{overflow-x:auto}` cannot clip it.
- [ ] **Step 3: chronos.js**: dropdown behaviour (click/Enter/Space toggle, Esc closes and refocuses the button, ArrowDown/Up move between items, outside click closes, reposition on resize/scroll of `.links`). **chronos.css**: `.dd*` styles matching `.links a` (same font, teal underline for active).
- [ ] **Step 4: index.html**: the explore-tile loop skips `children` entries' children (they are not in the top-level list, so nothing to do) but the Stats tile makes 7 tiles in a 3-column grid; render the Stats tile first with `style="grid-column:1/-1"` and add a 7th stagger delay (`0,60,110,150,185,215,240`).
- [ ] **Step 5: stats.css**: base styles moved from the mockups, renamed with `st-` prefix: controls bar (`.st-bar`, `.st-seg`, `.st-sel`), tiles (`.st-tiles`, `.st-tile`, `.st-split`), chart (`.st-chart`, `.st-zone`, `.st-line`, `.st-dot`, `.st-tip`, `.st-empty`, `.st-valuecard`), feed rows, badges (`.st-badge` with `.st-art{flex:none;width:30px;height:30px}`), #1 cards (`.st-pod`), tables, tabs, `.st-letter`, `.st-num`, CMP colour `--cmp:#c9b37e`, breakpoints 820/560 px, reduced motion.
- [ ] **Step 6: check_stats.cjs** as specified.
- [ ] **Step 7: Verify**: `bundle exec jekyll build`, start dev server, `node tools/check_stats.cjs` → `/stats/` passes (other URLs 404 for now — the script takes `--only /stats/` for this task). Manually (Playwright screenshot) confirm the dropdown opens over the page on desktop and at 390 px, and the home page shows the Stats tile full width with no layout break.
- [ ] **Step 8: Commit** `feat(stats): stats layout, nav dropdown, styles, smoke checker`.

### Task 8: Overview page

**Files:**
- Modify: `stats/index.html` (front matter `layout: stats`, `permalink: /stats/`, `title: Stats`, `page_js: overview`)
- Create: `assets/js/stats/pages/overview.js`

**Interfaces:** Consumes everything above, including `S.fmt.HEADLINES` (skip any key not present in `/keys?kind=stat` for the scope).

- [ ] **Step 1: Layout** per spec §5.1 and mockup A: h1, controls (range on), 4 `.st-tile` buttons (`aria-pressed`), big chart, two-column row (spotlight | pulse card with `Clock / Week` toggle), panel with tabs `Milestones` / `Firsts`, link "All milestones" to `/stats/milestones/`.
- [ ] **Step 2: Data**: first paint = `S.meta()` + `/totals` for the selected tile (`scopes` = `scopeInfo.parts` joined, `kind=stat`, `category`, `key`, range params, `include_bots`). Then in parallel: the other three `/totals` (tile values = last point of each part, summed; split bar only when `parts.length > 1`), `/spotlight` (`seen` from `sessionStorage['stats.seen']`, keep last 10 `category|key`; `trigger:null` hides the card), `/activity` (`scope`, `range` = largest preset ≥ 30 days from `range_presets`, else `all`), `/milestones?limit=8`. The Firsts tab loads `/firsts` only when opened, using `limit=8&order=newest` and falling back to client-side newest-8 if the response is the full list.
- [ ] **Step 3: Behaviour**: tile click swaps the chart (no refetch of the other tiles); scope/bots/range change re-runs the data step; chart `liveAt` = `min(meta.live_started_at[s] for servers in scope)` when `meta.live_started_at` exists, else `null`; pulse empty state while `!filled`: title "The pulse is still filling in", body "Activity has been recorded since <date of first bucket>. After a week this shows when Chronos is busiest in your timezone." (draw what exists behind it at 40 % opacity). "Another" spotlight button refetches with `seen`.
- [ ] **Step 4: Verify** `node tools/check_stats.cjs --only /stats/` → pass; look at both screenshots; compare against mockup A; try `?scope=all`, `?scope=cmps`, `?range=1w`, `?scope=foo`.
- [ ] **Step 5: Commit** `feat(stats): overview page`.

### Task 9: Explorer and Scoreboards

**Files:**
- Create: `stats/explorer.html` (`page_js: explorer`, `permalink: /stats/explorer/`, `title: Stat explorer`), `stats/scoreboards.html` (`page_js: explorer`, body `data-kind="scoreboard"`, `permalink: /stats/scoreboards/`, `title: Scoreboards`), `assets/js/stats/pages/explorer.js`

- [ ] **Step 1: Layout**: h1, big autocomplete search, controls, two-column browse (left: category buttons from `meta.categories` + filterable key list from `/keys` with icons; Scoreboards: objective list with a `removed` tag) | right: selected stat header (icon, `statLabel.full`, servers), chart with mode toggle `Top players` / `Servers`, leaderboard table (rank with ties as given, head, name linking to `/stats/player/?p=<name or uuid>`, value via `display`, "Load more" by `limit` steps of 50 up to `settings.limits.leaderboard`).
- [ ] **Step 2: Data**: URL state `kind`, `cat`, `key` (default when none chosen: `minecraft:custom|minecraft:play_time` for stats, first objective for scoreboards). Leaderboard `/leaderboard`; chart Top players = `/series` for the first `settings.limits.series_players` uuids of the current leaderboard (clicking a row toggles its line, max that many); Servers = `/totals` with `scopes` = `scopeInfo(meta,'all').parts` (fallback `[st.scope]`). Delta mode (range set) labels the value column "Gained" and shows "since <effective_from date>" when clamped.
- [ ] **Step 3: Autocomplete picks**: player → navigate to player page; stat → select it; objective → `/stats/scoreboards/?key=<objective>`.
- [ ] **Step 4: Verify** `check_stats.cjs --only /stats/explorer/,/stats/scoreboards/`; keyboard-only run through search → pick → table.
- [ ] **Step 5: Commit** `feat(stats): explorer and scoreboards pages`.

### Task 10: Player page

**Files:**
- Create: `stats/player.html` (`page_js: player`, `permalink: /stats/player/`, `title: Player`), `assets/js/stats/pages/player.js`

- [ ] **Step 1: No `?p=`**: show the player search (autocomplete restricted to players) with copy "Search for a player to see their stats, badges and records." and nothing else.
- [ ] **Step 2: Layout** per spec §5.2 / `player-v2.html`: header (body render `https://mc-heads.net/body/<uuid>/120` with head-chain fallback, name or `playerName`, server chips in API order, "last seen <C.ago>" when `last_activity`, "Bot account on SMP" pill when `is_bot_on_smp`), giant #1 count (`stats.filter(rank===1).length`; 0 → show best rank `#r` with caption "best rank"), 4 headline tiles with rank (`S.fmt.HEADLINES`), badges (merge same key across servers; sort by tier desc then server count desc), "Number one in" grid (7 cards + "+N more", else "Best ranks" by `rank/of`), full-width chart (`/series?uuids=<uuid>` for the selected stat, default play_time), tabs.
- [ ] **Step 3: Tabs**: All stats (filter text + category buttons for categories present + "#1 only" toggle that "See all N" switches on; table sorted by `rank/of`; clicking a row graphs it), Scoreboards, Milestones (`earliest_known` ones under "Already reached before tracking began"), Firsts (labels from `S.fmt.when`), Rivals (`other_name`, gap, "catching up in <overtake_days> days" or "gap widening", empty copy "No rivals yet. Rivals appear when another player is close behind in a stat and closing in.").
- [ ] **Step 4: Errors**: 404 → `S.ui.error` with the player-not-found copy plus the search box.
- [ ] **Step 5: Verify** `check_stats.cjs --only /stats/player/?p=Chezloc,/stats/player/?p=nobody_here_xyz,/stats/player/` (the 404 page must not count as a failure: the checker treats the API 404 for `?p=nobody…` as expected when the URL contains `nobody`); compare with `player-v2.html`.
- [ ] **Step 6: Commit** `feat(stats): player dossier page`.

### Task 11: Compare page

**Files:**
- Create: `stats/compare.html` (`page_js: compare`, `permalink: /stats/compare/`, `title: Compare`), `assets/js/stats/pages/compare.js`

- [ ] **Step 1**: player chips (add via player autocomplete, remove with ×; min/max from `settings.compare`), stat chips (stat/objective autocomplete; max `settings.compare.max_keys`), controls with range. Until the minimum is met: copy "Add at least <min_players> players and one stat to compare them."
- [ ] **Step 2**: `/compare?uuids=…&keys=<cat>|<key>,scoreboard|<obj>` → table rows = keys, columns = players (head + name), each cell value + bar relative to the row max, leader cell teal; clicking a row draws its `series` in the chart (one line per player, colours: teal, `--cmp`, then a fixed 4-colour extension chosen in stats.css). If any player has `is_bot_on_smp` (from `/compare` players or a `/player` lookup when added), set `bots=true` and show a note "Bots included because <name> is a bot account on SMP."
- [ ] **Step 3: Verify** `check_stats.cjs --only "/stats/compare/?players=Chezloc,PapiChase&keys=minecraft:custom|minecraft:play_time"`.
- [ ] **Step 4: Commit** `feat(stats): compare page`.

### Task 12: Milestones page

**Files:**
- Create: `stats/milestones.html` (`page_js: milestones`, `permalink: /stats/milestones/`, `title: Milestones`), `assets/js/stats/pages/milestones.js`

- [ ] **Step 1: Feed tab**: `/milestones?limit=50`, "Load more" with `before=next` until `next === null`; rows with `earliest_known:1` go under a quieter heading "Already reached before tracking began" (no dates).
- [ ] **Step 2: Firsts tab**: `/firsts` (with `order=newest&limit=<feed limit>` + paging when the backend supports it, else the full list once, cached in memory) → filter by server (from `meta.servers`), category, text; dated rows first; `S.ui.table` pagination.
- [ ] **Step 3: Rivalries tab**: `/rivalries?limit=50` → rows: both heads/names, stat, gap now vs `gap_7d_ago` as two bars, "overtakes in N days" (`overtake_days`, 1 decimal) or "gap widening"; empty copy as in Task 10.
- [ ] **Step 4: Verify** `check_stats.cjs --only /stats/milestones/` plus each tab via `?tab=firsts`, `?tab=rivals`.
- [ ] **Step 5: Commit** `feat(stats): milestones, firsts and rivalries page`.

### Task 13: Full check, docs, hand-off

**Files:**
- Modify: `CLAUDE.md` (Pages table + a "Stats section" subsection describing `assets/js/stats/`, `S.*` modules, `tools/dev_server.py`, `tools/check_stats.cjs`, test commands), `_config.yml` if anything new needs excluding

- [ ] **Step 1**: `node --test tests/stats/` and `python -m unittest tests.test_dev_server -v` → all pass.
- [ ] **Step 2**: `bundle exec jekyll build` → confirm `_site` has no `tests/`, `tools/`, `docs/`, `*.md` (`Get-ChildItem _site -Recurse -Include *.md,*.py,*.cjs` prints nothing).
- [ ] **Step 3**: `node tools/check_stats.cjs` (all pages, both widths) → all pass; review every screenshot.
- [ ] **Step 4**: Compare each live API response used against `STATS_API.md` field names; list any mismatch for the owner instead of working around it.
- [ ] **Step 5**: Update CLAUDE.md; commit `docs: stats section notes`.
