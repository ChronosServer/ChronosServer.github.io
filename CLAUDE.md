# Chronos website (ChronosServer.github.io)

Private technical Minecraft SMP site, live at **https://www.chronosmc.com** (`CNAME`).
Jekyll static site, deployed via `bash deploy.sh` on the server. Served from
`/var/www/html` behind Cloudflare + nginx. Sibling repo **Chronos-Bot** (Discord bot,
stats snapshotter, stats API) writes all the dynamic data this site reads.

## Stack & structure
- Jekyll 4.2.0 / Liquid 4.0.3, Ruby via rbenv. `_plugins/ruby32-liquid-fix.rb` stubs
  `tainted?`/`taint`/`untaint` — Ruby 3.2 removed these, Liquid 4.0.3 still calls them.
  Needed for any build on Ruby 3.2+.
- Each page is a top-level `*.html` with front matter: `layout: default`, `permalink`
  (always a trailing-slash dir like `/members/`), `title`, optional `bg:` and `kind:`.
  Page-specific JS is an inline `<script>` at the bottom of the page; there is no
  bundler, no npm, no build step beyond Jekyll.
- `_layouts/default.html` — the only layout. Provides background, fixed nav, footer,
  fonts, and loads `chronos.css` + `chronos.js` (the script loads *before* `{{ content }}`,
  so `window.C` exists for inline page scripts).
  - `bg: <name>` → `_data/backgrounds.yml` (`src`, `pos`, `scrim`, `accent`, optional
    `widths`). Default `chronos_spawn`. New backgrounds: `python3 tools/make-bg.py
    <image> <name>` (Pillow) writes `assets/bg/<name>-<w>.webp`.
  - `kind:` sets `body.kind-<kind>`: `inner` (default, darker scrim), `home` (hero,
    scroll-dim + pointer parallax in chronos.js), `map` (full-bleed iframe, no footer).
  - Nav from `_data/nav.yml` (`title`, `url`, `desc`, optional `hint`, `blank`); active
    link gets `aria-current`. On narrow screens the links scroll sideways (no scrollbar): chronos.js
    centres the current link (again after fonts load) and `.nav.more-r` fades the right edge while
    links are hidden there. `desc`/`hint` also feed the home page's explore tiles.
  - Footer from `_data/social.yml` (Discord, Patreon, GitHub; icons are Simple Icons/CC0
    SVG paths on a 24×24 viewBox, not image files).
- CSS/JS cache-busted via `?v={{ site.time | date: '%s' }}` on every deploy — without
  this Cloudflare serves stale CSS/JS after a push (bit us once already). Any new
  site-owned CSS/JS file needs the same query string.
- `assets/css/chronos.css` — single stylesheet, minified-style one-rule-per-line.
  Tokens in `:root`: `--ink #ebe8e6`, `--mute #9aa7aa`, `--panel rgba(10,13,15,.72)`,
  `--line rgba(235,232,230,.14)`, `--teal` (= per-page `--accent`, default `#3f9d98`),
  `--amber #e5a93c` (stale/warning), `--red #d4543a` (error/offline), `--ok #58c49a`,
  `--ease cubic-bezier(.23,1,.32,1)`, fonts `--display` (Syncopate 700), `--sans`
  (IBM Plex Sans), `--mono` (IBM Plex Mono). Building blocks: `.page`, `.lede`,
  `.panel` (blurred dark, 1px line, 3px radius), `.pill`/`.pill.stale`, `.err`, `.row`
  + `.meter`, `.servers`/`.srv`/`.dot`, `.sec`, `.spec`, `.more`, `.tiles`, `.reveal`.
  Breakpoints 760/560/420px; `prefers-reduced-motion` is respected — keep doing so.
- Design system: dark translucent panels over the background photo, teal accent,
  amber=stale, red=error/offline. Syncopate for the wordmark/headers (all-caps),
  IBM Plex Mono for data/labels/pills, IBM Plex Sans for body and nav links (uppercase,
  letter-spaced). Square-ish corners (2–3px), thin lines, no shadows-as-decoration.
  Reveal-on-scroll via `.reveal` + IntersectionObserver. No jQuery, no Bootstrap.
- `assets/js/chronos.js` exposes `window.C`:
  - `C.json(url)` → `{data, at}` (fetch with `cache:'no-cache'`, throws on non-2xx, `at`
    from `Last-Modified`). Note: it forces `no-cache` — fine for `/data/*.json`; the
    Stats API wants normal HTTP caching, so don't blindly reuse it there.
  - `C.stamp(el, at, maxHours=12)` synced/stale pill, `C.ago(date)`,
    `C.fail(el, err)` error panel, `C.reveal(el)` for dynamically added `.reveal` nodes.
  - `C.person.name(m)` / `C.person.id(m)`: Discord people. Never identify anyone by server
    nickname or avatar (members rename each other as a joke); the user id is the identity,
    the account's global name/username the name. Bot request for the ids: `TEMP_FOR_BOT.md`.
  - `C.esc()` HTML-escape — every page that renders Discord- or player-sourced text MUST
    use this; nicknames can contain `<script>`.

