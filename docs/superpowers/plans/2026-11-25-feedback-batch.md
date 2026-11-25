# Owner feedback batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the rough edges from the owner's 2026-11-25 pass over the live site, and prepare the frontend hooks for the backend items.

**Architecture:** Plain Jekyll site, no bundler. Stats work lives in `assets/js/stats/*.js` (shared `S.*` modules) and `assets/js/stats/pages/*.js`. Non-stats pages are top-level `*.html` with inline scripts and `assets/css/chronos.css`. Tasks 1–14 need nothing from the backend. Tasks 15–19 are **blocked** until the backend ships its items and updates `STATS_API.md` (contract first, don't invent fields).

**Tech Stack:** Jekyll 4.2, vanilla JS (ES2017, IIFE modules on `window.S`), Node `node:test` + global Playwright for DOM tests, Python dev server.

**Spec:** `docs/superpowers/specs/2026-11-25-feedback-batch-design.md`

## Global Constraints

- Every API/Discord/player string reaches the DOM via `S.fmt.esc` / `C.esc` (or `textContent`).
- Servers/scopes in API order, never sorted (exception: `status.html`'s fixed list, spec item 7).
- No polling faster than 5 min, no cache-busters on API calls. New site-owned CSS/JS gets `?v={{ site.time | date: '%s' }}`.
- Stats CSS uses the `st-` prefix. `prefers-reduced-motion` is respected by anything that animates.
- Copy: plain, specific, no "AI" flourish. Nav/headers caps. Dates `en-GB` short via `S.fmt.date`.
- Keep Crafatar → mc-heads fallbacks for heads.
- Tests: `NODE_PATH="$(npm root -g)" node --test "tests/stats/*.cjs"` must pass after every task.
- Visual checks: dev server (`python tools/dev_server.py` + `bundle exec jekyll build`, Ruby at `C:\Ruby32-x64\bin`) at 1280px and 390px wide. Screenshots via `MSYS_NO_PATHCONV=1 NODE_PATH="$(npm root -g)" node tools/check_stats.cjs` where it covers the page.

## Review Focus

1. **Pages with one page of rows** (≤ page size): no pager at all, not a lone "1". Pinned in Task 6.
2. **Badge tooltip on touch**: a tap opens it and a tap elsewhere closes it, and two tooltips are never open at once. Pinned in Task 7.
3. **Servers chart on a scope with one server**: exactly one line, and the legend still shows. A scope whose servers all have `track_stats: false` shows the untracked empty state, not an empty chart. Pinned in Task 10.
4. **Value card + legend**: when the card shows, no `.st-k` swatches in the note; when a later update draws lines, the swatches come back. Pinned in Tasks 4–5.
5. **Search with leading/trailing/multiple spaces** (`"  redstone   block "`): sends `redstone_block`, not `_redstone___block_`. Pinned in Task 8.

---

### Task 1: Small CSS/markup fixes (pills, logo, world map)

**Files:**
- Modify: `assets/css/chronos.css:22-23` (`.brand`), `:53` (`.pill`), `:74-79` (`.mark`, `.wordmark`), `:214-218` (`.maphead`)
- Modify: `assets/css/stats.css` (any `st-` pill/chip that can sit inline in text: `.st-chip`, and the stamp pill)
- Modify: `worldmap.html`

- [ ] **Step 1:** `.pill{…;white-space:nowrap}`. Same for `.st-chip` if it holds a phrase.
- [ ] **Step 2:** Logo/wordmark optical centering. Nav: the `span` in `.brand` sits visually high next to the 24px logo, because Syncopate's caps sit above the line box centre. Fix with `line-height:1` plus a small `padding-top` (start at `.12em`) on `.brand span`. Home: same idea for `.wordmark` relative to `.mark`. Adjust by screenshot until the cap height is centred on the logo's midline. No absolute positioning.
- [ ] **Step 3:** `worldmap.html`: delete the `<h1>World map</h1>`. `.maphead` becomes right-aligned (`justify-content:flex-end`) so "Open full map ↗" sits top-right, clear of Overviewer's top-left zoom controls. Delete the `.maphead h1` rule.
- [ ] **Step 4:** Build, then check at 1280/390: storage lede pill moves whole onto the next line; nav logo + home hero look centred; world map controls uncovered.
- [ ] **Step 5:** Commit `fix: pills never wrap, centre wordmark on logo, drop world map heading`.

### Task 2: Status page: server order/caps, network row

**Files:** Modify: `status.html`

- [ ] **Step 1:** In the inline script add `const ORDER = ['smp','cmp','cmp2','cmp3','cmp4','mirror','snapshot','tour','public'];` and sort entries by `ORDER.indexOf(name.toLowerCase())`. Names not in the list (`-1`) go after, A–Z (`localeCompare`). Render the name `.toUpperCase()` (still through `C.esc`).
- [ ] **Step 2:** Network row: `row('Network', null, `${sent} <small>GB ↑</small> / ${recv} <small>GB ↓</small>`, 'sent / received since boot')`.
- [ ] **Step 3:** Check on the dev server with a stub `server_status.json` (keys mixed case, one unknown `zzz`): order SMP, CMP, CMP2… then ZZZ. Network value fits on one line at 390px. If it doesn't, the `↓` part wraps as a unit (`white-space:nowrap` on each half).
- [ ] **Step 4:** Commit `fix(status): fixed server order in caps, both network numbers on the right`.

### Task 3: Category icons

**Files:**
- Move: `flint_and_steel_damaged2.png` → `assets/img/cat-broken.png` (`git mv` won't work, it's untracked: plain move, then add)
- Modify: `assets/js/stats/format.js:22` (`CAT_ART`), exports at `:204`
- Modify: `assets/js/stats/ui.js:70-86` (`icon`)
- Modify: `assets/js/stats/pages/explorer.js:113` (category buttons)
- Test: `tests/stats/format.test.cjs`, `tests/stats/ui.dom.test.cjs`

**Interfaces:**
- Produces: `S.fmt.catIcon(category: string) -> string|null`: an item id (`'crafting_table'`) or a site path starting with `/` (`'/assets/img/cat-broken.png'`); `null` for unknown. `S.ui.icon(id, size, ch)` accepts either form: a value starting with `/` is used as the `src` as-is.

- [ ] **Step 1: Failing test** `catIcon maps every category`: `catIcon('minecraft:broken') === '/assets/img/cat-broken.png'`, `crafted→'crafting_table'`, `custom→'player_head'`, `dropped→'dirt'`, `killed→'diamond_sword'`, `killed_by→'creeper_spawn_egg'`, `mined→'diamond_pickaxe'`, `picked_up→'netherrack'`, `used→'firework_rocket'`, `'minecraft:nope'→null`. Also `badge('cat:minecraft:mined:2', {}).art === 'diamond_pickaxe'`.
- [ ] **Step 2:** Run, see it fail.
- [ ] **Step 3:** Replace `CAT_ART` with `CAT_ICON` holding that map (keyed by bare id), add `catIcon`, use it in `badge()`. In `ui.icon`, `src = id.charAt(0) === '/' ? id : '/cache/items/' + encodeURIComponent(id) + '.png'`. In explorer `paintCats`, the button art is `S.ui.iconHtml(F.catIcon(c) || '', 18, catLabel(c).charAt(0))` for every category (scoreboards page has no categories, so unaffected).
- [ ] **Step 4: Failing DOM test** `icon accepts a site path`: `S.ui.icon('/assets/img/cat-broken.png', 20)` gives an `img` whose `src` ends with `/assets/img/cat-broken.png`.
- [ ] **Step 5:** Run all tests: pass. Add the line "Category icons: `S.fmt.CAT_ICON` (curated pictures, like HEADLINES)" to CLAUDE.md's data-rules list.
- [ ] **Step 6:** Commit `feat(stats): fixed category icons; broken uses the owner's flint and steel`.

### Task 4: Chart: label band, value-card flag

**Files:**
- Modify: `assets/js/stats/chart.js` (`render`, returned object, `PAD_T`)
- Modify: `assets/css/stats.css:118-122` (`.st-valuecard`)
- Test: `tests/stats/chart.dom.test.cjs`

**Interfaces:**
- Produces: the chart instance gets a `valueCard: boolean` property (true after a render that showed the card, false otherwise). It's set before `S.chart()` / `update()` return.

- [ ] **Step 1: Failing tests.**
  - `single point renders value card` (existing, extend): `.st-vc-date` count is 0. There is exactly one `.st-vc-asof` element whose text is `'As of ' + S.fmt.date(T0 + DAY)`. `chart.valueCard === true`.
  - `value card date shows once per distinct date`: two series with points on different days → `.st-vc-asof` absent, each row keeps its own `.st-vc-date`. (The date only collapses when it's the same for all rows.)
  - `valueCard flag clears when lines draw`: start with single points, `update()` with two-point series → `valueCard === false`, `path.st-line` count > 0.
  - `zone labels sit above the plot`: split axis with a series whose max is the top of the domain → every `.st-zonel` `y` is less than the smallest `y` of the line path's points (parse the `d` attribute of `path.st-line`).
- [ ] **Step 2:** Run, see them fail.
- [ ] **Step 3:** Implement. Value card: when all rows share a date, render rows without `.st-vc-date` plus one `<div class="st-vc-asof">As of …</div>`. Label band: when `tx.split != null`, plot top is `PAD_T + 18` and the zone labels' baseline is `PAD_T + 12`. Without a split, the top is unchanged.
- [ ] **Step 4:** Run all tests: pass.
- [ ] **Step 5:** Commit `fix(chart): backups/live labels get their own band; value card shows the date once`.

### Task 5: Chart notes: live note on its own line, no legend under a value card

**Files:**
- Modify: `assets/js/stats/pagekit.js:51-55` (`liveNote`)
- Modify: the note painters: `pages/explorer.js:315-324`, `pages/compare.js:~295-305`, `pages/player.js:~245-250`, `pages/overview.js:~120-128`
- Modify: `assets/css/stats.css` (`.st-note-live{display:block;margin-top:.3rem}`)
- Test: `tests/stats/pagekit.test.cjs`

**Interfaces:**
- Consumes: `chart.valueCard` (Task 4).
- Produces: `S.kit.liveNote` returns `'<span class="st-note-live">…</span>'` (same wording) or `''`.

- [ ] **Step 1: Failing test:** `liveNote` output starts with `<span class="st-note-live">`.
- [ ] **Step 2:** Run, see it fail. Implement. Then in each painter: the live note is appended after the joined bits **without** the `' · '` separator (it's a block), and when `chart && chart.valueCard` the swatch/legend bit is left out. Each painter runs after `chart.update/S.chart`, so the flag is current (check the order in each file).
- [ ] **Step 3:** Run all tests. On the dev server: explorer `scope=cmp2`, play_time (value card, no swatches, date once); explorer `scope=smp` range all (live note on its own line).
- [ ] **Step 4:** Commit `fix(stats): live note on its own line; no legend under a value card`.

### Task 6: Paged tables

**Files:**
- Modify: `assets/js/stats/ui.js:524-622` (`table`)
- Modify: `assets/js/stats/pages/player.js:~450-465` (milestones "Load more" → `S.ui.table` or the same pager)
- Modify: `assets/css/stats.css` (`.st-pager`, `.st-pg`, `.st-pg.on`, `.st-pg-gap`)
- Test: `tests/stats/ui.dom.test.cjs`

**Interfaces:**
- Produces: `S.ui.pager(el, {total, pageSize, page, onPage(n)}) -> {set(total, page)}`. Renders `‹ 1 2 … 7 8 9 … 80 ›` (first, last, current ±1; gaps as `…`) and `Showing 51–100 of 4,012`. Renders nothing when `total <= pageSize`. Pages are 1-based. Used by `S.ui.table` and by Task 10's server-paged leaderboard. `S.ui.table(...)` return value gains `page(n)`. `setRows` resets to page 1.

- [ ] **Step 1: Failing tests.** Rewrite `table sorts and pages`: 120 rows → 50 rows shown, `.st-pager` text includes `Showing 1–50 of 120`. Click `.st-pg[data-page="3"]` → 20 rows, first cell `p100`. Sorting by value → back on page 1, first value `119`. New `pager hides for one page`: 50 rows → no `.st-pager` in the DOM. New `pager gaps`: `S.ui.pager` with total 4000, size 50, page 40 → buttons `1 … 39 40 41 … 80` plus prev/next, and the current page has `aria-current="page"`.
- [ ] **Step 2:** Run, see them fail. Implement. Prev/next are `<button>`s disabled at the ends. Changing page scrolls the table's top into view only if it's above the viewport.
- [ ] **Step 3:** Player milestones list switches to the pager (20 per page, as now).
- [ ] **Step 4:** Run all tests. Commit `feat(stats): numbered pages instead of Load more`.

### Task 7: Badge tooltips

**Files:**
- Modify: `assets/js/stats/ui.js` (new `tip`), `assets/js/stats/pages/player.js:175-180`
- Modify: `assets/css/stats.css` (`.st-bubble`)
- Test: `tests/stats/ui.dom.test.cjs`

**Interfaces:**
- Produces: `S.ui.tip(root: Element)` wires every `[data-tip]` inside `root`: hover/focus shows, mouseleave/blur/Escape hides, tap toggles (touch), tap outside closes. A single shared `.st-bubble` element (role `tooltip`) is positioned above the target (below if no room), clamped to the viewport. The target gets `aria-describedby` while it's open. Text set with `textContent`.

- [ ] **Step 1: Failing tests** `tip shows on hover and focus, one at a time`: two `[data-tip]` spans; hover the first → `.st-bubble` visible with its text; focus the second → bubble shows the second's text and there's still only one `.st-bubble`. Escape → hidden. `tip toggles on tap`: `page.tap` (with `hasTouch` context) opens, tapping `body` closes.
- [ ] **Step 2:** Run, see them fail. Implement. Fade 120ms, none under reduced motion. Style: `var(--st-pop)` background, 1px `var(--line)`, 2px radius, `.72rem` mono, max-width 260px.
- [ ] **Step 3:** Player badges: replace `title=` with `data-tip="…"` + `tabindex="0"` (only when `desc` is non-empty). Call `S.ui.tip(el.body)` after paint.
- [ ] **Step 4:** Run all tests. Commit `feat(stats): proper badge tooltips`.

### Task 8: Autocomplete: above panels, spaces as underscores

**Files:** Modify: `assets/js/stats/ui.js:~428` and the autocomplete wrapper; `assets/css/stats.css:473`. Test: `tests/stats/ui.dom.test.cjs`.

- [ ] **Step 1: Failing test** `autocomplete sends spaces as underscores`: type `"  redstone   block "` → the intercepted `/api/stats/search` request has `q=redstone_block`.
- [ ] **Step 2:** Implement `q.trim().replace(/\s+/g, '_')` before `S.api('search', …)` (the input's visible text is unchanged).
- [ ] **Step 3:** Stacking: give the autocomplete's positioned wrapper `position:relative;z-index:20` (find which element is the positioned ancestor of `.st-ac` on each page: compare `#cmp-kq`/`#cmp-pq`, explorer `.st-ex-search`, player `.st-pl-find`). Verify on compare: two players and no stat, type "stone" → the dropdown is fully visible over the "Add at least…" panel. Check explorer and player too.
- [ ] **Step 4:** Run all tests. Commit `fix(stats): search accepts spaces; dropdown stays above panels`.

### Task 9: Player profile → leaderboard links

**Files:**
- Modify: `assets/js/stats/pagekit.js` (new `boardHref`), `pages/player.js` (pods `:184-189`, graph title `:~213`, All stats rows `:394-406`, Scoreboards rows `:~416`)
- Modify: `assets/css/stats.css` (`.st-board-link`)
- Test: `tests/stats/pagekit.test.cjs`

**Interfaces:**
- Produces: `S.kit.boardHref(kind: 'stat'|'scoreboard', category: string|null, key: string, st) -> string`. For a stat: `/stats/explorer/?stat=<cat>|<key>&scope=…[&bots=true]`. For a scoreboard: `/stats/scoreboards/?stat=<key>&scope=…`. Must use the same `stat` param format the explorer reads (check `S.state` / `explorer.js` boot. If explorer uses separate `cat`/`key` params, match that and fix the test).

- [ ] **Step 1: Failing test** `boardHref carries stat, scope and bots`, both kinds, values URL-encoded, `bots` only when `st.bots`.
- [ ] **Step 2:** Implement. Pods: a small `<a class="st-board-link" href="…">Leaderboard →</a>` inside each pod. Pods are `<button>`s, so restructure each pod as a `div` holding the existing button plus the link (no nested interactive elements). Graph header: the same link for the selected stat, next to `#pl-ctitle`, updated when the selection changes. Table rows: last cell gets the link. The existing `onRow` already ignores clicks on `a`.
- [ ] **Step 3:** Run all tests. On the dev server, open a profile and follow each kind of link: the explorer opens with that stat and the same scope.
- [ ] **Step 4:** Commit `feat(stats): leaderboard links from every stat on a profile`.

### Task 10: Explorer: Servers chart follows the scope, reset picks

**Files:**
- Modify: `assets/js/stats/core.js` (new `S.serverLines`), `pages/explorer.js:71-73`, `:303`, `:336-342`, board header (`:~223`)
- Test: `tests/stats/core.test.cjs`

**Interfaces:**
- Produces: `S.serverLines(meta, scope) -> string[]`: the server keys to draw, in `meta.servers` order. A single server → `[scope]`. A group scope → `meta.scope_groups[scope]`. `all` → every `meta.servers` key. Without `scope_groups` → `[scope]`.

- [ ] **Step 1: Failing test** `serverLines`: with the test META (smp, building, cmp, cmp2; group cmps) → `smp→['smp']`, `cmps→['building','cmp','cmp2']` (API order, not sorted), `all→['smp','building','cmp','cmp2']`, `cmp2→['cmp2']`.
- [ ] **Step 2:** Implement. In explorer: `serverParts()` → `S.serverLines(meta, st.scope)`. Colours from `LINES` (8). Labels from `meta.servers[].label`. `liveAt` uses `st.scope` in both modes. The `sinceText` servers arg = the drawn keys. Drop servers with tracking off for this kind from the lines; if none are left, it's the existing untracked state.
- [ ] **Step 3:** Reset: keep `defaultPicks = top maxLines() uuids` from the board load (`:284`). Show a `Reset to top N` button (`st-again` style) in the board header only while `picked` differs from it as a set. Click → `picked = defaultPicks.slice()`, recolour, redraw.
- [ ] **Step 4:** Run all tests. Dev server: Servers view on `smp` shows one line with full history. `cmps` shows 5 lines in API order. Pick/unpick a row → reset appears; click → it goes and the top 6 are back.
- [ ] **Step 5:** Commit `feat(explorer): servers chart follows the scope; reset to top picks`.

### Task 11: Explorer leaderboard pages (offset paging)

**Files:** Modify: `pages/explorer.js` (`limit`/`STEP`/"Load more" logic, `:~255-300`). Uses `S.ui.pager` (Task 6).

- [ ] **Step 1:** Replace grow-by-50 with pages of 50: request `limit=50&offset=(page-1)*50`, total from `total_count` (`settings.limits.leaderboard` caps a single request, not the offset, so every page is reachable). Rank comes from the row. Picks/default picks still come from page 1. Changing stat/scope/range → page 1. Page responses go through the existing memo.
- [ ] **Step 2:** Dev server: play_time on `all`, go to the last page, ranks continue correctly. Back to page 1, the chart is unchanged.
- [ ] **Step 3:** Run all tests. Commit `feat(explorer): paged leaderboard`.

### Task 12: Player heads from our own cache first

**Files:** Modify: `assets/js/stats/ui.js:42-66` (`HEADS`). Test: `tests/stats/ui.dom.test.cjs`.

- [ ] **Step 1: Failing test** `head tries /cache/heads first`: route `/cache/heads/*` → PNG 200. The `img` src is `/cache/heads/<uuid>.png`. Existing test: route `/cache/heads/*` 404 too and assert it still ends on the letter after crafatar + mc-heads fail.
- [ ] **Step 2:** Prepend `(u) => '/cache/heads/' + encodeURIComponent(u) + '.png'` to `HEADS` (64px source, CSS scales it). `headFails` becomes length 3. Harmless before the backend ships (404 → next source, and after 3 failures it's skipped for the session).
- [ ] **Step 3:** Run all tests. Commit `feat(stats): heads from /cache/heads first`.

### Task 13: Bolt map onto the shared layout

**Files:**
- Modify: `boltmap.html` (rewrite top: front matter `layout: default`, `permalink: /boltmap/`, `title: Bolt map`)
- Create: `assets/css/boltmap.css` only if the page's own canvas/legend rules don't belong in `chronos.css` (linked with the `?v=` buster)
- Delete (after grep confirms nothing references them): `css/site.css`, `css/animate.min.css`, `js/jquery.min.js`, `js/jquery.min.js.map`, `assets/background.png`, `assets/background2.png`

- [ ] **Step 1:** Read the whole of `boltmap.html` and list what it shows and does (canvas drawing, legend, hover/zoom, data fetch). Keep all of that behaviour.
- [ ] **Step 2:** Move it into `layout: default`: `.page` + `.panel` for the legend, canvas inside a panel. Fetch through `C.json('/data/boltmap.json')` (drops the `?t=` buster; nginx sends `no-cache`). `C.stamp` pill next to the h1, `C.fail` on error, `C.esc` on any text from the JSON. No Bootstrap, no jQuery. The legend swatch colours stay as they are (they match the canvas).
- [ ] **Step 3:** `grep -rn "site.css\|animate.min\|jquery\|background2\?\.png" --include=*.html --include=*.css --include=*.js . | grep -v _site` → nothing. Then delete the files. Update CLAUDE.md: remove the "Legacy leftovers" section, set the Bolt map row to `boltmap.html` / `/data/boltmap.json`.
- [ ] **Step 4:** Dev server with a copy of the live `boltmap.json`: the map draws, the legend is readable, it works at 390px, and the nav shows Bolt map as active.
- [ ] **Step 5:** Commit `feat(boltmap): move to the shared layout; drop Bootstrap and legacy files`.

### Task 14: Top players section (hours played part)

**Files:**
- Modify: `stats/index.html` (new section container below the spotlight/pulse, `id="ov-top"`), `pages/overview.js`
- Modify: `assets/css/stats.css` (`.st-top`, `.st-top-list`, `.st-top-row`)

- [ ] **Step 1:** Section "Top players" with a grid of list cards. This task ships one card: **Most hours played**. Its data is `/leaderboard?kind=stat&category=minecraft:custom&key=minecraft:play_time&scope=<st.scope>&include_bots=…&limit=5` (no range: all-time). Each row: rank, head, name (link via `S.kit` player href), value via `F.display`. Footer link "Full ranking →" = `S.kit.boardHref('stat','minecraft:custom','minecraft:play_time',st)`. Scope untracked → card shows the untracked empty text.
- [ ] **Step 2:** Leave the three other cards out of the DOM (not placeholders). Task 16 adds them.
- [ ] **Step 3:** Dev server: card follows scope changes. Run all tests. Commit `feat(overview): top players section with hours played`.

---

## Blocked on backend (do after `STATS_API.md` documents each)

### Task 15: Leaderboard player filter
Needs the `/leaderboard` `q` param. Filter input above the explorer board (debounce 200ms, spaces → `_` like Task 8). It sends `q`, resets to page 1, and the pager uses the filtered `total_count`. Ranks are shown as returned. While a filter is active, the picks and the chart are unchanged. Test: a DOM test intercepts `/leaderboard` and asserts `q` and `offset=0`.

### Task 16: Top players: #1 spots, firsts, badges
Needs the ranking endpoint. Three more cards in the Task 14 grid, same row layout, with the "Full ranking →" opening a paged table (Task 6 pager, server paging) in an overview tab or panel. Built exactly to the documented shape.

### Task 17: Servers chart per-line start
Needs `/totals` per-line start. Use each line's own start (no synthetic carry before it). Explorer `cmps`/`all` then show SMP's imported history beside the newer servers. Update the `sinceText` wording if the contract changes it.

### Task 18: Fake players hidden by default, shown with the bots toggle
Needs `/search` `include_bots` and the documented bot flag for fake players. Autocomplete
passes `include_bots` from the page's bots state (the autocomplete gets an
`opts.bots: () => boolean`). Profile: show the bot chip for the new flag as for
`is_bot_on_smp`. If the backend sets `filters_bots` on CMPs, the toggle appears there with no
code change (check). Test: a DOM test asserts `include_bots=true` is sent only when the
toggle is on.

### Task 19: Former names (only if the backend adds them)
If `/player` gains former names (e.g. `aka`), show them under the profile name as "Previously
<names>" (escaped). Search matches come from the backend.

(The icon renderer and the name-change merge need no frontend change. After they ship, spot-check search for a known carpet bot name, and icons for `dropper`, `creeper_spawn_egg`, `player_head`, `oak_stairs`, `chest`. Then open Storage and add an id override map in
`storage.html` for any display names whose `lower().replace(' ', '_')` misses, from the
renderer's report.)
