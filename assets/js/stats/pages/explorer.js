/* Stat explorer (/stats/explorer/) and Scoreboards (/stats/scoreboards/): one script, the
 * page's root <div id="ex-root" data-kind="stat|scoreboard"> picks the kind.
 *
 * Layout: big search (players -> Player page, stats -> select here or open the Explorer,
 * objectives -> select here or open Scoreboards), controls bar, then browse | selected stat.
 * Browse is category buttons from /meta.categories plus a filterable key list from /keys
 * (Scoreboards: the objective list, `removed` ones tagged). The selected stat gets a header,
 * a chart (Top players = /series for up to settings.limits.series_players leaderboard rows,
 * toggled by clicking rows; Servers = /totals per top-level part) and a /leaderboard table
 * that grows by 50 up to settings.limits.leaderboard.
 *
 * Requests: first paint is /meta + /leaderboard (Scoreboards with no objective chosen needs
 * /keys first to find the default). Then /keys and the chart in parallel. Responses are kept
 * per parameter set. `gen` drops stale stat loads, `kgen` stale key lists, `cgen` stale charts.
 * Every API string goes through S.fmt.esc (or textContent) before it reaches the DOM.
 * Page-only classes (stats.css): st-ex st-ex-search st-ex-q st-ex-grid st-ex-browse st-ex-cats
 * st-ex-cat st-ex-keys st-ex-key st-ex-tag st-ex-cap st-ex-main st-ex-stat st-ex-top st-ex-head
 * st-ex-title st-ex-name st-ex-meta st-ex-board st-ex-bh st-ex-hint st-ex-sw st-ex-pl st-ex-foot.
 */
