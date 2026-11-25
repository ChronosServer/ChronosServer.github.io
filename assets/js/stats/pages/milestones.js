/* Milestones (/stats/milestones/): three tabs.
 *
 * Feed: /milestones, 50 rows a page, "Load more" passes `next` back as `before` until it is
 * null. Rows with earliest_known go under a quieter "Already reached before tracking began"
 * heading, without a date.
 * Firsts: /firsts?order=newest, settings.limits.feed rows a page, paged the same way. Dated
 * firsts come first, then the earliest known holders. Server / category / text filters run
 * over the rows loaded so far (the UI says so; the text filter waits 150 ms of quiet typing); "Load more" first shows more of the loaded
 * matches, then fetches the next page. If the backend ignores order=newest (no `next` in the
 * answer), whatever came back is sorted newest first here and capped, with no further pages.
 * Rivalries: /rivalries?limit=50, gap now vs 7 days ago as two bars, "overtakes in N days".
 *
 * Requests: first paint is /meta + the open tab's first page; other tabs load when opened.
 * Responses are kept per parameter set; each tab's rows are kept until the scope changes.
 * `gen` drops answers for an old scope. A failed "Load more" keeps the rows already shown.
 * URL state: scope, tab. The endpoints take no include_bots, so the bots toggle is hidden.
 * Every API string goes through S.fmt.esc before it reaches the DOM.
 * Page-only classes (stats.css): st-ms st-ms-box st-ms-panel st-ms-quiet st-ms-early st-ms-foot
 * st-ms-err st-ms-tbl st-ms-filt st-ms-note st-ms-pl st-ms-on st-ms-ek st-ms-by st-ms-retry st-rv st-rv-who
 * st-rv-vs st-rv-stat st-rv-bars st-rv-bar st-rv-was st-rv-l st-rv-track st-rv-v st-rv-eta.
 */
