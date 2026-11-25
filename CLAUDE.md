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
    link gets `aria-current`. `desc`/`hint` also feed the home page's explore tiles.
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
  Reveal-on-scroll via `.reveal` + IntersectionObserver. No jQuery, no Bootstrap on the
  redesigned pages.
- `assets/js/chronos.js` exposes `window.C`:
  - `C.json(url)` → `{data, at}` (fetch with `cache:'no-cache'`, throws on non-2xx, `at`
    from `Last-Modified`). Note: it forces `no-cache` — fine for `/data/*.json`; the
    Stats API wants normal HTTP caching, so don't blindly reuse it there.
  - `C.stamp(el, at, maxHours=12)` synced/stale pill, `C.ago(date)`,
    `C.fail(el, err)` error panel, `C.reveal(el)` for dynamically added `.reveal` nodes.
  - `C.esc()` HTML-escape — every page that renders Discord- or player-sourced text MUST
    use this; nicknames can contain `<script>`.

## Pages
| Page | File | Data |
|---|---|---|
| Home | `index.html` (`kind: home`) | hero, about/spec, explore tiles with live counts, gallery strip, Join cards from `social.yml`; `/data/server_status.json`, `/api/status`, members/ms_storage/archive JSON, `/gallery/index.json` |
| Members | `members.html` | `/data/members.json` |
| Gallery | `gallery.html` | `/gallery/index.json` + `/gallery/thumbs/` (built by deploy.sh, images live only on the server) |
| Storage | `storage.html` (main/dig tabs) | `/data/ms_storage.json`, `/data/dig_storage.json` |
| Archive | `archive.html` (Discord forum mirror, tag-filterable) | `/data/archive.json` |
| Status | `status.html` | `/api/status` (live host CPU/RAM/etc.) + `/data/server_status.json` (per-server up/down) |
| Bolt map | `boltmap.html` | `/data/boltmap.json` |
| World map | `worldmap.html` (`kind: map`) | Overviewer at `/map/` in an iframe below the nav; `/map` still works standalone (served on the server, not in this repo) |
| 404 | `404.html` | — |

**Stats section is in progress** — see below.

### Legacy leftovers (pre-redesign)
`boltmap.html` was NOT migrated: `layout: null`, its own hardcoded nav, Bootstrap 5 CDN
and `css/site.css` (which references `assets/background2.png`). `css/animate.min.css`,
`js/jquery.min.js(.map)` and `assets/background.png` are unreferenced. Don't extend the
legacy files; if touching boltmap, migrate it to `layout: default` instead.

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

## Stats section (current work)
Docs in this repo root (copied from Chronos-Bot, untracked):
- `STATS_PLAN.md` — agreed scope, feature list, hard rules. Decisions are final.
- `STATS_API.md` — the exact API contract. Build against it; don't invent fields. If a
  live response disagrees with it, stop and report (backend gets fixed, not worked around).
- `STATS_FRONTEND_PROMPT.md` — the kickoff brief for the frontend work.

Key points:
- Read-only JSON API at `/api/stats/*` (FastAPI/uvicorn behind nginx, live). Data
  changes every 15 min; responses carry `ETag` + `Cache-Control: public, max-age=60,
  stale-while-revalidate=900`. **No cache-buster params, no polling faster than 5 min.**
  Timestamps are unix seconds UTC; values are raw Minecraft integers.
- Six pages under one **"Stats ▾"** nav dropdown: Overview / Explorer / Scoreboards /
  Player / Compare / Milestones. Bolt map and World map stay separate top-level links.
  (Current nav is a flat list from `nav.yml` — the dropdown is new layout work.)
- Nothing hardcoded: scopes, servers, stat/objective lists, range presets, limits and
  badge thresholds all come from `/meta` / `/meta.settings`.
- Every page: All / CMPs / SMP switch + single-server picker; "include bots" toggle only
  where SMP is in view; "updated N min ago" from `/meta.last_run_at`.
- History: SMP from 2021-10-28 (imported backups, coarse), CMPs/`building` from
  2026-11-24 (dense). Honour `effective_from`; `earliest_known: 1` = "earliest known
  holder/before tracking", `approximate: 1` = "by <date>". Graphs are step lines and
  must handle single-point series and empty states.
- Unnamed players (`name: null`, ~1.6k): first 8 chars of uuid + Crafatar head
  (`https://crafatar.com/avatars/<uuid>?size=32&overlay`).
- **Local dev:** the API sends no CORS headers (deliberately), so local work needs a
  dependency-free dev server (planned: `tools/dev_server.py`, Python stdlib) that serves
  the built site and forwards `/api/stats/*` to `https://www.chronosmc.com` (override
  via `STATS_API_ORIGIN`, e.g. `http://localhost:8765` for a locally run API). Must pass
  `If-None-Match`, return 304/ETag/Cache-Control unchanged, send a browser User-Agent
  (Cloudflare 403s Python's default), and treat HTML-instead-of-JSON as a Cloudflare
  block. `tools/` is already in `_config.yml` `exclude`, so it never deploys.

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
