/* S.kit: wording and notes shared by the Stats pages (range text, "since" text, the chart
 * note's live-tracking line, tracking-off copy). Needs S.fmt (format.js) and core.js. */
(function (root) {
  const S = root.S = root.S || {};
  const UNITS = { h: 'hour', d: 'day', w: 'week', m: 'month', y: 'year' };

  const presets = m => (m && m.settings && m.settings.range_presets) || {};

  // A window with a start (preset or custom), not "all time".
  const ranged = st => !!((st.range && st.range !== 'all') || (!st.range && st.from != null));

  // "in the last week", "in the last 3 months", "between 1 Nov 2026 and 8 Nov 2026"
  function rangeText(st) {
    if (st.range === 'all') return 'since tracking began';
    if (st.range) {
      const m = /^(\d+)([hdwmy])$/.exec(st.range);
      if (!m) return 'in ' + st.range;
      const n = +m[1], u = UNITS[m[2]];
      return 'in the last ' + (n === 1 ? u : n + ' ' + u + 's');
    }
    if (st.from != null && st.to != null) return 'between ' + S.fmt.date(st.from) + ' and ' + S.fmt.date(st.to);
    return '';
  }

  // The start the reader asked for (null for all time).
  function requestedStart(m, st, res) {
    if (st.range && st.range !== 'all') return res.to - (presets(m)[st.range] || 0);
    if (!st.range && st.from != null) return st.from;
    return null;
  }

  // "since 24 Nov 2026" when the API clamped the window, or "since tracking began (…)" when
  // it starts at the oldest point of `servers`. Lowercase; '' when there is nothing to say.
  // `when` picks the unranged case: 'clamped' never, 'all' only for range=all, 'always' also
  // with no range at all.
  function sinceText(m, st, res, servers, when) {
    if (!res || res.effective_from == null) return '';
    const want = requestedStart(m, st, res);
    if (want != null) { if (!(res.effective_from > want + 60)) return ''; }
    else if (when === 'clamped' || (when !== 'always' && st.range !== 'all')) return '';
    const starts = (servers || []).map(s => ((m && m.tracking_started_at) || {})[s]).filter(t => isFinite(t));
    const began = starts.length ? Math.min.apply(null, starts) : null;
    return began != null && res.effective_from <= began
      ? 'since tracking began (' + S.fmt.date(res.effective_from) + ')'
      : 'since ' + S.fmt.date(res.effective_from);
  }

  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // Chart note line for the shaded imported span, when the live start falls inside the window.
  function liveNote(la, res) {
    if (la == null || !res || res.effective_from == null || !(res.effective_from < la && la < res.to)) return '';
    // a block of its own under the legend line; callers append it after the joined bits
    return '<span class="st-note-live"><em>Shaded: backup imports, a few points far apart.</em> Live 15-minute history since ' +
      S.fmt.esc(S.fmt.date(la)) + ' gets its own stretch of the axis.</span>';
  }

  function serverLabel(m, k) {
    const s = ((m && m.servers) || []).find(x => x.key === k);
    return s ? s.label : String(k).toUpperCase();
  }

  // "Scoreboards aren't tracked on CMP." when no server in the scope tracks the kind, else ''.
  function untracked(m, scope, kind) {
    if (S.tracked(m, scope, kind)) return '';
    const servers = S.scopeServers(m, scope);
    const where = servers.length === 1 ? serverLabel(m, servers[0]) : 'these servers';
    return (kind === 'scoreboard' ? 'Scoreboards' : 'Stats') + " aren't tracked on " + where + '.';
  }

  // Compare's row leader: the highest of the present values (null = missing, left out), or
  // null when they are all equal (or fewer than two are present).
  function leader(values) {
    const v = values.filter(x => x != null);
    if (v.length < 2 || v.every(x => x === v[0])) return null;
    return Math.max.apply(null, v);
  }

  // Chart axis option for a stat: ticks in its display unit.
  const axis = (category, key) => maxAbs => S.fmt.axisUnit(category, key, maxAbs);

  // Player page link that carries the reader's scope and bots choice. `who` is the first
  // non-empty of name, uuid, token.
  function playerHref(st, ...who) {
    return '/stats/player/?p=' + encodeURIComponent(who.find(Boolean)) +
      (st && st.scope ? '&scope=' + encodeURIComponent(st.scope) : '') + (st && st.bots ? '&bots=true' : '');
  }

  // Full leaderboard for one stat or objective (Explorer / Scoreboards), keeping scope and bots.
  function boardHref(kind, category, key, st) {
    const q = [];
    const add = (k, v) => q.push(k + '=' + encodeURIComponent(v));
    if (st && st.scope) add('scope', st.scope);
    if (st && st.bots) add('bots', 'true');
    if (kind === 'scoreboard') { add('key', key); return '/stats/scoreboards/?' + q.join('&'); }
    add('cat', category); add('key', key);
    return '/stats/explorer/?' + q.join('&');
  }

  // /totals: each line starts at its own data (starts[part]; null = no data in the window).
  // Older responses without `starts` share effective_from.
  function lineStart(res, part) {
    if (!res) return null;
    if (res.starts && Object.prototype.hasOwnProperty.call(res.starts, part)) return res.starts[part];
    return res.effective_from == null ? null : res.effective_from;
  }

  // A ranking without some players: each row moves up by the number of hidden rows ranked
  // above it, so ties stay ties. Rows must start at rank 1 (offset 0) for the numbers to hold.
  function hideRows(rows, hide) {
    const gone = [];
    const out = [];
    for (const r of rows || []) {
      if (hide && hide.has(r.uuid)) { gone.push(r.rank); continue; }
      out.push(Object.assign({}, r, { rank: r.rank - gone.filter(g => g < r.rank).length }));
    }
    return out;
  }

  S.kit = { hideRows, lineStart, playerHref, boardHref, ranged, rangeText, requestedStart, sinceText, cap, liveNote, serverLabel, untracked, leader, axis };
  if (typeof module !== 'undefined') module.exports = S.kit;
})(typeof window !== 'undefined' ? window : globalThis);