(function () {
  const S = window.S, F = S.fmt, esc = F.esc;
  const $ = id => document.getElementById(id);
  const rootEl = $('ex-root');
  const SB = !!rootEl && rootEl.dataset.kind === 'scoreboard';
  const KIND = SB ? 'scoreboard' : 'stat';
  const DEF = SB ? { kind: KIND, cat: '', key: '' } : { kind: KIND, cat: 'minecraft:custom', key: 'minecraft:play_time' };
  const LINES = ['var(--teal)', 'var(--cmp)', '#8fa3c9', '#c98fa8', '#9cc48c', '#b59ad8', '#d49a6a', '#7cc4c9'];
  const PARTS = ['var(--teal)', 'var(--cmp)', '#8fa3c9', '#c98fa8'];
  const STEP = 50;          // leaderboard rows per "Load more"
  const LIST_CAP = 250;     // key list rows rendered at once; the filter narrows the rest
  const UNITS = { h: 'hour', d: 'day', w: 'week', m: 'month', y: 'year' };

  const el = {
    controls: $('ex-controls'), app: $('ex-app'), q: $('ex-q'), cats: $('ex-cats'), filter: $('ex-filter'),
    keys: $('ex-keys'), head: $('ex-head'), mode: $('ex-mode'), chart: $('ex-chart'), note: $('ex-note'),
    board: $('ex-board'), stat: document.querySelector('.st-ex-stat'),
  };

  let meta = null, st = null, info = null, gen = 0, kgen = 0, cgen = 0, chart = null;
  let keys = null, keysErr = null;   // /keys for the scope
  let browseCat = null;              // category shown in the key list (stats only)
  let mode = 'top';                  // chart mode: top | servers
  let board = null, boardErr = null, limit = STEP, loadingMore = false;
  let picked = [];                   // uuids drawn in Top players, in click order
  const colorOf = new Map();         // uuid -> LINES index while picked
  const names = new Map();           // uuid -> display name
  const memo = new Map();

  function get(path, params) {
    const k = path + '?' + JSON.stringify(params);
    if (!memo.has(k)) {
      const p = S.api(path, params);
      memo.set(k, p);
      p.catch(() => memo.delete(k));
    }
    return memo.get(k);
  }

  const limits = () => (meta.settings && meta.settings.limits) || {};
  const maxRows = () => limits().leaderboard || 200;
  const maxLines = () => Math.max(1, Math.min(LINES.length, limits().series_players || 6));
  const bots = () => (info.hasSmp && st.bots ? 'true' : null);
  const hasIcon = cat => !SB && !['custom', 'killed', 'killed_by'].includes(F.itemId(cat));
  const catLabel = c => (F.itemId(c) === 'custom' ? 'General' : F.statLabel(c, 'x').cat);
  const label = () => (SB ? { cat: 'Objective', name: st.key, full: st.key } : F.statLabel(st.cat, st.key));
  const disp = v => F.display(SB ? 'scoreboard' : st.cat, st.key, v);
  const statParams = () => (SB ? { kind: KIND, key: st.key } : { kind: KIND, category: st.cat, key: st.key });
  const serverLabel = k => { const s = (meta.servers || []).find(x => x.key === k); return s ? s.label : String(k).toUpperCase(); };
  const partLabel = k => (k === 'all' ? 'All' : serverLabel(k));
  const scopeServers = () => info.servers || (meta.servers || []).map(s => s.key);
  const playerHref = r => '/stats/player/?p=' + encodeURIComponent(r.name || r.uuid);
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fmtCount = n => Number(n || 0).toLocaleString('en-GB');

  // Servers mode compares the top-level parts (smp vs cmps). Without /meta.scope_groups it
  // falls back to the selected scope alone, which is no comparison, so the toggle hides.
  function serverParts() {
    return meta.scope_groups ? S.scopeInfo(meta, 'all').parts : [st.scope];
  }

  // ---- wording for ranges
  function rangeText() {
    if (st.range === 'all') return 'since tracking began';
    if (st.range) {
      const m = /^(\d+)([hdwmy])$/.exec(st.range);
      if (!m) return 'in ' + st.range;
      const n = +m[1], u = UNITS[m[2]];
      return 'in the last ' + (n === 1 ? u : n + ' ' + u + 's');
    }
    if (st.from != null && st.to != null) return 'between ' + F.date(st.from) + ' and ' + F.date(st.to);
    return '';
  }
  function requestedStart(res) {
    if (st.range && st.range !== 'all') return res.to - (((meta.settings && meta.settings.range_presets) || {})[st.range] || 0);
    if (!st.range && st.from != null) return st.from;
    return null;
  }
  // "Since 24 Nov 2026" when the API clamped the window (or "since tracking began (…)").
  function sinceText(res, servers) {
    if (!res || res.effective_from == null) return '';
    const want = requestedStart(res);
    if (want != null && !(res.effective_from > want + 60)) return '';
    if (want == null && st.range !== 'all') return '';
    const starts = servers.map(s => (meta.tracking_started_at || {})[s]).filter(t => isFinite(t));
    const began = starts.length ? Math.min.apply(null, starts) : null;
    return began != null && res.effective_from <= began
      ? 'since tracking began (' + F.date(res.effective_from) + ')'
      : 'since ' + F.date(res.effective_from);
  }

  // ---- header
  function paintHead() {
    if (!st.key) { el.head.innerHTML = '<div class="st-ex-title"><div><span class="st-lab">' + (SB ? 'Objective' : 'Stat') + '</span><h2 class="st-ex-name">–</h2></div></div>'; return; }
    const l = label();
    const art = hasIcon(st.cat) ? S.ui.iconHtml(F.itemId(st.key), 36) : '';
    const obj = SB && keys && (keys.objectives || []).find(o => o.objective === st.key);
    const bits = [];
    bits.push(scopeServers().map(k => '<span class="st-chip">' + esc(serverLabel(k)) + '</span>').join(''));
    if (obj && obj.removed) bits.push('<span class="st-ex-tag">Removed</span>');
    if (board) {
      if (board.mode === 'delta') {
        const since = sinceText(board, scopeServers());
        bits.push('<span>' + esc(fmtCount(board.total_count)) + (board.total_count === 1 ? ' player' : ' players') + ' gained ' + esc(since || rangeText()) + '</span>');
      } else {
        bits.push('<span>' + esc(fmtCount(board.total_count)) + (board.total_count === 1 ? ' player' : ' players') + '</span>');
      }
    }
    el.head.innerHTML = '<div class="st-ex-title">' + art + '<div><span class="st-lab">' + esc(SB ? 'Objective' : (l.cat || 'General')) + '</span>' +
      '<h2 class="st-ex-name">' + esc(SB ? l.full : l.name) + '</h2></div></div>' +
      '<div class="st-ex-meta">' + bits.join('') + '</div>';
    S.ui.hydrate(el.head);
  }

  // ---- browse: categories and the key list
  function catKeys(c) { return (keys && keys.stats && keys.stats[c]) || []; }

  function paintCats() {
    if (!el.cats) return;
    el.cats.innerHTML = (meta.categories || []).map(c => {
      const on = c === browseCat;
      const first = catKeys(c)[0];
      const art = hasIcon(c) && first ? S.ui.iconHtml(F.itemId(first), 18, catLabel(c).charAt(0)) : S.ui.iconHtml('', 18, catLabel(c).charAt(0));
      const n = keys ? catKeys(c).length : null;
      return '<button type="button" class="st-ex-cat' + (on ? ' on' : '') + '" data-cat="' + esc(c) + '" aria-pressed="' + on + '">' +
        art + '<span>' + esc(catLabel(c)) + '</span>' + (n != null ? '<small>' + esc(fmtCount(n)) + '</small>' : '') + '</button>';
    }).join('');
    S.ui.hydrate(el.cats);
  }

  function listItems() {
    if (SB) return ((keys && keys.objectives) || []).map(o => ({ cat: '', key: o.objective, name: o.objective, removed: !!o.removed }));
    return catKeys(browseCat).map(k => ({ cat: browseCat, key: k, name: F.statLabel(browseCat, k).name }));
  }

  function paintKeys() {
    if (keysErr) { S.ui.error(el.keys, keysErr); return; }
    if (!keys) { el.keys.innerHTML = '<div class="st-empty">Loading…</div>'; return; }
    const all = listItems();
    const q = el.filter.value.trim().toLowerCase();
    const hits = q ? all.filter(it => it.name.toLowerCase().includes(q) || F.itemId(it.key).includes(q.replace(/ /g, '_'))) : all;
    if (!all.length) {
      S.ui.empty(el.keys, SB ? 'No scoreboard objectives are tracked on this scope yet.' : 'Nobody on this scope has a stat in this category yet.');
      return;
    }
    if (!hits.length) { S.ui.empty(el.keys, 'Nothing here matches "' + el.filter.value.trim() + '".'); return; }
    // a long list renders a window of LIST_CAP rows, centred on the selected key when it has one
    const cur = hits.find(it => it.key === st.key && it.cat === (SB ? '' : st.cat));
    const ci = cur ? hits.indexOf(cur) : 0;
    const start = Math.max(0, Math.min(ci - LIST_CAP / 2, hits.length - LIST_CAP));
    const shown = hits.slice(start, start + LIST_CAP);
    const tabbable = cur || shown[0];
    el.keys.innerHTML = '<ul role="list">' + shown.map(it => {
      const on = it === cur;
      return '<li><button type="button" class="st-ex-key' + (on ? ' on' : '') + '" data-cat="' + esc(it.cat) + '" data-key="' + esc(it.key) +
        '" aria-pressed="' + on + '" tabindex="' + (it === tabbable ? 0 : -1) + '">' +
        (hasIcon(it.cat) ? S.ui.iconHtml(F.itemId(it.key), 20) : '') + '<span>' + esc(it.name) + '</span>' +
        (it.removed ? '<span class="st-ex-tag">Removed</span>' : '') + '</button></li>';
    }).join('') + '</ul>' +
      (hits.length > LIST_CAP ? '<p class="st-ex-cap">Showing ' + esc(fmtCount(start + 1)) + '–' + esc(fmtCount(start + shown.length)) + ' of ' +
        esc(fmtCount(hits.length)) + '. Type in the filter to find the rest.</p>' : '');
    S.ui.hydrate(el.keys);
    revealCurrent();
  }

  // Scroll the key list (not the page) so the selected key is visible.
  function revealCurrent() {
    const b = el.keys.querySelector('.st-ex-key.on');
    if (!b) return;
    const top = b.offsetTop - el.keys.offsetTop, bottom = top + b.offsetHeight;
    if (top < el.keys.scrollTop || bottom > el.keys.scrollTop + el.keys.clientHeight) {
      el.keys.scrollTop = Math.max(0, top - el.keys.clientHeight / 2);
    }
  }

  function paintBrowse() { paintCats(); paintKeys(); }

  async function loadKeys(my) {
    keys = null; keysErr = null;
    paintBrowse();
    try {
      const res = await get('keys', { scope: st.scope, kind: KIND });
      if (my !== kgen) return null;
      keys = res;
    } catch (err) {
      if (my !== kgen) return null;
      keysErr = err;
    }
    paintBrowse();
    paintHead();
    return keys;
  }

  // ---- leaderboard
  function rowSwatch(uuid) {
    const on = mode === 'top' && colorOf.has(uuid);
    return '<span class="st-ex-sw' + (on ? ' on' : '') + '" data-uuid="' + esc(uuid) + '"' +
      (on ? ' style="background:' + LINES[colorOf.get(uuid)] + '"' : '') + '>' + (on ? '<span class="sr-only">On the chart</span>' : '') + '</span>';
  }

  function paintSwatches() {
    el.board.querySelectorAll('.st-ex-sw').forEach(s => { s.outerHTML = rowSwatch(s.dataset.uuid); });
  }

  function boardEmpty() {
    const thing = label().full;
    if (board && board.mode === 'delta') return 'Nobody gained any ' + thing + ' ' + (rangeText() || 'in this range') + '. Try a longer range.';
    return SB ? 'Nobody on this scope has a score in ' + thing + ' yet.' : 'Nobody on this scope has any ' + thing + ' yet.';
  }

  function paintBoard(focusFrom) {
    if (boardErr) {
      el.board.innerHTML = '<div class="st-ex-bh"><h2 class="st-h2">Leaderboard</h2></div><div class="st-ex-tbl"></div>';
      S.ui.error(el.board.lastChild, boardErr);
      return;
    }
    if (!board) {
      el.board.innerHTML = '<div class="st-ex-bh"><h2 class="st-h2">Leaderboard</h2></div><div class="st-empty">Loading…</div>';
      return;
    }
    const rows = board.rows || [];
    const delta = board.mode === 'delta';
    const hint = rows.length ? 'Click or press Enter on a row to add or remove its line (up to ' + maxLines() + ').' : '';
    el.board.innerHTML = '<div class="st-ex-bh"><h2 class="st-h2">Leaderboard</h2><span class="st-ex-hint">' + esc(hint) + '</span></div>' +
      '<div class="st-ex-tbl"></div>';
    const tblEl = el.board.lastChild;
    if (!rows.length) { S.ui.empty(tblEl, boardEmpty()); return; }
    S.ui.table(tblEl, {
      columns: [
        { id: 'rank', label: '#', num: true },
        { id: 'name', label: 'Player', sort: r => F.playerName(r).toLowerCase() },
        { id: 'value', label: delta ? 'Gained' : (SB ? 'Score' : 'Value'), num: true, sort: true },
      ],
      rows,
      pageSize: 100000,
      rowHtml: r => {
        const d = disp(r.value);
        return '<td class="st-num st-ex-rk">' + rowSwatch(r.uuid) + esc(r.rank) + '</td>' +
          '<td><a class="st-ex-pl" href="' + esc(playerHref(r)) + '">' + S.ui.headHtml(r.uuid, 24) + '<span>' + esc(F.playerName(r)) + '</span></a></td>' +
          '<td class="st-num" title="' + esc(d.exact) + '">' + (delta && r.value > 0 ? '+' : '') + esc(d.text) + '</td>';
      },
      onRow: r => toggle(r.uuid),
    });
    const cap = Math.min(board.total_count || 0, maxRows());
    const foot = document.createElement('div');
    foot.className = 'st-table-foot st-ex-foot';
    let text = 'Showing ' + fmtCount(rows.length) + ' of ' + fmtCount(board.total_count);
    if (rows.length >= maxRows() && board.total_count > rows.length) text += '. The board stops at ' + fmtCount(maxRows()) + '; search a player to see their own rank.';
    foot.innerHTML = '<span class="st-table-count">' + esc(text) + '</span>' +
      (rows.length < cap && limit < maxRows() ? '<button type="button" class="st-more">Load more</button>' : '');
    tblEl.appendChild(foot);
    if (focusFrom != null) {
      const tr = tblEl.querySelector('tr[data-i="' + focusFrom + '"]');
      if (tr) tr.focus();
    }
  }

  async function loadBoard(my, focusFrom) {
    const req = Object.assign(statParams(), { scope: st.scope, include_bots: bots(), limit }, S.rangeParams(st));
    let res;
    try {
      res = await get('leaderboard', req);
    } catch (err) {
      if (my !== gen) return false;
      boardErr = err; board = null;
      paintBoard(); paintHead();
      return false;
    }
    if (my !== gen) return false;
    const first = !board;
    board = res; boardErr = null;
    (res.rows || []).forEach(r => names.set(r.uuid, F.playerName(r)));
    if (first) {
      picked = (res.rows || []).slice(0, maxLines()).map(r => r.uuid);
      colorOf.clear();
      picked.forEach((u, i) => colorOf.set(u, i));
    }
    paintBoard(focusFrom); paintHead();
    return true;
  }

  async function loadMore() {
    if (loadingMore || !board) return;
    loadingMore = true;
    const btn = el.board.querySelector('.st-ex-foot .st-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    const from = (board.rows || []).length;
    limit = Math.min(limit + STEP, maxRows());
    await loadBoard(gen, from);
    loadingMore = false;
  }

  // ---- chart
  function liveAt(servers) {
    const live = meta.live_started_at;
    if (!live) return null;
    const ts = servers.map(s => live[s]).filter(t => isFinite(t));
    return ts.length ? Math.min.apply(null, ts) : null;
  }

  function chartMessage(text, isErr) {
    if (chart) { chart.destroy(); chart = null; }
    el.chart.innerHTML = '<div class="st-chart"></div>';
    if (isErr) S.ui.error(el.chart.firstChild, isErr);
    else S.ui.empty(el.chart.firstChild, text);
    el.note.innerHTML = '';
  }

  function paintNote(series, res, servers, extra) {
    const keysHtml = series.map(s => '<span class="st-k" style="background:' + s.color + '"></span>' + esc(s.label)).join(' &nbsp; ');
    const bits = [keysHtml];
    const since = sinceText(res, servers);
    if (since) bits.push(esc(since.charAt(0).toUpperCase() + since.slice(1)));
    const la = liveAt(servers);
    if (la != null && res.effective_from < la && la < res.to) {
      bits.push('<em>Shaded: backup imports, a few points far apart.</em> Live 15-minute history since ' + esc(F.date(la)) + ' gets its own stretch of the axis.');
    }
    if (extra) bits.push('<em>' + esc(extra) + '</em>');
    el.note.innerHTML = bits.join(' &nbsp;·&nbsp; ');
  }

  let noteExtra = '';
  async function drawChart() {
    const my = ++cgen, g = gen;
    const extra = noteExtra; noteExtra = '';
    if (!st.key) { chartMessage(SB ? 'Pick an objective to see its history.' : 'Pick a stat to see its history.'); return; }
    let series, res, servers;
    if (!chart) el.chart.innerHTML = '<div class="st-chart"><div class="st-empty">Loading…</div></div>';
    try {
      if (mode === 'top') {
        if (!board) { chartMessage(boardErr ? 'The leaderboard didn\'t load, so there are no players to draw. Try the Servers view or reload the page.' : 'Loading…'); return; }
        if (!picked.length) { chartMessage((board.rows || []).length ? 'Click a row in the leaderboard to draw that player\'s line.' : 'No players to draw for this range.'); return; }
        const uuids = picked.slice();
        servers = scopeServers();
        res = await get('series', Object.assign(statParams(), { uuids: uuids.join(','), scope: st.scope, include_bots: bots() }, S.rangeParams(st)));
        series = uuids.map(u => ({ id: u, label: names.get(u) || u.slice(0, 8), color: LINES[colorOf.get(u)], points: ((res && res.series) || {})[u] || [] }));
      } else {
        const parts = serverParts();
        servers = (meta.servers || []).map(s => s.key);
        res = await get('totals', Object.assign(statParams(), { scopes: parts.join(','), include_bots: bots() }, S.rangeParams(st)));
        series = parts.map((p, i) => ({ id: p, label: partLabel(p), color: PARTS[i % PARTS.length], points: ((res && res.series) || {})[p] || [] }));
      }
    } catch (err) {
      if (my !== cgen || g !== gen) return;
      chartMessage('', err);
      return;
    }
    if (my !== cgen || g !== gen) return;
    const o = {
      series, from: res.effective_from, to: res.to, liveAt: liveAt(servers), height: 280,
      format: v => (v === 0 ? '0' : disp(v).text),
      emptyText: 'Nothing recorded for ' + label().full + ' in this range yet.',
    };
    if (chart) chart.update(o); else { el.chart.innerHTML = ''; chart = S.chart(el.chart, o); }
    paintNote(series, res, servers, extra);
  }

  function setMode(m) {
    mode = m;
    el.mode.querySelectorAll('button').forEach(b => {
      const on = b.dataset.value === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    paintSwatches();
  }

  function toggle(uuid) {
    if (mode !== 'top') setMode('top');
    const i = picked.indexOf(uuid);
    if (i >= 0) { picked.splice(i, 1); colorOf.delete(uuid); }
    else if (picked.length >= maxLines()) {
      noteExtra = 'Up to ' + maxLines() + ' lines at once. Click a marked row to remove one first.';
    } else {
      const used = new Set(colorOf.values());
      let c = 0;
      while (used.has(c)) c++;
      picked.push(uuid); colorOf.set(uuid, c);
    }
    paintSwatches();
    drawChart();
  }

  // ---- loading
  function resetStat() {
    board = null; boardErr = null; limit = STEP; picked = []; colorOf.clear();
    paintBoard(); paintHead();
  }

  async function loadStat() {
    const my = ++gen;
    resetStat();
    if (!st.key) { drawChart(); return; }
    await loadBoard(my);
    if (my !== gen) return;
    drawChart();
  }

  async function load() {
    const my = ++gen, km = ++kgen;
    info = S.scopeInfo(meta, st.scope);
    keys = null; keysErr = null;
    paintBrowse();
    resetStat();
    if (!chart) el.chart.innerHTML = '<div class="st-chart"><div class="st-empty">Loading…</div></div>';
    if (SB && !st.key) {
      // the default objective is the first one in this scope's list
      const k = await loadKeys(km);
      if (my !== gen) return;
      const first = k && (k.objectives || [])[0];
      if (!first) {
        el.board.innerHTML = '';
        if (keysErr) S.ui.error(el.board, keysErr);
        else S.ui.empty(el.board, 'No scoreboard objectives are tracked on this scope yet.');
        chartMessage('No objective to draw.');
        return;
      }
      st.key = first.objective;
      S.state.write(st);
      paintKeys(); paintHead();
      await loadBoard(my);
      if (my !== gen) return;
      drawChart();
      return;
    }
    await loadBoard(my);
    if (my !== gen) return;
    loadKeys(km);
    drawChart();
  }

  function selectStat(cat, key, fromList) {
    if (cat === st.cat && key === st.key) return;
    st.cat = cat; st.key = key;
    S.state.write(st);
    el.keys.querySelectorAll('.st-ex-key').forEach(b => {
      const on = b.dataset.key === key && b.dataset.cat === cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // phones stack browse below the stat: bring the stat into view after a pick from the list
    if (fromList && window.matchMedia && matchMedia('(max-width: 820px)').matches && el.stat) {
      el.stat.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    }
    loadStat();
  }

  // ---- wiring
  if (el.cats) {
    el.cats.addEventListener('click', e => {
      const b = e.target.closest('.st-ex-cat');
      if (!b || b.dataset.cat === browseCat) return;
      browseCat = b.dataset.cat;
      el.filter.value = '';
      paintBrowse();
    });
  }
  el.filter.addEventListener('input', paintKeys);
  el.keys.addEventListener('click', e => {
    const b = e.target.closest('.st-ex-key');
    if (b) selectStat(b.dataset.cat, b.dataset.key, true);
  });
  // one tab stop for the list; arrows move between keys
  el.keys.addEventListener('keydown', e => {
    const btns = Array.from(el.keys.querySelectorAll('.st-ex-key'));
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(btns.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = btns.length - 1;
    if (j < 0) return;
    e.preventDefault();
    btns[i].tabIndex = -1; btns[j].tabIndex = 0; btns[j].focus();
  });
  el.filter.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown') return;
    const b = el.keys.querySelector('.st-ex-key');
    if (b) { e.preventDefault(); el.keys.querySelectorAll('.st-ex-key').forEach(x => { x.tabIndex = -1; }); b.tabIndex = 0; b.focus(); }
  });
  el.mode.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.value === mode) return;
    setMode(b.dataset.value);
    drawChart();
  });
  el.board.addEventListener('click', e => {
    if (e.target.closest('.st-ex-foot .st-more')) loadMore();
  });

  function onPick(it) {
    el.q.value = '';
    if (it.type === 'player') { location.href = playerHref(it); return; }
    if (it.type === 'stat') {
      if (SB) { location.href = '/stats/explorer/?cat=' + encodeURIComponent(it.category) + '&key=' + encodeURIComponent(it.key); return; }
      if (browseCat !== it.category) { browseCat = it.category; el.filter.value = ''; paintBrowse(); }
      selectStat(it.category, it.key);
      paintKeys();
      return;
    }
    if (it.type === 'objective') {
      if (!SB) { location.href = '/stats/scoreboards/?key=' + encodeURIComponent(it.objective); return; }
      el.filter.value = '';
      selectStat('', it.objective);
      paintKeys();
    }
  }

  async function start() {
    try {
      meta = await S.meta();
    } catch (err) {
      el.app.style.display = 'none';
      el.q.parentNode.style.display = 'none';
      S.ui.error(el.controls, err);
      return;
    }
    st = S.state.read(meta, DEF);
    st.kind = KIND;
    if (SB) st.cat = '';
    else if (!(meta.categories || []).includes(st.cat) || !st.key) { st.cat = DEF.cat; st.key = DEF.key; }
    browseCat = SB ? null : st.cat;
    S.state.write(st);
    if (serverParts().length < 2) el.mode.style.display = 'none';   // one line is no comparison
    S.ui.controls(el.controls, meta, st, () => load(), { range: true });
    S.ui.autocomplete(el.q, { limit: 10, onPick });
    load();
  }

  start();
})();
