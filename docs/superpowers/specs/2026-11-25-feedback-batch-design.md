# Owner feedback batch (2026-11-25): design

Source: owner's manual pass over the live site (`TEMP_FEEDBACK.md`, 13 items, plus a later
note about the logo). Goal: fix the rough edges they hit while using the site. These are
mostly independent small changes. Two of them (fake players, heads) need backend work,
which goes into a handoff prompt for Chronos-Bot.

## Non-goals / anti-goals
- No new pages or features beyond what's listed. Don't redesign pages while touching them.
- Nothing that "feels too AI" (see CLAUDE.md). Tooltips and labels stay plain and specific.
- Don't work around missing backend fields in the frontend (STATS_API rule): if search
  needs a bot flag or exclusion, the backend adds it.
- Keep Crafatar → mc-heads as head fallbacks (CLAUDE.md), even once heads are cached on our server.

## Frontend changes

1. **Badge tooltips.** Replace the native `title` on `.st-badge` (player page) with a styled
   tooltip in the site's style: dark panel, 1px line, mono label, no shadow. It shows on hover
   and keyboard focus (badges become focusable), and toggles on tap for touch. Text comes from
   `F.badge().desc`, which already exists. Badges with an empty desc get no tooltip. Built as a
   small reusable `S.ui.tip` so other native `title`s can move to it later (not in this batch).
   Respects reduced motion.
2. **Fake players in search.** Frontend: none, pending the backend (below). If the backend adds
   a flag instead of excluding, filter on it then.
3. **Player → leaderboard, for any rank.** A "Leaderboard →" link to `/stats/explorer/` (or
   `/stats/scoreboards/` for objectives) for that stat, carrying scope and bots, appears:
   on each "Number one in" / "Best ranks" pod, next to the profile graph title (for the
   selected stat), and on each row of the profile's All stats and Scoreboards tables. Clicking
   a pod or row itself still selects it into the in-page graph, as now.
