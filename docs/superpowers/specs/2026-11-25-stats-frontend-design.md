# Chronos Stats frontend: design

Date: 2026-11-25 · Branch: `stats-frontend` (merge into `main` at the end)
Inputs: `STATS_PLAN.md` (scope, final), `STATS_API.md` (data contract, final),
`STATS_FRONTEND_PROMPT.md` (brief), `CLAUDE.md` (site conventions).
Approved mockups: `.superpowers/brainstorm/1007-1795595369/content/overview.html` (option
A) and `player-v2.html`. They use real data snapshotted into `data.js`.

## 1. Intent

Chronos is a technical Minecraft SMP. The owner wants a Stats section that's more than a
current-totals table, and more than the WaveStats site that inspired it: any player, stat
or scoreboard on any server, over any time range, with the history going back to 2021,
plus the things WaveStats doesn't have (milestones, firsts, rivals, badges, pulse clock,
spotlight). The owner's words: "make it epic", "the coolest site". It must look like it
was always part of chronosmc.com. The owner reacts badly to anything that feels generic
or AI-made (see CLAUDE.md).

## 2. Goals / non-goals / anti-goals

**Goals**
- Six pages under one "Stats ▾" nav dropdown: Overview, Explorer, Scoreboards, Player,
  Compare, Milestones.
- Everything data-driven from `/api/stats/*`: scopes, servers, categories, stat keys,
  objectives, range presets, limits and badge thresholds (from `/meta` and `/meta.settings`).
  New stats appear without code changes.
- Graphs everywhere, honest about sparse imported history, and fast.
- Lots of Minecraft item icons (from the existing `/cache/items/` set only, see §7).
- Works on mobile, keyboard-accessible, respects reduced motion.

**Non-goals** (STATS_PLAN "out of v1"): export/public API, scoreboard correlation views,
storage tracking, activity before live tracking.

**Anti-goals** (the result counts as a failure even if it works)
- Looks like a dashboard template or a WaveStats clone, not like the rest of Chronos.
- Hardcoded stat/objective/server lists or limits (except the one curated headline list,
  §5.1).
- Shows imported or approximate data as if it were exact (`earliest_known`/`approximate`
  misread, years of backups drawn as if continuous).
- Polls the API or defeats its HTTP cache.
- Any XSS path: names, objectives and stat keys are always escaped.

## 3. Constraints

- Jekyll 4.2 static site, no bundler, no npm, no jQuery/Bootstrap. Ruby is now installed
  on the dev PC, so `bundle exec jekyll build` works locally.
- Same-origin API with no CORS. Local dev needs a proxy (§9).
- Cloudflare in front: cache-bust site CSS/JS with `?v={{ site.time | date: '%s' }}`, but
  **never** add cache-busters to API calls (the API sends ETag +
  `max-age=60, stale-while-revalidate=900`). No polling faster than 5 min.
- Data changes every 15 min. `/search` and `/spotlight` are uncached by design.
- Player heads: Crafatar per the contract, but Crafatar was returning 500 on 2026-11-25,
  so a fallback is mandatory (§7).
- Item icons: only what's in `/cache/items/<id>.png` on the server. Many ids 404 (e.g.
  `clock`, `iron_sword`, `skeleton_skull`, `crimson_hyphae`). The owner confirmed that set is
  what we use.
- Live data today: SMP history from 2021-10-28 (5 backups), dense from 2026-11-24;
  CMPs/building from 2026-11-24. Rivalries empty, activity nearly empty, ~1.6k null names,
  most firsts `earliest_known: 1`. CMP totals are dominated by bots (CMPs never filter
  bots, which is intended).

## 4. Approaches considered

1. **Plain Jekyll pages + shared classic JS files + hand-drawn SVG charts.** **Chosen by
   the owner.** It matches the site's existing pattern exactly, has zero dependencies, and the
   mockups prove the look. The data is small (≤ 6 lines × 500 points).
2. Same, with uPlot for charts. Rejected: generic chart look, first third-party dependency;
   the zoom/hover it adds is cheap to hand-roll at this data size.
3. Single-page app at `/stats/` with client routing. Rejected: breaks the one-page-per-
   section pattern, nav `aria-current`, and plain shareable URLs for little gain.

## 5. Decided with the owner

### 5.0 Global
- **Default scope is SMP on every Stats page** (not All). Scope switch: `ALL / CMPS / SMP`
  segmented control (from `/meta.scopes`: `all`, the group scope(s) and ungrouped
  servers), plus a "Server ▾" picker for single servers.