## Pages
| Page | File | Data |
|---|---|---|
| Home | `index.html` (`kind: home`) | hero, about/spec, explore tiles with live counts, gallery strip, Join cards from `social.yml`; `/data/server_status.json`, `/api/status`, members/ms_storage/archive JSON, `/gallery/index.json` |
| Members | `members.html` | `/data/members.json` (shows `C.person.name`: global name, username, nickname last) |
| Gallery | `gallery.html` | `/gallery/index.json` + `/gallery/thumbs/` (built by deploy.sh, images live only on the server) |
| Storage | `storage.html` (main/dig tabs) | `/data/ms_storage.json`, `/data/dig_storage.json` |
| Archive | `archive.html` (Discord forum mirror, tag-filterable, 18 a page, links clickable) | `/data/archive.json`; `/data/members.json` for names/avatars, matched by Discord user id (`author_id`), else the post's own name |
| Status | `status.html` | `/api/status` (live host CPU/RAM/etc.) + `/data/server_status.json` (per-server up/down) |
| Bolt map | `boltmap.html` (`kind: map`, canvas with pan/zoom) | `/data/boltmap.json` (polls every 5 s only while the scanner reports `progress.complete: false`) |
| World map | `worldmap.html` (`kind: map`) | Overviewer at `/map/` in an iframe below the nav; `/map` still works standalone (served on the server, not in this repo) |
| Stats overview | `/stats/` (`stats/index.html`) | `/api/stats/{meta,totals,keys,spotlight,activity,milestones,firsts}` |
| Stat explorer | `/stats/explorer/` | `meta`, `keys`, `search`, `leaderboard`, `series`, `totals` |
| Scoreboards | `/stats/scoreboards/` | `meta`, `keys?kind=scoreboard`, `leaderboard`, `series`, `totals` |
| Player | `/stats/player/?p=<name or uuid>` | `search`, `player/{id}`, `series` |
| Compare | `/stats/compare/` (URL-encoded state) | `search`, `keys`, `compare`, `player/{id}` (unknown names only) |
| Milestones | `/stats/milestones/` (feed / firsts / rivalries) | `milestones`, `firsts`, `rivalries` |
| 404 | `404.html` | — |

The Stats pages sit under one **Stats ▾** nav dropdown; see "Stats section" below.

## Data flow (read-only from this repo's POV)
Every dynamic page fetches JSON from `/data/*.json`, written by the bot (Chronos-Bot).
nginx has an **allowlist**, not a blanket block, for `/data/`:
```nginx
location /data/ { return 404; }
location ~ ^/data/(members|ms_storage|dig_storage|archive|server_status|boltmap)\.json$ {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
}
```
A plain `deny all` on `/data/` breaks every page — don't reintroduce that. A new
`/data/*.json` file needs adding to that regex on the server.

Other same-origin endpoints (nginx → Chronos-Bot services): `/api/status` (host health)
and `/api/stats/*` (Stats API, below).