3a. **Paged tables.** `S.ui.table` swaps "Load more" (which keeps adding rows) for real
   pages: `‹ 1 2 3 … 80 ›` plus "Showing 51–100 of 4,012". Sorting or filtering goes back to
   page 1. Applies everywhere the table is used. The milestones list on the profile ("Load
   more", 20 at a time) switches to pages too.
3b. **Top players (Stats overview).** A new section: a few short ranked lists, top 5 each
   with heads, linking to the full ranking: most #1 spots, most hours played, most firsts,
   most badges. Follows the page's scope (and bots). Hours played comes from the existing
   `/leaderboard`. The others need a new backend endpoint (below). The "full ranking" for
   hours played is the explorer; for the others it's a paged table on the overview (or a tab
   on it, builder's call).
3e. **Explorer/Scoreboards leaderboard: reset + player filter.** A "Reset to top N" button
   (N = `maxLines()`, today 6) in the board header puts the chart back to the default picks
   (the top N rows). It only shows when the selection differs from the default. A filter box
   above the table narrows rows by player name. It uses a new backend `q` param on
   `/leaderboard` so each row keeps its true rank and matches beyond the loaded page are found.
   The board's "Load more" becomes pages like 3a (`offset`/`limit`).
3f. **Explorer/Scoreboards "Servers" chart follows the scope.** Today `serverParts()` always
   draws the parts of `all` (SMP + CMPs combined) whatever scope is picked, with
   `liveAt('all')`. New: scope `smp` (or any single server) → that server's line only. A group
   scope (`cmps`) → one line per member server. `all` → one line per server in `meta.servers`
   order. Colours come from the 8-colour `LINES` palette (`PARTS` only has 4). `liveAt` uses the
   selected scope. The "since" text and live note follow it. Known limit until the backend
   changes: `/totals` gives all lines one shared `effective_from` (the latest-starting server),
   so in `cmps`/`all` SMP's pre-24-Nov history is cut off. The backend item below fixes that.
3c. **Compare dropdown hidden.** The stat/player autocomplete list (`.st-ac`) is drawn under the
   later `.panel` message ("Add at least 2 players…"), which has a backdrop filter and so
   creates its own stacking layer. Give the autocomplete wrapper a `z-index` above the panels.
   Check every page that has an autocomplete.
3d. **Search with spaces.** `S.ui.autocomplete` sends `q` with runs of whitespace turned into
   `_` ("redstone block" → "redstone_block"). Player and objective names can't contain spaces,
   so this is safe for all three groups.
4. **Bolt map migration.** `boltmap.html` → `layout: default`, shared nav/bg/footer,
   `chronos.css` building blocks, `C.json`/`C.stamp`/`C.fail`/`C.esc`. Drop Bootstrap CDN and
   `css/site.css`. Same data (`/data/boltmap.json`), same information shown. Unreferenced
   legacy files (`css/site.css`, `css/animate.min.css`, `js/jquery*`, `assets/background*.png`)
   are deleted once nothing references them.
5. **Pills never wrap.** `.pill{white-space:nowrap}` in `chronos.css`. Also check the
   `st-` pill/chip equivalents. Where a pill sits inline at the end of a sentence (storage
   lede), the whole pill moves to the next line instead of splitting.
6. **Status network row.** Value column: `1514.33 GB ↑ / 63.52 GB ↓` style, both numbers on the
   right. Sub text: "sent / received since boot".
7. **Status server list.** Labels uppercased. Fixed order: SMP, CMP, CMP2, CMP3, CMP4, MIRROR,
   SNAPSHOT, TOUR, PUBLIC. Servers not in the list go after, alphabetically. Matching is
   case-insensitive on the `server_status.json` key. The order list lives in `status.html`
   (that file isn't Stats-API data, so the "never sort" rule doesn't apply).
8. **World map.** Remove the `<h1>World map</h1>` overlay. Keep "Open full map ↗", placed
   so it doesn't cover the Overviewer controls. The page title stays in the nav.
9. **Chart label overlap.** Increase `PAD_T` in `chart.js` (and the y-domain headroom) so the
   BACKUPS / LIVE · EVERY 15 MIN labels sit in a band above the highest plotted value.
   Checked at mobile widths too.
9b. **Tidy the value-card fallback (owner: keep it).** `S.chart` shows a `.st-valuecard`
   list instead of a graph when every line has exactly one point (a server where nothing
   changed since tracking began; it clears once a value changes in a snapshot). While the card
   is showing: the page's note drops the colour legend (no lines to match), and the date shows
   once (e.g. a single "As of 24 Nov 2026" line), not on every row. `S.chart` exposes whether
   the card is active (e.g. a flag on the instance or the `update` return value) so the
   pages' note painters (explorer, player, compare, overview) can react. Tests updated.
9a. **Chart note on its own line.** The "Shaded: backup imports… gets its own stretch of the
   axis." note (`S.kit.liveNote` in `pagekit.js`) is currently joined onto the colour legend
   line. Wrap it in a block-level element so it always starts its own line under the legend,
   on every page that uses it.
10. **Player heads.** Frontend: `S.ui.head` tries `/cache/heads/<uuid>.png` (served by our
    server, written by the backend) first, then Crafatar, then mc-heads, then the letter.
    Same per-source failure counting as now.
11. **Item/block icons (approach A, chosen by owner: render from the client jar).** Backend
    work. The bot already owns `/cache/items/`. Frontend: no URL change (`/cache/items/<id>.png`).
    Storage maps display name → id with `lower().replace(' ', '_')`; the backend's render run
    reports ids it couldn't draw, and any storage names that miss get a small override map
    in `storage.html`.
12. **Category icons.** A fixed `CAT_ICON` map in `format.js` used by the explorer category list
    (and anything else showing a category icon): broken → `/assets/img/cat-broken.png` (the
    owner's `flint_and_steel_damaged2.png`, moved and renamed), crafted → `crafting_table`,
    custom/General → `player_head`, dropped → `dirt`, killed → `diamond_sword`, killed_by →
    `creeper_spawn_egg`, mined → `diamond_pickaxe`, picked_up → `netherrack`, used →
    `firework_rocket`. Badge art (`CAT_ART`) uses the same map. This is a second curated list
    next to `HEADLINES`, which is fine because these are pictures, not data. CLAUDE.md gets a
    one-line note.
13. **Logo alignment.** Optically center the "CHRONOS" text on the logo in `.brand` (nav) and
    the home hero mark + wordmark. Nudge down via line-height/padding, not absolute positioning.

## Approaches considered (icons)
- **A. Backend renders icons from the client jar (chosen by owner):** flat items copied from
  `textures/item`. Block items are drawn isometric from their block models: any model made of
  boxes (cubes, slabs, stairs, fences, walls, panes…) via a small box renderer. Updates
  automatically for each MC version. `builtin/entity` items (chests, beds, heads, shields,
  banners, signs…) need special cases or a fallback.
- B. One-time in-game export with a mod: pixel-exact, but no confirmed mod for the server's
  version/loader, and a manual redo for each version. Dropped once the owner preferred the jar.
- C. Keep scraping mcasset with a name map: patchy, ongoing gaps.

## Backend handoff (written as a prompt after the plan)
- `/search` (and anywhere else names are listed: leaderboards, feeds, rivalries) excludes
  fake players. Suggested detection: offline-mode (version-3) UUIDs = carpet fake players.
  Plus the existing SMP no-team rule. The backend decides the exact rule and documents it in
  STATS_API.md.
- Cache player heads at `/cache/heads/<uuid>.png` (face + hat layer, from the Mojang skin),
  refreshed periodically. nginx serves them like `/cache/items/`.
- Icon renderer from the client jar (approach A above) into `/cache/items/<id>.png` for every
  item id in the game, including spawn eggs (tinted template on older versions, own textures
  from 1.21.5) and `player_head`. Re-runnable for each version. Prints the ids it couldn't draw.
- New ranking endpoint for Top players: per scope (+ `include_bots`), players ranked by
  number of #1 spots, number of real firsts, number of badges. Paged (`limit`/`offset`)
  like `/leaderboard`. Contract added to STATS_API.md.
- `/totals`: each line starts at its own first data (per-line start, or per-scope
  `effective_from`) instead of one shared start, so SMP's imported history shows next to
  servers that started later. Frontend draws per-line starts once the contract says how.
- `/leaderboard`: optional `q` (case-insensitive name match). Rows keep their real `rank`,
  and the total reflects the filtered count for paging.
- Optional: `/search` could also treat spaces as `_`, for other clients (the frontend
  already does this).

## Left to the builder
Exact tooltip markup/positioning, bolt map layout within the design system, the exporter mod
choice (verify one exists for the server's MC version and loader), padding values.