- **Server order: smp, cmp, cmp2, cmp3, cmp4, building**, which is `config.json` order. The
  site must **not** hardcode it. Chronos-Bot is being changed so that `/meta.servers`,
  `/meta.scopes`, `/player.servers` and `/search` return config order (prompt:
  `TEMP_CHRONOSBOT_SERVER_ORDER_PROMPT.md`). The frontend displays servers in API order
  and never sorts them. Until that ships, the order is alphabetical, which is accepted.
- More icons everywhere they fit (§7), with a lettered-square fallback, never a broken
  image.

### 5.1 Overview: mockup option A, "Instrument panel"
Top to bottom:
1. `STATS` h1. Controls bar: scope switch, server picker, "Include bots" (only when the
   scope includes SMP), synced pill ("Synced N min ago" from `/meta.last_run_at`, amber
   when stale).
2. **Four headline tiles**: Hours played (`custom/play_time`, ticks→h), Distance walked
   (`custom/walk_one_cm`, cm→km), Mobs killed (`custom/mob_kills`), Deaths
   (`custom/deaths`). These four keys are the one curated list (the owner chose this over a
   picker). Keep them in one constant, and skip any key missing from `/keys`. Each tile
   shows the big compact value for the selected scope. On `all` it also shows the SMP/CMPs
   split bar with both values. Clicking a tile selects it (teal top edge) and swaps the
   graph.
3. **Big history graph** (`/totals`) for the selected tile: step lines, **split time axis**
   (§6.2), a y-axis in display units, a legend, and the range picker. On `all` it draws
   one line per top-level part (smp, cmps). On any other scope it draws that scope's line.
4. Two-column row: **Spotlight** card (sentence from the API templates, head, item icon,
   "Another" button using `seen` in sessionStorage) and **Server pulse** card with a
   two-way toggle: **Clock** (24-h radial, average players per hour, local time) and
   **Week** (the day-of-week × hour heatmap STATS_PLAN asks for, local time). Both come from
   one `/activity` call, with an empty state while filling in. *(Heatmap placement is my call;
   it was missing from the mockup by oversight, not dropped.)*