## Stats section
Frontend for the bot's read-only `/api/stats/*` (FastAPI behind nginx). Contract:
`STATS_API.md` (owner's copy, committed) — build against it, don't invent fields; if a live
response disagrees, report it (backend gets fixed, not worked around). `STATS_PLAN.md` is
the scope doc. Open backend issues go in
`TEMP_FOR_BOT.md` (owner scratch note, gitignored, like all `TEMP_*.md`).

**Structure**
- `_layouts/stats.html` chains on `default`, loads the `assets/js/stats/` scripts in order
  plus `pages/<page_js>.js` (front matter `page_js`). `default.html` loads
  `assets/css/stats.css` when the URL contains `/stats/`. All Stats CSS uses the `st-`
  prefix (home already owns `.tile`, `.row`).
- JS modules (plain scripts, no bundler; pure ones also `require`-able in Node for tests),
  all hang off `window.S`:
  - `format.js` `S.fmt`: numbers, units, stat labels, dates, badges, spotlight text,
    `HEADLINES` (the only curated list), `esc`.
  - `chartmath.js` `S.cm`: scales, step paths, `valueAt`. `activity.js` `S.act.bin`.
  - `core.js`: `S.api`, `S.ApiError`, `S.errorText`, `S.meta`, `S.state` (URL state with
    fallbacks), `S.scopeInfo`, `S.rangeParams`, `S.scopeServers`, `S.serverLines`, `S.liveAt`, `S.tracked`, `S.memo`.
  - `chart.js` `S.chart(el, opts)` SVG step chart (hover/keyboard). `viz.js`
    `S.viz.clock/heatmap`.
  - `ui.js` `S.ui`: heads/icons, controls bar, autocomplete, tabs, paged table + `pager`,
    `tip` (styled `[data-tip]` tooltips), `filterBox`, empty/error.
  - `pagekit.js` `S.kit`: shared range/live/untracked/leader/axis helpers, `boardHref`,
    `lineStart` (each `/totals` line's own start), `gainSince` (tile "since" wording), `hideRows`
    (drop players from a ranking and renumber).
  - `pages/*.js`: one per page (overview, explorer — also used by scoreboards, player,
    compare, milestones).

**Data rules that matter**
- Default scope `smp`. Servers/scopes show in API order, never sorted. Nothing hardcoded
  from data (categories, keys, objectives, servers, presets, limits, badges) except
  `S.fmt.HEADLINES`, `S.fmt.TOP_HIDDEN` (owner's list of team-exception bots, Placer and Raid by
  uuid, left off the overview's Top players unless "Include bots" is on; `S.kit.hideRows` renumbers)
  and the owner's category pictures `S.fmt.catIcon` (a `/` path is a site
  image, e.g. `assets/img/cat-broken.png`; anything else is an item id).
- `earliest_known: 1` → "earliest known holder"/"before tracking", no date; `approximate: 1`
  → amber "by <date>". Dates `en-GB` short.
- `live_started_at` for a multi-server scope is the latest of its servers' starts.
  `track_stats` / `track_scoreboards` false on a server → empty states, not zeros.
- Bots: the "Include bots" toggle shows where a server in view has `has_bots`
  (`scopeInfo().hasBots`); `is_bot` / `is_fake` label bots (`S.fmt.isBot`/`botLabel`).
- No cache-busters on API calls, no polling faster than 5 min. Everything from the API
  goes through `C.esc()`. Item icons `/cache/items/<id>.png`; missing → letter square.
  Heads `/cache/heads/<uuid>.png` first (404 = no head for that player, not an outage).

**Local dev** (API sends no CORS headers): `python tools/dev_server.py` (port 4000) serves
`_site/`, forwards `/api/stats/*`, `/cache/items/*` and `/cache/heads/*` to `https://www.chronosmc.com`
(`STATS_API_ORIGIN` overrides). Rebuild with `bundle exec jekyll build --watch`
(Ruby is at `C:\Ruby32-x64\bin`; add it to PATH).

**Tests**
- `NODE_PATH="$(npm root -g)" node --test "tests/stats/*.cjs"` (DOM tests need global Playwright)
- `python -m unittest tests.test_dev_server -v`
- Checker (dev server running, screenshots to `%TEMP%/stats-shots/`):
  `MSYS_NO_PATHCONV=1 NODE_PATH="$(npm root -g)" node tools/check_stats.cjs` — in Git Bash
  `MSYS_NO_PATHCONV=1` stops `/stats/` args turning into `C:/Program Files/Git/stats/`.

## Local development
- The owner works on Windows (PowerShell; GitHub Desktop for git). Build with
  `bundle exec jekyll build` / `bundle exec jekyll serve` (README). `/data/*.json`,
  `/gallery/`, `/map/` and `/api/*` exist only on the server, so most dynamic pages show
  their error state locally unless proxied.

## Known gotchas (don't re-debug these)
- Jekyll `_config.yml` excludes `deploy.sh`, `README.md`, `LICENSE`, `tools`, gemfiles,
  `CLAUDE.md`, the three `STATS_*.md` docs and `TEMP_*.md` scratch notes (also gitignored) from the built site — they were being
  served publicly before this was added. Any new repo-only file must be added to
  `exclude` too (Jekyll copies non-underscore files verbatim).
- `deploy.sh` has `set -eo pipefail` and `cd` to its own directory — don't remove
  either, a prior version silently copied a stale `_site` over the live site on
  build failure. It does `git pull --ff-only`, `bundle install`, `jekyll build`,
  `cp -r _site/. /var/www/html/`, then writes `/gallery/index.json` and 400px
  ImageMagick thumbnails. Copy is additive — deleted pages linger on the server.
- GitHub Desktop on Windows strips the executable bit and can introduce CRLF line
  endings on `.sh` files (breaks bash with `$'\r': command not found`). `.gitattributes`
  forces `*.sh text eol=lf`. Run deploy as `bash deploy.sh`, not `./deploy.sh`.
- The account owner reacts badly to anything that "feels too AI" — avoid generic
  serif display fonts, stock gradient hero buttons, and cliché "Explore our features"
  copy patterns. Plain, specific copy. Nav/headers are always caps. No home-page buttons
  for Discord/GitHub/Patreon — footer links (and the Join cards) only, with icons.
- Crafatar was down in Nov 2026: heads try our `/cache/heads` first, then Crafatar, mc-heads, then a lettered square
  (`S.ui.head`). Don't "fix" it by dropping Crafatar, it recovers.
- `/cache/heads/` fills in gradually (the bot fetches a batch every run). A head not fetched yet
  currently comes back as the site's 404 page with status 200, not a real 404 — the `<img>`
  fails to decode and falls back, so it works. Not an nginx outage; check a sample of uuids
  before concluding heads are broken.
