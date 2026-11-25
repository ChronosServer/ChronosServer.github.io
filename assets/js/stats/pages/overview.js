/* Stats overview (/stats/): headline tiles that switch one big history chart, a spotlight
 * card, the server pulse (clock / week heatmap) and a milestones / firsts feed.
 *
 * Requests: first paint is /meta + /totals for the selected tile. After that, in parallel:
 * the other three /totals, /keys (drops headline keys the scope doesn't have), /spotlight,
 * /activity and /milestones. /firsts loads only when its tab is opened. Responses are kept
 * per parameter set, so a tile click or switching back to a scope never asks again.
 * Every API string goes through S.fmt.esc (or textContent) before it reaches the DOM.
 * Page-only classes (stats.css): st-ov st-ov-chart st-pulse st-pulse-head st-pulse-text
 * st-dim st-one st-feed-head st-feed-ico.
 */
(function () {
  const S = window.S, F = S.fmt, esc = F.esc;
  const $ = id => document.getElementById(id);
  const PALETTE = ['var(--teal)', 'var(--cmp)', '#8fa3c9', '#c98fa8'];
  const DAY = 86400;
  // Custom stats in feed sentences: what follows the number ("passed 500 h played").
  const FEED_THING = { play_time: 'played', walk_one_cm: 'walked', mob_kills: 'mobs killed', deaths: 'deaths' };

  const el = {
    controls: $('ov-controls'), app: $('ov-app'), tiles: $('ov-tiles'), chart: $('ov-chart'), note: $('ov-note'),
    spot: $('ov-spot'), pulse: $('ov-pulse'), pulseMode: $('ov-pulse-mode'), pulseBody: $('ov-pulse-body'),
    tabs: $('ov-tabs'), feed: $('ov-feed'),
  };

  let meta = null, st = null, info = null, gen = 0, chart = null, tabs = null;
  let tab = 'milestones', pulseMode = 'clock', pulseData = null;
  let shown = F.HEADLINES.slice();   // headline rows present in the scope
  const memo = new Map();
  const tileData = new Map();         // itemId -> /totals response for the current load

  // One request per distinct parameter set; failures are forgotten so a retry can ask again.
  function get(path, params) {
    const k = path + '?' + JSON.stringify(params);
    if (!memo.has(k)) {
      const p = S.api(path, params);
      memo.set(k, p);
      p.catch(() => memo.delete(k));
    }
    return memo.get(k);
  }

  // custom stats and the entity categories (killed, killed_by) have no item art
  const hasIcon = cat => !['custom', 'killed', 'killed_by'].includes(F.itemId(cat));
  const idOf = h => F.itemId(h[1]);
  const selected = () => shown.find(h => idOf(h) === st.stat) || shown[0];
  const bots = () => (info.hasSmp && st.bots ? 'true' : null);
  const serverLabel = k => { const s = (meta.servers || []).find(x => x.key === k); return s ? s.label : String(k).toUpperCase(); };
  const partLabel = k => (k === 'all' ? 'All' : serverLabel(k));
  const scopeServers = () => info.servers || (meta.servers || []).map(s => s.key);
  const isDelta = () => !!((st.range && st.range !== 'all') || (!st.range && st.from != null));
  const playerHref = uuid => '/stats/player/?p=' + encodeURIComponent(uuid);

  function partColor(part) {
    const all = S.scopeInfo(meta, 'all').parts;
    let i = all.indexOf(part);
    const groups = meta.scope_groups;
    if (i < 0 && groups) {
      const g = Object.keys(groups).find(n => groups[n].includes(part));
      if (g) i = all.indexOf(g);
    }
    return PALETTE[i] || PALETTE[0];
  }

  function totals(h) {
    return get('totals', Object.assign({
      kind: 'stat', category: h[0], key: h[1], scopes: info.parts.join(','), include_bots: bots(),
    }, S.rangeParams(st)));
  }

  // ---- tiles
  function parts(res) {
    const series = (res && res.series) || {};
    return info.parts.map(p => {
      const pts = S.cm.trimLeading((series[p] || []).filter(x => x && isFinite(x[1])));
      return { part: p, last: pts.length ? pts[pts.length - 1][1] : 0, first: pts.length ? pts[0][1] : 0, n: pts.length };
    });
  }

  function valueHtml(h, raw) {
    const d = F.display(h[0], h[1], raw);
    const i = d.text.lastIndexOf(' ');
    const num = i > 0 ? d.text.slice(0, i) : d.text, unit = i > 0 ? d.text.slice(i + 1) : '';
    return '<span title="' + esc(d.exact) + '">' + esc(num) + '</span>' + (unit ? '<small>' + esc(unit) + '</small>' : '');
  }

  function tileInner(h) {
    const label = '<div class="st-lab">' + esc(h[2]) + '</div>';
    const res = tileData.get(idOf(h));
    if (res === undefined) return label + '<div class="st-v">–</div><div class="st-rk">&nbsp;</div>';
    if (res === null) return label + '<div class="st-v">–</div><div class="st-rk">Couldn\'t load</div>';
    const ps = parts(res), total = ps.reduce((a, p) => a + p.last, 0);
    let out = label + '<div class="st-v">' + valueHtml(h, total) + '</div>';
    const split = ps.length > 1;
    if (split) {
      out += '<div class="st-split" aria-hidden="true">' + ps.map(p =>
        '<i style="width:' + (total > 0 ? (p.last / total * 100).toFixed(2) : 0) + '%;background:' + partColor(p.part) + '"></i>').join('') + '</div>' +
        '<div class="st-legend">' + ps.map(p => '<span>' + esc(partLabel(p.part)) + ' ' + esc(F.display(h[0], h[1], p.last).text) + '</span>').join('') + '</div>';
    }
    if (isDelta()) {
      const gain = ps.reduce((a, p) => a + Math.max(0, p.last - p.first), 0);
      out += '<div class="st-rk"><b>+' + esc(F.display(h[0], h[1], gain).text) + '</b> since ' + esc(F.date(res.effective_from)) + '</div>';
    } else if (!split) {
      out += '<div class="st-rk">All time</div>';
    }
    return out;
  }

  function paintTiles() {
    const cur = selected();
    el.tiles.innerHTML = shown.map(h => {
      const on = cur && idOf(h) === idOf(cur);
      return '<button type="button" class="st-tile' + (on ? ' on' : '') + '" data-id="' + esc(idOf(h)) +
        '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-controls="ov-chart">' + tileInner(h) + '</button>';
    }).join('');
  }

  function paintTile(h) {
    const b = el.tiles.querySelector('[data-id="' + idOf(h) + '"]');
    if (b) b.innerHTML = tileInner(h);
  }

  // ---- chart
  function liveAt() {
    const live = meta.live_started_at;
    if (!live) return null;
    const ts = scopeServers().map(s => live[s]).filter(t => isFinite(t));
    return ts.length ? Math.min.apply(null, ts) : null;
  }

  function requestedStart(res) {
    if (st.range && st.range !== 'all') return res.to - ((meta.settings.range_presets || {})[st.range] || 0);
    if (!st.range && st.from != null) return st.from;
    return null;
  }

  function paintNote(res) {
    if (!res) { el.note.innerHTML = ''; return; }
    const keys = info.parts.map(p => '<span class="st-k" style="background:' + partColor(p) + '"></span>' + esc(partLabel(p))).join(' &nbsp; ');
    const bits = [keys];
    const starts = scopeServers().map(s => (meta.tracking_started_at || {})[s]).filter(t => isFinite(t));
    const began = starts.length ? Math.min.apply(null, starts) : null;
    const want = requestedStart(res);
    if (want == null || res.effective_from > want + 60) {
      bits.push(began != null && res.effective_from <= began
        ? 'Since tracking began (' + esc(F.date(res.effective_from)) + ')'
        : 'Since ' + esc(F.date(res.effective_from)));
    }
    const la = liveAt();
    if (la != null && res.effective_from < la && la < res.to) {
      bits.push('<em>Shaded: backup imports, a few points far apart.</em> Live 15-minute history since ' +
        esc(F.date(la)) + ' gets its own stretch of the axis.');
    }
    el.note.innerHTML = bits.join(' &nbsp;·&nbsp; ');
  }

  function chartOpts(h, res) {
    const series = info.parts.map(p => ({
      id: p, label: partLabel(p), color: partColor(p), points: ((res && res.series) || {})[p] || [],
    }));
    return {
      series, from: res.effective_from, to: res.to, liveAt: liveAt(), height: 300,
      format: v => (v === 0 ? '0' : F.display(h[0], h[1], v).text),
      emptyText: 'No ' + h[2].toLowerCase() + ' recorded in this range yet.',
    };
  }

  function showChart(h, res) {
    const o = chartOpts(h, res);
    if (chart) chart.update(o); else { el.chart.innerHTML = ''; chart = S.chart(el.chart, o); }
    paintNote(res);
  }

  function chartMessage(html) {
    if (chart) { chart.destroy(); chart = null; }
    el.chart.innerHTML = html;
    paintNote(null);
  }

  // `pending` is the selected tile's /totals promise when the caller already holds it.
  async function drawSelected(my, pending) {
    const h = selected();
    if (!h) { chartMessage('<div class="st-chart"><div class="st-empty">None of the headline stats are tracked on this scope yet.</div></div>'); return; }
    try {
      const res = await (pending || totals(h));
      if (my !== gen || selected() !== h) return;
      showChart(h, res);
    } catch (err) {
      if (my !== gen) return;
      chartMessage('<div class="st-chart"></div>');
      S.ui.error(el.chart.firstChild, err);
    }
  }

  function selectTile(id) {
    if (id === st.stat) return;
    st.stat = id;
    S.state.write(st);
    el.tiles.querySelectorAll('.st-tile').forEach(b => {
      const on = b.dataset.id === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    drawSelected(gen);
  }

  // ---- spotlight
  function seenList() {
    try {
      const v = JSON.parse(sessionStorage.getItem('stats.seen') || '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(-10) : [];
    } catch (e) { return []; }
  }
  function pushSeen(ck) {
    const list = seenList().filter(x => x !== ck);
    list.push(ck);
    try { sessionStorage.setItem('stats.seen', JSON.stringify(list.slice(-10))); } catch (e) { /* private mode */ }
  }

  function spotDetail(sp) {
    const d = sp.detail || {}, v = n => F.display(sp.category, sp.key, n).text;
    if (sp.trigger === 'outlier' && d.median != null) return 'median ' + v(d.median) + (d.holders ? ' across ' + F.compact(d.holders) + ' players' : '');
    if (sp.trigger === 'mover' && d.delta != null) return '+' + v(d.delta) + ' this week';
    return '';
  }

  function setSpotVisible(on) {
    el.spot.hidden = !on;
    el.spot.parentNode.classList.toggle('st-one', !on);
  }

  async function loadSpot(my) {
    const btn = el.spot.querySelector('.st-again');
    if (btn) btn.disabled = true;
    let sp;
    try {
      sp = await S.api('spotlight', { scope: st.scope, seen: seenList().join(',') });
    } catch (err) {
      if (my !== gen) return;
      setSpotVisible(true);
      el.spot.innerHTML = '<div><span class="st-lab">Spotlight</span></div><div class="st-spot-err"></div>';
      S.ui.error(el.spot.lastChild, err);
      return;
    }
    if (my !== gen) return;
    if (!sp || !sp.trigger) { setSpotVisible(false); el.spot.innerHTML = ''; return; }
    if (sp.category && sp.key) pushSeen(sp.category + '|' + sp.key);
    const name = F.playerName(sp);
    const text = F.spotlight(Object.assign({}, sp, { name }), serverLabel(sp.server_key));
    if (!text) { setSpotVisible(false); return; }
    const detail = spotDetail(sp);
    setSpotVisible(true);
    el.spot.innerHTML =
      '<div><span class="st-lab">Spotlight</span><p>' + text + '</p></div>' +
      '<div class="st-who">' + S.ui.headHtml(sp.uuid, 32) +
      '<span class="st-who-t"><a href="' + esc(playerHref(sp.uuid)) + '">' + esc(name) + '</a>' +
      '<span>' + (sp.value != null ? esc(F.display(sp.category, sp.key, sp.value).text) + ' on ' : 'on ') + esc(serverLabel(sp.server_key)) +
      (detail ? ' · ' + esc(detail) : '') + '</span></span>' +
      (hasIcon(sp.category) ? S.ui.iconHtml(F.itemId(sp.key), 28) : '') +
      '<button type="button" class="st-again">Another</button></div>';
    S.ui.hydrate(el.spot);
  }

  // ---- pulse
  function activityRange() {
    const presets = (meta.settings && meta.settings.range_presets) || {};
    let best = null;
    Object.keys(presets).forEach(k => { if (presets[k] >= 30 * DAY && (!best || presets[k] > presets[best])) best = k; });
    return best || 'all';
  }

  function pulseText() {
    const d = pulseData;
    const tail = 'After a week this shows when Chronos is busiest in your timezone.';
    if (!d.buckets.length) {
      return '<div class="st-empty"><b>The pulse is still filling in</b>No activity has been recorded here yet. ' + tail + '</div>';
    }
    if (!d.bin.filled) {
      const first = Math.min.apply(null, d.buckets.map(b => b[0]));
      return '<div class="st-empty"><b>The pulse is still filling in</b>Activity has been recorded since ' + esc(F.date(first)) + '. ' + tail + '</div>';
    }
    const pad = n => String(n).padStart(2, '0'), avg = v => String(Math.round(v * 10) / 10);
    if (pulseMode === 'clock') {
      let bi = 0;
      d.bin.hours.forEach((v, i) => { if (v > d.bin.hours[bi]) bi = i; });
      return '<div class="st-empty"><b>Busiest around ' + pad(bi) + ':00 your time</b>' + avg(d.bin.hours[bi]) +
        ' players online on average then, from ' + d.bin.days + ' days of activity.</div>';
    }
    const DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
    let bd = 0, bh = 0;
    d.bin.grid.forEach((row, i) => row.forEach((v, j) => { if (v > d.bin.grid[bd][bh]) { bd = i; bh = j; } }));
    return '<div class="st-empty"><b>Busiest on ' + DAYS[bd] + ' around ' + pad(bh) + ':00</b>' + avg(d.bin.grid[bd][bh]) +
      ' players online on average then, in your local time.</div>';
  }

  function paintPulse() {
    if (!pulseData) return;
    const dim = !pulseData.bin.filled;
    if (pulseMode === 'clock') {
      el.pulseBody.className = 'st-clockpanel';
      el.pulseBody.innerHTML = '<div class="st-pulse-viz' + (dim ? ' st-dim' : '') + '"></div><div class="st-pulse-text">' + pulseText() + '</div>';
      S.viz.clock(el.pulseBody.firstChild, pulseData.bin.hours, { now: new Date() });
    } else {
      el.pulseBody.className = 'st-pulse-week';
      el.pulseBody.innerHTML = '<div class="st-heat' + (dim ? ' st-dim' : '') + '"><div></div></div><div class="st-pulse-text">' + pulseText() + '</div>';
      S.viz.heatmap(el.pulseBody.firstChild.firstChild, pulseData.bin.grid);
    }
  }

  async function loadPulse(my) {
    try {
      const res = await get('activity', { scope: st.scope, range: activityRange(), include_bots: bots() });
      if (my !== gen) return;
      const bs = res.bucket_seconds || (meta.settings && meta.settings.activity_bucket_s) || 900;
      const buckets = Array.isArray(res.buckets) ? res.buckets : [];
      const now = meta.last_run_at || Math.floor(Date.now() / 1000);
      const to = Math.floor(now / bs) * bs + bs;
      pulseData = { buckets, bin: S.act.bin(buckets, bs, to) };
      paintPulse();
    } catch (err) {
      if (my !== gen) return;
      pulseData = null;
      el.pulseBody.className = '';
      S.ui.error(el.pulseBody, err);
    }
  }

  // ---- milestones / firsts feed
  function thing(category, key) {
    const k = F.itemId(key);
    if (F.itemId(category) === 'custom') {
      return FEED_THING[k] || F.statLabel(category, key).name.toLowerCase().replace(/ one cm$/, ' distance');
    }
    const vb = F.VERB[F.itemId(category)];
    return F.statLabel(category, key).name.toLowerCase() + (vb ? ' ' + vb : '');
  }

  function whenHtml(r) {
    const w = F.when(r);
    if (w.kind === 'earliest') return '<div class="st-feed-d">before tracking</div>';
    return '<div class="st-feed-d' + (w.kind === 'by' ? ' by' : '') + '">' + esc(w.text) + '</div>';
  }

  function rowIcon(r) {
    return hasIcon(r.category) ? S.ui.iconHtml(F.itemId(r.key), 20) + ' ' : '';
  }

  function milestoneRow(r) {
    const name = '<b>' + esc(F.playerName(r)) + '</b>';
    const text = r.earliest_known
      ? name + ' already had ' + rowIcon(r) + esc(F.display(r.category, r.key, r.threshold).text) + ' ' + esc(thing(r.category, r.key))
      : name + ' passed ' + rowIcon(r) + esc(F.display(r.category, r.key, r.threshold).text) + ' ' + esc(thing(r.category, r.key));
    return '<a class="st-feed-row" href="' + esc(playerHref(r.uuid)) + '">' + S.ui.headHtml(r.uuid, 28) +
      '<div class="st-feed-t">' + text + ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></div>' + whenHtml(r) + '</a>';
  }

  function firstRow(r) {
    const name = '<b>' + esc(F.playerName(r)) + '</b>';
    const label = esc(F.statLabel(r.category, r.key).full);
    const text = r.earliest_known
      ? name + ' is the earliest known holder of ' + rowIcon(r) + label
      : name + ' was the first with ' + rowIcon(r) + label;
    return '<a class="st-feed-row" href="' + esc(playerHref(r.uuid)) + '">' + S.ui.headHtml(r.uuid, 28) +
      '<div class="st-feed-t">' + text + ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></div>' + whenHtml(r) + '</a>';
  }

  // /firsts may ignore limit/order and send every row: keep the newest 8 here. Observed
  // firsts come before "earliest known holder" rows, whose `at` is only the tracking start.
  function newestFirsts(rows) {
    if (rows.length <= 8) return rows;
    return rows.map((r, i) => [r, i])
      .sort((a, b) => ((a[0].earliest_known ? 1 : 0) - (b[0].earliest_known ? 1 : 0)) || (b[0].at - a[0].at) || (a[1] - b[1]))
      .slice(0, 8).map(x => x[0]);
  }

  async function paintFeed(my) {
    const which = tab;
    el.feed.innerHTML = '<div class="st-empty">Loading…</div>';
    try {
      let rows;
      if (which === 'milestones') {
        rows = ((await get('milestones', { scope: st.scope, limit: 8 })).rows || []);
      } else {
        rows = newestFirsts(((await get('firsts', { scope: st.scope, limit: 8, order: 'newest' })).rows || []));
      }
      if (my !== gen || which !== tab) return;
      if (!rows.length) {
        S.ui.empty(el.feed, which === 'milestones'
          ? 'No milestones on this scope yet. They appear when someone passes a round number in a stat.'
          : 'No firsts on this scope yet.');
        return;
      }
      el.feed.innerHTML = rows.map(which === 'milestones' ? milestoneRow : firstRow).join('');
      S.ui.hydrate(el.feed);
    } catch (err) {
      if (my !== gen || which !== tab) return;
      S.ui.error(el.feed, err);
    }
  }

  // ---- keys present in the scope
  async function filterTiles(my) {
    let keys;
    try { keys = await get('keys', { scope: st.scope, kind: 'stat' }); } catch (e) { return; }
    if (my !== gen) return;
    const stats = (keys && keys.stats) || {};
    const next = F.HEADLINES.filter(h => (stats[h[0]] || []).includes(h[1]));
    if (next.length === shown.length) return;
    const before = selected();
    shown = next;
    paintTiles();
    if (selected() !== before) {
      if (selected()) { st.stat = idOf(selected()); S.state.write(st); }
      drawSelected(my);
    }
  }

  // ---- one pass over the data for the current state
  async function load() {
    const my = ++gen;
    info = S.scopeInfo(meta, st.scope);
    shown = F.HEADLINES.slice();
    tileData.clear();
    paintTiles();
    if (!chart) el.chart.innerHTML = '<div class="st-chart"><div class="st-empty">Loading…</div></div>';

    // first paint: the selected tile's totals
    const first = selected();
    const pending = totals(first);
    try { tileData.set(idOf(first), await pending); } catch (e) { tileData.set(idOf(first), null); }
    if (my !== gen) return;
    paintTile(first);
    await drawSelected(my, pending);
    if (my !== gen) return;

    // then everything else in parallel
    F.HEADLINES.filter(h => h !== first).forEach(h => {
      totals(h).then(res => { if (my === gen) { tileData.set(idOf(h), res); paintTile(h); } },
        () => { if (my === gen) { tileData.set(idOf(h), null); paintTile(h); } });
    });
    filterTiles(my);
    loadSpot(my);
    loadPulse(my);
    paintFeed(my);
  }

  // ---- wiring
  el.tiles.addEventListener('click', e => {
    const b = e.target.closest('.st-tile');
    if (b) selectTile(b.dataset.id);
  });
  el.spot.addEventListener('click', e => {
    const b = e.target.closest('.st-again');
    if (b && !b.disabled) loadSpot(gen);
  });
  el.pulseMode.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.dataset.value === pulseMode) return;
    pulseMode = b.dataset.value;
    el.pulseMode.querySelectorAll('button').forEach(x => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    paintPulse();
  });

  async function start() {
    try {
      meta = await S.meta();
    } catch (err) {
      el.app.hidden = true;
      S.ui.error(el.controls, err);
      return;
    }
    st = S.state.read(meta, { stat: idOf(F.HEADLINES[0]) });
    if (!F.HEADLINES.some(h => idOf(h) === st.stat)) st.stat = idOf(F.HEADLINES[0]);
    S.state.write(st);
    S.ui.controls(el.controls, meta, st, () => load(), { range: true });
    tabs = S.ui.tabs(el.tabs, [{ id: 'milestones', label: 'Milestones' }, { id: 'firsts', label: 'Firsts' }], id => {
      tab = id;
      el.feed.setAttribute('aria-labelledby', el.tabs.querySelector('[data-id="' + id + '"]').id);
      paintFeed(gen);
    });
    el.feed.setAttribute('aria-labelledby', el.tabs.querySelector('[role=tab]').id);
    load();
  }

  start();
})();