(function () {
  const S = window.S, F = S.fmt, esc = F.esc;
  const $ = id => document.getElementById(id);
  const TABS = ['feed', 'firsts', 'rivals'];
  const FEED_PAGE = 50;       // /milestones rows per request
  const RIVALS = 50;          // /rivalries rows
  const STEP = 50;            // firsts table rows revealed per "Load more"
  const FALLBACK_CAP = 1000;  // firsts kept when the backend ignores order=newest
  const FEED_THING = { play_time: 'played', walk_one_cm: 'walked', mob_kills: 'mobs killed', deaths: 'deaths' };

  const el = { controls: $('ms-controls'), app: $('ms-app'), tabs: $('ms-tabs'), panel: $('ms-panel') };

  let meta = null, st = null, info = null, gen = 0, tabs = null, cur = 'feed';
  let feed = null, firsts = null, rivals = null;
  let fSrv = '', fCat = '', fText = '', fShown = STEP, fTimer = 0;
  const get = S.memo();
  const TEXT_WAIT = 150;      // ms of typing quiet before the firsts text filter repaints

  // ---- small helpers
  const fmtCount = n => Number(n || 0).toLocaleString('en-GB');
  const feedLimit = () => ((meta.settings && meta.settings.limits) || {}).feed || 200;
  const hasIcon = cat => !['custom', 'killed', 'killed_by', 'scoreboard'].includes(F.itemId(cat));
  const serverLabel = k => { const s = (meta.servers || []).find(x => x.key === k); return s ? s.label : String(k).toUpperCase(); };
  const scopeServers = () => info.servers || (meta.servers || []).map(s => s.key);
  const scopeText = () => (st.scope === 'all' ? 'on any server' : 'on ' + serverLabel(st.scope));
  const playerHref = r => S.kit.playerHref(st, r.name, r.uuid);
  const catLabel = c => (c === 'scoreboard' ? 'Scoreboards' : F.itemId(c) === 'custom' ? 'General' : F.statLabel(c, 'x').cat);
  const plural = (n, w) => fmtCount(n) + ' ' + w + (n === 1 ? '' : 's');

  function iconHtml(cat, key, size) {
    const l = F.statLabel(cat, key);
    return S.ui.iconHtml(hasIcon(cat) ? F.itemId(key) : '', size, String(l.name).charAt(0));
  }
  function statHtml(cat, key) {
    if (cat === 'scoreboard') return '<span>Scoreboard · </span>' + esc(key);
    const l = F.statLabel(cat, key);
    return (l.cat ? '<span>' + esc(l.cat) + ' · </span>' : '') + esc(l.name);
  }
  // "stone mined", "walked", "mobs killed"
  function thing(cat, key) {
    if (F.itemId(cat) === 'custom') {
      return FEED_THING[F.itemId(key)] || F.statLabel(cat, key).name.toLowerCase().replace(/ one cm$/, ' distance');
    }
    const vb = F.VERB[F.itemId(cat)];
    return F.statLabel(cat, key).name.toLowerCase() + (vb ? ' ' + vb : '');
  }
  function whenHtml(r) {
    const w = F.when(r);
    if (w.kind === 'earliest') return '<div class="st-feed-d">before tracking</div>';
    return '<div class="st-feed-d' + (w.kind === 'by' ? ' by" title="Happened between two backups; known only by this date' : '') + '">' + esc(w.text) + '</div>';
  }

  // ---- paged lists (feed, firsts)
  function pager(path, extra) {
    return { path, extra, rows: [], next: null, err: null, moreErr: null, busy: false, started: false, done: false, fallback: false };
  }
  const tabOf = P => (P.path === 'milestones' ? 'feed' : 'firsts');
  const baseParams = P => Object.assign({ scope: st.scope, limit: P.path === 'milestones' ? FEED_PAGE : feedLimit() }, P.extra);

  // Dated firsts newest first, then earliest known holders (their `at` is only the tracking start).
  function newestFirst(rows) {
    return rows.map((r, i) => [r, i])
      .sort((a, b) => ((a[0].earliest_known ? 1 : 0) - (b[0].earliest_known ? 1 : 0)) || (b[0].at - a[0].at) || (a[1] - b[1]))
      .map(x => x[0]);
  }

  function accept(P, res, more) {
    const rows = (res && Array.isArray(res.rows)) ? res.rows : [];
    if (P.path === 'firsts' && !more && !(res && Object.prototype.hasOwnProperty.call(res, 'next'))) {
      // the backend didn't page: it sent the oldest-first list
      P.fallback = true;
      P.rows = newestFirst(rows).slice(0, FALLBACK_CAP);
      P.next = null;
      return;
    }
    P.rows = more ? P.rows.concat(rows) : rows;
    P.next = res && res.next != null ? res.next : null;
  }

  async function loadFirst(P, paint) {
    if (P.started) { paint(); return; }
    P.started = true; P.busy = true; P.err = null;
    const my = gen;
    paint();
    let res;
    try {
      res = await get(P.path, baseParams(P));
    } catch (err) {
      if (my !== gen) return;
      P.busy = false; P.started = false; P.err = err;
      paint();
      return;
    }
    if (my !== gen) return;
    accept(P, res, false);
    P.busy = false; P.done = true;
    paint();
  }

  // Fetch the next page. Resolves true when rows were added; a failure keeps the rows.
  async function fetchMore(P, paint) {
    if (P.busy || P.next == null) return false;
    P.busy = true;
    const my = gen;
    let res;
    try {
      res = await get(P.path, Object.assign(baseParams(P), { before: P.next }));
    } catch (err) {
      if (my !== gen) return false;
      P.busy = false; P.moreErr = err;
      paint();
      if (cur === tabOf(P)) focusIn('.st-ms-foot .st-more');
      return false;
    }
    if (my !== gen) return false;
    P.busy = false; P.moreErr = null;
    accept(P, res, true);
    return true;
  }

  function focusIn(sel) {
    const n = el.panel.querySelector(sel);
    if (n) n.focus();
  }

  function busyButton() {
    const b = el.panel.querySelector('.st-ms-foot .st-more');
    if (b) { b.setAttribute('aria-disabled', 'true'); b.textContent = 'Loading…'; }  // stays focusable
  }

  function footHtml(P, text) {
    return '<div class="st-table-foot st-ms-foot"><span class="st-table-count">' + esc(text) + '</span>' +
      (P.moreErr ? '<span class="st-ms-err" role="alert">' + esc(S.errorText(P.moreErr)) + '</span>' : '') +
      (P.more ? '<button type="button" class="st-more"' + (P.busy ? ' aria-disabled="true">Loading…' : '>' + (P.moreErr ? 'Try again' : 'Load more')) + '</button>' : '') + '</div>';
  }

  function loadErr(P) {
    el.panel.innerHTML = '<div></div><div class="st-ms-retry"><button type="button" class="st-more" data-retry>Try again</button></div>';
    S.ui.error(el.panel.firstChild, P.err);
  }

  // ---- Feed
  function milestoneRow(r, i) {
    const name = '<b>' + esc(F.playerName(r)) + '</b>';
    const icon = hasIcon(r.category) ? S.ui.iconHtml(F.itemId(r.key), 20) + ' ' : '';
    const v = esc(F.display(r.category, r.key, r.threshold).text) + ' ' + esc(thing(r.category, r.key));
    return '<a class="st-feed-row" data-i="' + i + '" href="' + esc(playerHref(r)) + '">' + S.ui.headHtml(r.uuid, 28) +
      '<div class="st-feed-t">' + name + (r.earliest_known ? ' already had ' : ' passed ') + icon + v +
      ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></div>' + whenHtml(r) + '</a>';
  }

  function paintFeed() {
    if (cur !== 'feed') return;
    const P = feed;
    if (P.err) { loadErr(P); return; }
    if (!P.done) { el.panel.innerHTML = '<div class="st-empty">Loading…</div>'; return; }
    if (!P.rows.length) {
      el.panel.innerHTML = '<div class="st-empty"><b>No milestones ' + esc(scopeText()) + ' yet.</b>They appear when someone passes a round number in a stat.</div>';
      return;
    }
    const dated = [], early = [];
    P.rows.forEach((r, i) => (r.earliest_known ? early : dated).push(milestoneRow(r, i)));
    P.more = P.next != null;
    el.panel.innerHTML = (dated.length ? '<div class="st-feed">' + dated.join('') + '</div>' : '') +
      (early.length ? '<h2 class="st-ms-quiet">Already reached before tracking began</h2>' +
        '<div class="st-feed st-ms-early">' + early.join('') + '</div>' : '') +
      footHtml(P, P.more ? 'Showing the latest ' + plural(P.rows.length, 'milestone') : 'All ' + plural(P.rows.length, 'milestone') + ' ' + scopeText());
    S.ui.hydrate(el.panel);
  }

  async function moreFeed() {
    const from = feed.rows.length;
    busyButton();
    if (await fetchMore(feed, paintFeed)) {
      if (cur !== 'feed') return;   // the reader moved to another tab meanwhile: no focus jump
      paintFeed();
      focusIn('[data-i="' + from + '"]');
      if (!el.panel.querySelector('[data-i="' + from + '"]')) focusIn('.st-ms-foot .st-more');
    }
  }

  // ---- Firsts
  function firstHits() {
    const q = fText.trim().toLowerCase(), qid = q.replace(/ /g, '_');
    return firsts.rows.filter(r => (!fSrv || r.server_key === fSrv) && (!fCat || r.category === fCat) &&
      (!q || F.playerName(r).toLowerCase().includes(q) || F.statLabel(r.category, r.key).full.toLowerCase().includes(q) ||
        F.itemId(r.key).toLowerCase().includes(qid)));
  }
  const filtering = () => !!(fSrv || fCat || fText.trim());

  function firstsShell() {
    const servers = scopeServers();
    if (fSrv && !servers.includes(fSrv)) fSrv = '';
    const cats = (meta.categories || []).concat(['scoreboard']);
    if (fCat && !cats.includes(fCat)) fCat = '';
    const opt = (v, t, on) => '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(t) + '</option>';
    el.panel.innerHTML = '<div class="st-filt st-ms-filt">' +
      '<input class="st-sel" id="ms-q" type="search" placeholder="Filter by player or stat" aria-label="Filter firsts by player or stat">' +
      (servers.length > 1 ? '<label class="st-select"><select id="ms-srv" aria-label="Server">' + opt('', 'All servers', !fSrv) +
        servers.map(k => opt(k, serverLabel(k), fSrv === k)).join('') + '</select></label>' : '') +
      '<label class="st-select"><select id="ms-cat" aria-label="Category">' + opt('', 'All categories', !fCat) +
        cats.map(c => opt(c, catLabel(c), fCat === c)).join('') + '</select></label>' +
      '</div><p class="st-ms-note" id="ms-note" aria-live="polite"></p><div id="ms-res"></div>';
    $('ms-q').value = fText;
    $('ms-q').addEventListener('input', () => {
      clearTimeout(fTimer);
      fTimer = setTimeout(() => { fText = $('ms-q') ? $('ms-q').value : fText; fShown = STEP; paintFirstRows(); }, TEXT_WAIT);
    });
    ['ms-srv', 'ms-cat'].forEach(id => {
      const s = $(id);
      if (!s) return;
      s.classList.toggle('on', !!s.value);
      s.addEventListener('change', () => {
        if (id === 'ms-srv') fSrv = s.value; else fCat = s.value;
        s.classList.toggle('on', !!s.value);
        fShown = STEP;
        paintFirstRows();
      });
    });
  }

  function firstWhen(r) {
    const w = F.when(r);
    if (w.kind === 'earliest') return '<span class="st-ms-ek">Earliest known holder</span>';
    return '<span' + (w.kind === 'by' ? ' class="st-ms-by" title="Happened between two backups; known only by this date"' : '') + '>' + esc(w.text) + '</span>';
  }

  function paintFirstRows(focusFrom) {
    const box = $('ms-res'), note = $('ms-note');
    if (!box) return;
    const P = firsts;
    const hits = firstHits();
    const n = Math.min(fShown, hits.length);
    const all = P.next == null;
    P.more = n < hits.length || !all;
    // what the filters cover
    let nt = '';
    if (P.fallback) nt = 'Showing the newest ' + fmtCount(P.rows.length) + ' firsts. The stats server sent the full list, so there is nothing more to load here.';
    else if (filtering()) {
      nt = all ? 'Filtering all ' + plural(P.rows.length, 'first') + ' ' + scopeText() + '.'
        : 'Filtering ' + fmtCount(P.rows.length) + ' loaded firsts. Load more to search further.';
    }
    note.textContent = nt;
    note.hidden = !nt;
    if (!P.rows.length) {
      box.innerHTML = '<div class="st-empty"><b>No firsts ' + esc(scopeText()) + ' yet.</b>A first is recorded when someone is the first on a server to get a stat.</div>';
      return;
    }
    const foot = hits.length
      ? 'Showing ' + fmtCount(n) + ' of ' + fmtCount(hits.length) + (filtering() ? ' matching' : '') + (all ? '' : ' loaded') + (hits.length === 1 ? ' first' : ' firsts')
      : 'No matches in ' + (all ? 'all ' : 'the ') + fmtCount(P.rows.length) + (all ? '' : ' loaded') + ' firsts';
    box.innerHTML = '<div id="ms-tbl" class="st-ms-tbl"></div>' + footHtml(P, foot);
    const tbl = $('ms-tbl');
    if (!hits.length) {
      S.ui.empty(tbl, 'None of the ' + (all ? '' : 'loaded ') + 'firsts match ' + (fText.trim() ? '"' + fText.trim() + '"' : 'these filters') +
        (all ? '.' : '. Load more to search further.'));
    } else {
      S.ui.table(tbl, {
        columns: [
          { id: 'player', label: 'Player' },
          { id: 'stat', label: 'First with' },
          { id: 'at', label: 'When', num: true },
        ],
        rows: hits.slice(0, n),
        pageSize: n || 1,
        rowHtml: r => '<td><a class="st-ms-pl" href="' + esc(playerHref(r)) + '">' + S.ui.headHtml(r.uuid, 24) + '<span>' + esc(F.playerName(r)) + '</span></a></td>' +
          '<td>' + iconHtml(r.category, r.key, 20) + statHtml(r.category, r.key) + ' <span class="st-ms-on">on ' + esc(serverLabel(r.server_key)) + '</span></td>' +
          '<td class="st-num">' + firstWhen(r) + '</td>',
      });
    }
    if (focusFrom != null) {
      const a = box.querySelectorAll('tbody tr')[focusFrom];
      if (a && a.querySelector('a')) a.querySelector('a').focus();
      else focusIn('.st-ms-foot .st-more');
    }
  }

  function paintFirsts() {
    if (cur !== 'firsts') return;
    const P = firsts;
    if (P.err) { loadErr(P); return; }
    if (!P.done) { el.panel.innerHTML = '<div class="st-empty">Loading…</div>'; return; }
    if (!$('ms-res')) firstsShell();
    paintFirstRows();
  }

  async function moreFirsts() {
    const from = Math.min(fShown, firstHits().length);
    if (from < firstHits().length) {
      fShown += STEP;
      paintFirstRows(from);
      return;
    }
    busyButton();
    if (await fetchMore(firsts, paintFirsts)) {
      fShown = from + STEP;
      if (cur === 'firsts') paintFirstRows(from);
    }
  }

  // ---- Rivalries
  function rivalRow(r) {
    const a = r.a || {}, b = r.b || {};
    const who = p => '<a class="st-ms-pl" href="' + esc(playerHref(p)) + '">' + S.ui.headHtml(p.uuid, 24) + '<b>' + esc(F.playerName(p)) + '</b></a>';
    const gap = Math.abs(Number(r.gap) || 0);
    const was = r.gap_7d_ago == null ? null : Math.abs(Number(r.gap_7d_ago) || 0);
    const max = Math.max(gap, was || 0) || 1;
    const bar = (label, v, cls) => '<div class="st-rv-bar' + (cls ? ' ' + cls : '') + '"><span class="st-rv-l">' + label + '</span>' +
      '<span class="st-rv-track" aria-hidden="true"><i style="width:' + (v == null ? 0 : Math.max(1.5, v / max * 100)).toFixed(1) + '%"></i></span>' +
      '<span class="st-rv-v"' + (v == null ? '' : ' title="' + esc(F.display(r.category, r.key, v).exact) + '"') + '>' +
      (v == null ? 'no data' : esc(F.display(r.category, r.key, v).text)) + '</span></div>';
    let eta;
    if (r.overtake_days != null && isFinite(r.overtake_days)) {
      const d = Math.max(0.1, Number(r.overtake_days));
      eta = '<div class="st-rv-eta on">' + esc(F.playerName(b)) + ' overtakes in ' + esc(d.toFixed(1)) + (d.toFixed(1) === '1.0' ? ' day' : ' days') + '</div>';
    } else {
      eta = '<div class="st-rv-eta">' + (Number(r.closing_per_day) < 0 ? 'Gap widening' : 'Not closing in') + '</div>';
    }
    return '<div class="st-rv">' +
      '<div class="st-rv-who">' + who(a) + ' <span class="st-rv-vs">ahead of</span> ' + who(b) +
      '<div class="st-rv-stat">' + iconHtml(r.category, r.key, 20) + statHtml(r.category, r.key) + ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></div></div>' +
      '<div class="st-rv-bars" role="img" aria-label="' + esc('Gap now ' + F.display(r.category, r.key, gap).text +
        (was == null ? '' : ', 7 days ago ' + F.display(r.category, r.key, was).text)) + '">' +
      bar('Gap now', gap, '') + bar('7 days ago', was, 'st-rv-was') + '</div>' + eta + '</div>';
  }

  const liveSince = () => S.liveAt(meta, st.scope);

  function paintRivals() {
    if (cur !== 'rivals') return;
    const R = rivals;
    if (R.err) { loadErr(R); return; }
    if (!R.done) { el.panel.innerHTML = '<div class="st-empty">Loading…</div>'; return; }
    if (!R.rows.length) {
      const since = liveSince();
      el.panel.innerHTML = '<div class="st-empty st-ms-none"><b>No rivals yet.</b>Rivals appear when another player is close behind in a stat and closing in.' +
        (since ? ' Live tracking' + (st.scope === 'all' ? '' : ' ' + esc(scopeText())) + ' started on ' + esc(F.date(since)) + '.' : '') + '</div>';
      return;
    }
    el.panel.innerHTML = '<div class="st-rvs">' + R.rows.map(rivalRow).join('') + '</div>';
    S.ui.hydrate(el.panel);
  }

  async function loadRivals() {
    const R = rivals;
    if (R.started) { paintRivals(); return; }
    R.started = true; R.err = null;
    const my = gen;
    paintRivals();
    let res;
    try {
      res = await get('rivalries', { scope: st.scope, limit: Math.min(RIVALS, feedLimit()) });
    } catch (err) {
      if (my !== gen) return;
      R.started = false; R.err = err;
      paintRivals();
      return;
    }
    if (my !== gen) return;
    R.rows = (res && Array.isArray(res.rows)) ? res.rows : [];
    R.done = true;
    paintRivals();
  }

  // ---- tabs
  function showTab(id) {
    clearTimeout(fTimer);   // a filter typed on the old tab must not repaint this one
    cur = id;
    st.tab = id;
    S.state.write(st);
    const t = el.tabs.querySelector('[data-id="' + id + '"]');
    if (t) el.panel.setAttribute('aria-labelledby', t.id);
    el.panel.innerHTML = '';
    if (id === 'feed') loadFirst(feed, paintFeed);
    else if (id === 'firsts') loadFirst(firsts, paintFirsts);
    else loadRivals();
  }

  function load() {
    gen++;
    info = S.scopeInfo(meta, st.scope);
    st.bots = false;
    feed = pager('milestones', {});
    firsts = pager('firsts', { order: 'newest' });
    rivals = { rows: [], err: null, started: false, done: false };
    fShown = STEP;
    showTab(cur);
  }

  // ---- wiring
  el.panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    if (b.hasAttribute('data-retry')) {
      if (cur === 'rivals') loadRivals();
      else if (cur === 'feed') loadFirst(feed, paintFeed);
      else loadFirst(firsts, paintFirsts);
      return;
    }
    if (b.closest('.st-ms-foot') && b.classList.contains('st-more')) {
      if (cur === 'feed') moreFeed(); else if (cur === 'firsts') moreFirsts();
    }
  });

  async function start() {
    try {
      meta = await S.meta();
    } catch (err) {
      el.app.hidden = true;
      S.ui.error(el.controls, err);
      return;
    }
    st = S.state.read(meta, { tab: 'feed' });
    if (!TABS.includes(st.tab)) st.tab = 'feed';
    st.bots = false;
    cur = st.tab;
    S.state.write(st);
    S.ui.controls(el.controls, meta, st, () => load());
    tabs = S.ui.tabs(el.tabs, [
      { id: 'feed', label: 'Feed' },
      { id: 'firsts', label: 'Firsts' },
      { id: 'rivals', label: 'Rivalries' },
    ], showTab);
    el.tabs.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-controls', 'ms-panel'));
    tabs.select(cur, true);
    load();
  }

  start();
})();