5. **Latest milestones** feed (6–8 rows: head, sentence, server, date or "by <date>" in
   amber), with a link to the Milestones page. Also show the latest **firsts** here:
   either a second compact list or a tab on the same panel (builder's call, §10).

### 5.2 Player: `player-v2.html`, "Dossier" + additions
1. Player search box (autocomplete from `/search` players) + controls bar.
2. Header: full skin render (mc-heads `body`), name in Syncopate, server chips (API
   order), "last seen" from `last_activity` (hide when null), a bot-account label when
   `is_bot_on_smp`. **Giant "N" = count of stats where rank == 1** on the right, labelled
   "stats where <name> is #1", linking to the #1 section. If N is 0, show the best rank
   instead ("#3 best rank") or hide it (builder's call).
3. Four headline tiles with "Rank #r of N".
4. **Badges**: option A's layout. Flex-wrapped cards, highest tier first; each card has
   square art (icon or letter, `flex:none` so it never squashes), the name and the servers
   it was earned on. Badges with the same key on several servers merge into one card.
   Names are mapped per STATS_API "Badges" by family + tier position in
   `/meta.settings.badges`. Retired tiers get the generic family name.
5. **"Number one in"**: a grid of item cards (icon, "Used · Repeater", value, "#1 of
   174"), 7 cards + "+N more", with "See all N" opening the stats table filtered to rank 1.
   A player with no #1s gets the same grid filled with their best ranks (sorted by
   `rank/of`), titled "Best ranks".
6. **Full-width graph** of the selected stat (default: hours played) via `/series` for
   this player. Clicking any stat elsewhere on the page graphs it here. Imported points
   show as dots.
7. Tabbed panel: **All stats** (count; filter box; category buttons from the categories
   present; sortable by value/rank; paginated, since there can be 4k+ rows),
   **Scoreboards**, **Milestones** (`earliest_known` ones under a quieter "Already reached
   before tracking began" heading), **Firsts** (1k+ rows: paginated, labels per §6.3),
   **Rivals** ("catching up in N days", empty state).

### 5.3 Backend additions requested (Chronos-Bot, `TEMP_CHRONOSBOT_SERVER_ORDER_PROMPT.md`)
All additive; the frontend must work before they ship, using the fallbacks below.
1. Config order for servers and scopes. *Fallback:* the API's current order, no sorting.
2. `/meta.live_started_at` (per server). *Fallback:* plain linear time axis.
3. `/meta.scope_groups` (`{"cmps": [server keys]}`). *Fallback:* the Overview graph draws
   only the selected scope's line (no per-part lines, no split bar on `all`), and the bots
   toggle shows on `all` and on any scope whose server has `filters_bots: true`. The main
   switch always shows `all`, the ungrouped servers and every group scope, in `/meta.scopes`
   order, so it grows when the config grows. No name-based guessing.
4. `/firsts?limit=&order=newest`. *Fallback:* Overview's Firsts tab loads `/firsts`
   lazily, only when opened (3.4 MB for `all`, cached), never on page load.

### 5.4 Request budget
STATS_FRONTEND_PROMPT says "one or two requests per page". That isn't achievable on
Overview without a multi-key endpoint (4 headline tiles = 4 `/totals`). The rule as applied:
**the first paint needs at most two requests (`/meta` + the main data)**; everything else
loads in parallel after that, or lazily when scrolled into view or a tab opens, all through
the browser's HTTP cache (ETags). No request is ever repeated just to refresh.
*(My call, flagged to the owner.)*

## 6. Data rules the builder must honour

### 6.1 Units and names
Per STATS_API "Units": `_one_cm` → m/km, tick stats → h, `damage_*` /10, else counts.
Compact numbers (1.2M), with the exact value in a `title`. Display a key as
"Category · Item name" without the namespace, underscores → spaces, first letter
capitalised. `custom` stats drop the category prefix.

### 6.2 Graphs
- Step-after lines, extended to `to`. Single-point series → render as a value, not a chart.
  Empty → empty state.
- **Split time axis.** When a graph's range covers both imported history and live
  tracking, the imported span gets a shaded "BACKUPS" zone (~45% of the width) and the
  live span ("LIVE · EVERY 15 MIN") the rest, so the dense recent data isn't crushed.
  Imported points are drawn as dots. Ranges entirely inside live tracking use a normal
  linear axis.
- **This needs the first-live-snapshot time per server, which the API doesn't expose
  yet** (`tracking_started_at` is the *oldest* point, i.e. the first backup). Add
  `/meta.live_started_at` (per server key) to the Chronos-Bot change, appended to the same
  prompt. Until it exists, fall back to a plain linear axis (no guessing from point
  density).
- A server's line starts at its own first point; never draw a server at 0 before it was
  tracked (the `/totals` response pads with zeros from the shared `effective_from`).
- Range picker: presets from `/meta.settings.range_presets` + `all` + custom (two date
  inputs → `from`/`to`). Whenever `effective_from` > requested start, show "since tracking
  began (<date>)" or "since <date>".
- Hover: a crosshair + tooltip with the date and value per line (keyboard: arrow keys move
  between change points when the chart is focused). Draw-in animation on first render only,
  disabled under reduced motion.

### 6.3 Firsts and milestones labels
`earliest_known: 1` → "earliest known holder" / "already reached before tracking", no
date. `approximate: 1` → "by <date>" in amber. Otherwise the exact date.

### 6.4 Bots
The "Include bots" toggle appears only when the scope contains SMP. It's per page and
reflected in the URL. On Compare, if any player has `is_bot_on_smp`, turn it on
automatically (STATS_API).

### 6.5 Errors and empties
API 400/404/422 → an inline `.panel.err` message saying what happened and what to do
("No player called X. Check the spelling or search below."). HTML instead of JSON (a
Cloudflare block) → "The stats server didn't answer, try again in a minute." Empty states
are specific ("Rivalries appear once two players are close in a stat and one is catching
up. Activity tracking started on 24 Nov.").

## 7. Icons and heads

- Item icon = `/cache/items/<id-without-namespace>.png`, `loading="lazy"`. On error,
  replace with a lettered square in the badge-art style (first letter, teal tint), so
  layout never shifts or shows a broken image. Cache failures in a `Set` per page so a
  missing id isn't requested twice.
- Where icons go: table rows, #1 cards, milestone/first rows, spotlight, search
  autocomplete, Explorer stat list, badge art (family → representative item, e.g. Miner →
  `diamond_pickaxe`, Crafter → `crafting_table`, Collector → `hopper`, Builder → `bricks`,
  Champion/Dominator/Legend → `gold_block`, Millionaire → `experience_bottle`, firsts →
  `spyglass`; fallback letter when missing), headline tiles and category filter buttons
  (try an item; fall back to the letter).
- Heads: try `https://crafatar.com/avatars/<uuid>?size=32&overlay`; on error try
  `https://mc-heads.net/avatar/<uuid>/32`; on error show a lettered square. Unnamed players
  show `uuid.slice(0,8)`. Skin body render: `https://mc-heads.net/body/<uuid>/120`.
- Pixel art always `image-rendering: pixelated`.

## 8. Remaining pages (not mocked, same system; builder follows these)

- **Explorer** (`kind=stat`): a big search field with autocomplete (`/search`, ~120 ms
  debounce, arrow keys + Enter + Esc; results grouped Players / Stats (same key grouped
  across categories) / Objectives; players → Player page, objectives → Scoreboards).
  Browse: category buttons from `/meta.categories` → key list from `/keys` (filterable, with
  icons). Selected stat → header with icon + name, then a **leaderboard** (heads, rank, value,
  ties share rank, "load more" up to the limit, sortable columns) and a **graph** with two
  modes: "Top players" (`/series` for the top N=`series_players` rows, toggled by clicking
  rows) and "Servers" (`/totals`, server vs server). Range picker drives both; delta mode
  shows "gained in <range>".
- **Scoreboards**: Explorer's layout for `kind=scoreboard`; objective list from `/keys`
  (`removed: true` → "removed" tag, still browsable); no categories.
- **Compare**: player chips (add via search, 2–6 from `/meta.settings.compare`), stat chips
  (up to `max_keys`, via search). A table with rows = stats and columns = players; the
  leader in each row is highlighted teal and each cell shows a bar proportional to the row max.
  Clicking a row draws that stat's overlaid series. Range picker.
- **Milestones**: three tabs: **Feed** (`/milestones`, cursor "Load more", the
  `earliest_known` section separate and quieter), **Firsts** (`/firsts`, 17k rows:
  client-side filter by server/category/text, paginated; dated firsts first),
  **Rivalries** (`/rivalries`, gap bar now vs 7 days ago, "overtakes in N days", empty state).

URL state: every page reads and writes its state in the query string (`scope`, `bots`,
`range` or `from`/`to`, `kind`, `cat`, `key`, `p` for player, `players`, `keys`), so every
view can be shared. Scope also persists in `localStorage` as the default for other Stats
pages (the URL wins).

## 9. Implementation shape (owner chose approach 1)

- Pages: `stats/index.html` (`/stats/`), `stats/explorer.html` (`/stats/explorer/`),
  `stats/scoreboards.html`, `stats/player.html`, `stats/compare.html`,
  `stats/milestones.html`, each `layout: default` (or a `stats` layout chained on
  `default`) with `bg:` front matter.
- Shared JS: classic scripts under `assets/js/stats/` (API client with normal HTTP caching
  and Cloudflare-HTML detection; format/units/badges/spotlight text; controls: scope, server,
  bots, range, synced pill; SVG chart; head/icon helpers; search/autocomplete), each with
  `?v=` cache-busting, exposing one namespace (e.g. `window.S`). Don't reuse `C.json()` for
  the API (it forces `no-cache`). `C.esc()` for all text.
- CSS: `assets/css/stats.css`, loaded on stats pages only, built from the existing tokens
  (`--panel`, `--line`, `--teal`, `--amber`, fonts). CMP colour in the mockups:
  `#c9b37e`; the builder may tune it but must keep SMP = teal.
- **Nav dropdown**: `_data/nav.yml` gains a Stats entry with `children`; `default.html`
  renders it as a button with `aria-expanded` and a menu (keyboard: Enter/Space/Esc/arrows;
  closes on outside click). `.links` is `overflow-x:auto`, so the menu must not be clipped
  (render it `position:fixed` or outside `.links`). Active state on any `/stats/` page.
  Check the home page's explore tiles: they iterate `nav.yml`, so the Stats entry adds a
  tile; make sure the grid and its stagger delays still work.
- **Dev server** `tools/dev_server.py` (stdlib), exactly per STATS_FRONTEND_PROMPT "Local
  development": serves `_site/`, forwards `/api/stats/*` to `STATS_API_ORIGIN` (default
  `https://www.chronosmc.com`), passes `If-None-Match`, returns status/ETag/Cache-Control/
  Content-Type unchanged, browser User-Agent, `Host` header. Prove it with curl direct vs
  proxied before building pages. `tools/` is already excluded from Jekyll. The owner runs
  `bundle exec jekyll build --watch` alongside it.
- Verification: Playwright (installed globally) screenshots at 1400px and 390px for every
  page against the live API, plus keyboard checks. Any live response that disagrees with
  STATS_API → stop and report.

## 10. Left to the builder (with defaults)

- Overview firsts: separate list vs a tab with milestones. *Default: tab.*
- Player with zero #1s: show the best rank vs hide the big number. *Default: show "#3" with
  "best rank".*
- Exact copy for empty and error states, in the voice of §6.5.
- Pagination sizes for big tables (default 50 rows) and leaderboard "load more" step.
- Whether `stats` gets its own chained layout or each page includes the shared bits.
- Motion: one entrance per page (headline tiles + graph draw-in), the existing `.reveal`
  for lower sections. Nothing else animates unprompted.
