/* Compare (/stats/compare/?players=a,b&keys=<category>|<key>,scoreboard|<objective>).
 *
 * Two pickers (player chips, stat chips; add via search, remove with ×; limits from
 * /meta.settings.compare), the shared controls bar with a range, then a chart of the
 * selected stat (one line per player) above a table: rows = stats, columns = players, each
 * cell a value and a bar against the row's largest size, the row leader (highest value, when
 * the row's values are not all equal) in teal. Rows of a kind the scope doesn't track
 * (track_stats / track_scoreboards off on all its servers) say so instead of values. Clicking a row (or
 * Enter/Space on it) graphs that stat; arrows move between rows.
 *
 * Requests: first paint is /meta + /compare. /compare returns every key's series, so picking
 * a row costs nothing. Bot check: when the scope includes SMP, a player /compare reports
 * with is_bot (fake player or SMP team rule) turns the bot toggle on (once per bot, so the viewer can turn it off
 * again); no separate /player request. After a 404, /player
 * on each player typed into the URL finds the unknown name. Responses are kept per
 * parameter set; `gen` drops stale compares.
 * URL state: players (names, or uuids for unnamed players), keys, stat (graphed row), plus
 * scope/bots/range/from/to. Every API string goes through S.fmt.esc before the DOM.
 * Page-only classes (stats.css): st-cmp st-cmp-pick st-cmp-box st-cmp-bh st-cmp-n st-cmp-chips
 * st-cmp-chip (.bad) st-cmp-x st-cmp-tag st-cmp-add st-cmp-boxnote st-cmp-quick st-cmp-qbtn
 * st-cmp-min st-cmp-busy st-cmp-graph st-cmp-gh st-cmp-board st-cmp-table st-cmp-ph
 * st-cmp-stat st-cmp-lead st-cmp-v st-cmp-bar st-cmp-off; line colours --st-c3..--st-c6.
 */
(function () {
  const S = window.S, F = S.fmt, esc = F.esc;
  const $ = id => document.getElementById(id);
  const LINES = ['var(--teal)', 'var(--cmp)', 'var(--st-c3)', 'var(--st-c4)', 'var(--st-c5)', 'var(--st-c6)'];

  const el = {
    players: $('cmp-players'), keys: $('cmp-keys'), pq: $('cmp-pq'), kq: $('cmp-kq'),
    pn: $('cmp-pn'), kn: $('cmp-kn'), pnote: $('cmp-pnote'), knote: $('cmp-knote'), quick: $('cmp-quick'),
    controls: $('cmp-controls'), msg: $('cmp-msg'), app: $('cmp-app'), graph: $('cmp-graph'),
    ccat: $('cmp-ccat'), ctitle: $('cmp-ctitle'), chart: $('cmp-chart'), note: $('cmp-note'),
    hint: $('cmp-hint'), table: $('cmp-table'),
  };

  let meta = null, st = null, info = null, gen = 0, chart = null;
  let players = [];     // {tok, uuid, name, bot: true|false|null, unknown}
  let keys = [];        // {id, kind, cat, key}
  let res = null, resErr = null, unknownMsg = '';
  const botAuto = new Set();   // bots that already switched the toggle on once
  const get = S.memo();

  // ---- small helpers
  const cfg = () => Object.assign({ min_players: 2, max_players: 6, max_keys: 20 }, (meta.settings && meta.settings.compare) || {});
  const maxPlayers = () => Math.min(LINES.length, cfg().max_players);
  const fmtCount = n => Number(n || 0).toLocaleString('en-GB');
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const bots = () => (info && st && info.hasBots && st.bots ? 'true' : null);
  const hasIcon = cat => !['custom', 'killed', 'killed_by', 'scoreboard'].includes(F.itemId(cat));
  const pName = p => (p.name || p.uuid ? F.playerName({ name: p.name, uuid: p.uuid || p.tok }) : p.tok);
  const norm = s => String(s || '').toLowerCase().replace(/-/g, '');
  const scopeServers = () => info.servers || (meta.servers || []).map(s => s.key);
  const playerHref = p => S.kit.playerHref(st, p.name, p.uuid, p.tok);
  const andList = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const ready = () => players.length >= cfg().min_players && keys.length >= 1;

  function parseKey(id) {
    const s = String(id || '').trim(), i = s.indexOf('|');
    if (i <= 0 || i === s.length - 1) return null;
    const a = s.slice(0, i), b = s.slice(i + 1);
    if (a === 'scoreboard') return { id: s, kind: 'scoreboard', cat: 'scoreboard', key: b };
    if (!(meta.categories || []).includes(a)) return null;
    return { id: s, kind: 'stat', cat: a, key: b };
  }
  function keyLabel(k) {
    if (k.kind === 'scoreboard') return { cat: 'Objective', name: k.key, full: k.key };
    const l = F.statLabel(k.cat, k.key);
    return { cat: l.cat || 'General', name: l.name, full: l.full };
  }
  function keyHtml(k) {
    const l = keyLabel(k);
    return (k.kind === 'scoreboard' || F.itemId(k.cat) === 'custom' ? '' : '<span>' + esc(l.cat) + ' · </span>') + esc(l.name);
  }
  function artHtml(k, size) {
    const l = keyLabel(k);
    return S.ui.iconHtml(hasIcon(k.cat) ? F.itemId(k.key) : '', size, l.name.charAt(0));
  }
  const disp = (k, v) => F.display(k.kind === 'scoreboard' ? 'scoreboard' : k.cat, k.key, v);
  const selKey = () => keys.find(k => k.id === st.stat) || keys[0] || null;

  function writeState() {
    st.players = players.map(p => p.name || p.uuid || p.tok).join(',');
    st.keys = keys.map(k => k.id).join(',');
    const s = selKey();
    st.stat = s && keys.length > 1 && s !== keys[0] ? s.id : '';
    S.state.write(st);
  }

  // ---- wording for ranges (same rules as the Explorer)
  const rangeText = () => S.kit.rangeText(st);
  const sinceText = r => S.kit.sinceText(meta, st, r, scopeServers(), 'all');
  const isDelta = () => !!st.range || st.from != null;
  const offText = k => S.kit.untracked(meta, st.scope, k.kind);

  // ---- chips
  // `focus`: {list: 'players'|'keys', i} puts focus on that chip's × (or the input when gone)
  function paintChips(focus) {
    // a repaint replaces the buttons: keep keyboard focus where it was
    const a = document.activeElement;
    if (!focus && a && a.classList && a.classList.contains('st-cmp-x')) focus = { list: a.dataset.list, i: +a.dataset.i };
    const qid = !focus && a && a.classList && a.classList.contains('st-cmp-qbtn') ? a.dataset.id : null;
    const max = maxPlayers(), maxK = cfg().max_keys;
    el.players.innerHTML = players.map((p, i) =>
      '<li class="st-cmp-chip' + (p.unknown ? ' bad' : '') + '"' + (p.unknown ? ' title="No player by that name"' : '') + '>' +
      '<span class="st-k" style="background:' + LINES[i] + '" aria-hidden="true"></span>' +
      (p.uuid ? S.ui.headHtml(p.uuid, 20) : S.ui.iconHtml('', 20, '?')) +
      '<span class="st-cmp-cn">' + esc(pName(p)) + '</span>' +
      (p.bot && info.hasBots ? '<span class="st-cmp-tag">Bot</span>' : '') +
      (p.unknown ? '<span class="st-cmp-tag">Not found</span>' : '') +
      '<button type="button" class="st-cmp-x" data-list="players" data-i="' + i + '" aria-label="Remove ' + esc(pName(p)) + '">×</button></li>').join('');
    el.keys.innerHTML = keys.map((k, i) =>
      '<li class="st-cmp-chip">' + artHtml(k, 20) + '<span class="st-cmp-cn">' + keyHtml(k) + '</span>' +
      '<button type="button" class="st-cmp-x" data-list="keys" data-i="' + i + '" aria-label="Remove ' + esc(keyLabel(k).full) + '">×</button></li>').join('');
    S.ui.hydrate(el.players); S.ui.hydrate(el.keys);
    el.pn.textContent = players.length + ' of ' + max;
    el.kn.textContent = keys.length + ' of ' + maxK;
    el.pq.placeholder = players.length >= max ? max + ' players is the most. Remove one to add another' : 'Add a player';
    el.kq.placeholder = keys.length >= maxK ? maxK + ' stats is the most. Remove one to add another' : 'Add a stat or objective';
    paintQuick();
    if (qid) {
      const q = Array.from(el.quick.querySelectorAll('.st-cmp-qbtn')).find(x => x.dataset.id === qid) || el.quick.querySelector('.st-cmp-qbtn');
      (q || el.kq).focus();
    }
    if (focus) {
      const list = focus.list === 'players' ? el.players : el.keys;
      const xs = list.querySelectorAll('.st-cmp-x');
      const b = xs[Math.min(focus.i, xs.length - 1)];
      if (b) b.focus(); else (focus.list === 'players' ? el.pq : el.kq).focus();
    }
  }

  // Quick add: the four headline stats (the only curated list on the site) not yet added.
  function paintQuick() {
    const left = keys.length >= cfg().max_keys ? [] :
      F.HEADLINES.filter(h => !keys.some(k => k.id === h[0] + '|' + h[1]));
    if (!left.length) { el.quick.innerHTML = ''; return; }
    el.quick.innerHTML = '<span class="st-lab">Quick add</span>' + left.map(h =>
      '<button type="button" class="st-cmp-qbtn" data-id="' + esc(h[0] + '|' + h[1]) + '">' + esc(h[2]) + '</button>').join('');
  }

  function boxNote(which, text) {
    (which === 'players' ? el.pnote : el.knote).textContent = text || '';
  }

  function addPlayer(it) {
    boxNote('players', '');
    if (players.some(p => (p.uuid && norm(p.uuid) === norm(it.uuid)) || (!p.uuid && norm(p.tok) === norm(it.name)))) {
      boxNote('players', F.playerName(it) + ' is already in the comparison.');
      return;
    }
    if (players.length >= maxPlayers()) {
      boxNote('players', 'You can compare up to ' + maxPlayers() + ' players. Remove one first.');
      return;
    }
    players.push({ tok: it.name || it.uuid, uuid: it.uuid, name: it.name, bot: null, unknown: false });
    paintChips();
    writeState();
    load();
  }

  function addKey(k) {
    boxNote('keys', '');
    if (!k) return;
    if (keys.some(x => x.id === k.id)) { boxNote('keys', keyLabel(k).full + ' is already in the comparison.'); return; }
    if (keys.length >= cfg().max_keys) { boxNote('keys', 'You can compare up to ' + cfg().max_keys + ' stats. Remove one first.'); return; }
    keys.push(k);
    st.stat = k.id;   // a stat just added is the one graphed
    paintChips();
    writeState();
    load();
  }

  function remove(list, i) {
    boxNote(list, '');
    if (list === 'players') {
      players.splice(i, 1);
      unknownMsg = players.some(p => p.unknown) ? unknownMsg : '';
    } else {
      const gone = keys.splice(i, 1)[0];
      if (gone && gone.id === st.stat) st.stat = '';
    }
    paintChips({ list, i });
    writeState();
    load();
  }

  // ---- message area: minimum copy, errors, bot note
  function botNote() {
    if (!info.hasBots) return '';
    const b = players.filter(p => p.bot).map(pName);
    if (!b.length) return '';
    if (st.bots) return 'Bots included because ' + andList(b) + (b.length === 1 ? ' is a bot account.' : ' are bot accounts.');
    return andList(b) + (b.length === 1 ? ' is a bot account' : ' are bot accounts') + '. Turn on Include bots to count ' + (b.length === 1 ? 'its' : 'their') + ' numbers.';
  }

  function paintMsg() {
    const parts = [];
    if (!ready()) {
      const min = cfg().min_players;
      parts.push('<div class="panel st-empty st-cmp-min">Add at least ' + esc(min) + ' players and one stat to compare them.</div>');
    } else if (unknownMsg) {
      parts.push('<div class="panel err" role="alert">' + esc(unknownMsg) + '</div>');
    } else if (resErr) {
      parts.push('<div class="panel err" role="alert">' + esc(S.errorText(resErr)) + '</div>');
    }
    const note = ready() ? botNote() : '';
    if (note) parts.push('<p class="st-note"><em>' + esc(note) + '</em></p>');
    el.msg.innerHTML = parts.join('');
  }

  // ---- table
  function paintTable(focusI) {
    const a = document.activeElement;
    if (focusI == null && a && el.table.contains(a) && a.dataset.i != null) focusI = +a.dataset.i;
    const delta = isDelta();
    const since = delta ? sinceText(res) : '';
    el.hint.textContent = (delta ? 'Gained ' + (since || rangeText()) : 'Totals') + '. Click a row or press Enter to graph it.';
    const sel = selKey();
    const vals = res.values || {};
    const head = '<tr><th scope="col" class="st-cmp-stat">Stat</th>' + players.map((p, i) =>
      '<th scope="col" class="st-num"><a class="st-cmp-ph" href="' + esc(playerHref(p)) + '">' +
      '<span class="st-k" style="background:' + LINES[i] + '" aria-hidden="true"></span>' + (p.uuid ? S.ui.headHtml(p.uuid, 20) : '') +
      '<span>' + esc(pName(p)) + '</span></a></th>').join('') + '</tr>';
    const body = keys.map((k, ri) => {
      const row = vals[k.id] || {};
      const vs = players.map(p => (p.uuid && typeof row[p.uuid] === 'number' ? row[p.uuid] : null));
      const on = sel && k.id === sel.id;
      const label = keyLabel(k).full;
      const start = '<tr data-i="' + ri + '" class="st-row-link' + (on ? ' on' : '') + '" tabindex="' + (on ? 0 : -1) + '"' +
        (on ? ' aria-current="true"' : '') + ' aria-controls="cmp-graph"><td class="st-cmp-stat">' + artHtml(k, 20) + '<span>' + keyHtml(k) + '</span></td>';
      const off = offText(k);
      if (off) return start + '<td class="st-cmp-off" colspan="' + players.length + '">' + esc(off) + '</td></tr>';
      const top = S.kit.leader(vs);   // highest present value, null when they are all equal
      const big = vs.reduce((m, v) => (v != null && Math.abs(v) > m ? Math.abs(v) : m), 0);
      return start +
        vs.map(v => {
          if (v == null) return '<td class="st-num st-cmp-v"><span class="st-cmp-none">–</span></td>';
          const d = delta ? F.signed(k.kind === 'scoreboard' ? 'scoreboard' : k.cat, k.key, v) : disp(k, v);
          const lead = top != null && v === top;
          const w = big > 0 && v !== 0 ? Math.max(2, Math.round(Math.abs(v) / big * 100)) : 0;
          return '<td class="st-num st-cmp-v' + (lead ? ' st-cmp-lead' : '') + '">' +
            '<span title="' + esc(d.exact) + '">' + esc(d.text) + '</span>' +
            (lead ? '<span class="sr-only"> (leads ' + esc(label) + ')</span>' : '') +
            '<span class="st-cmp-bar" aria-hidden="true"><i style="width:' + w + '%"></i></span></td>';
        }).join('') + '</tr>';
    }).join('');
    el.table.innerHTML = '<div class="st-table-wrap"><table class="st-table st-cmp-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    S.ui.hydrate(el.table);
    if (focusI != null) {
      const tr = el.table.querySelector('tr[data-i="' + focusI + '"]');
      if (tr) tr.focus();
    }
  }

  function selectRow(i, how) {
    const k = keys[i];
    if (!k) return;
    st.stat = k.id;
    writeState();
    el.table.querySelectorAll('tbody tr').forEach(tr => {
      const on = +tr.dataset.i === i;
      tr.classList.toggle('on', on);
      if (on) tr.setAttribute('aria-current', 'true'); else tr.removeAttribute('aria-current');
      tr.tabIndex = on ? 0 : -1;
    });
    drawChart();
    const top = el.graph.getBoundingClientRect().top;
    if (top < 54) el.graph.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    if (how === 'key') el.graph.focus({ preventScroll: true });
  }

  // ---- chart
  const liveAt = () => S.liveAt(meta, st.scope);

  function drawChart() {
    const k = selKey();
    if (!k || !res) return;
    const l = keyLabel(k);
    el.ccat.textContent = l.cat;
    el.ctitle.textContent = l.name;
    const off = offText(k);
    if (off) {
      if (chart) { chart.destroy(); chart = null; }
      el.chart.innerHTML = '<div class="st-chart"></div>';
      S.ui.empty(el.chart.firstChild, off);
      el.note.innerHTML = '';
      return;
    }
    const ser = (res.series || {})[k.id] || {};
    const series = players.map((p, i) => ({ id: p.uuid || p.tok, label: pName(p), color: LINES[i], points: (p.uuid && ser[p.uuid]) || [] }));
    const o = {
      series, from: res.effective_from, to: res.to, liveAt: liveAt(), height: 300,
      zero: !S.kit.ranged(st), axis: S.kit.axis(k.kind === 'scoreboard' ? 'scoreboard' : k.cat, k.key),
      format: v => (v === 0 ? '0' : disp(k, v).text),
      emptyText: 'None of these players has any ' + l.full + ' recorded ' + (isDelta() ? 'in this range' : 'here') + ' yet.',
    };
    if (chart) chart.update(o); else { el.chart.innerHTML = ''; chart = S.chart(el.chart, o); }
    // no legend under the value card: there are no lines to match
    const bits = chart.valueCard ? [] : [series.map(s => '<span class="st-k" style="background:' + s.color + '"></span>' + esc(s.label)).join(' &nbsp; ')];
    const since = sinceText(res);
    if (since) bits.push(esc(since.charAt(0).toUpperCase() + since.slice(1)));
    el.note.innerHTML = bits.join(' &nbsp;·&nbsp; ') + S.kit.liveNote(liveAt(), res);
  }

  function clearView() {
    if (chart) { chart.destroy(); chart = null; }
    el.chart.innerHTML = '';
    el.note.innerHTML = '';
    el.table.innerHTML = '';
    el.app.hidden = true;
  }

  // ---- loading
  // Match the response's players to ours: by uuid, then by name, then by position. A name
  // answered by another player (merged accounts: an alt counted as its main) is noted.
  function resolve(list) {
    const left = list.slice(), merged = [];
    players.forEach((p, i) => {
      let j = left.findIndex(r => p.uuid && norm(r.uuid) === norm(p.uuid));
      if (j < 0) j = left.findIndex(r => norm(r.uuid) === norm(p.tok) || (r.name && r.name.toLowerCase() === String(p.tok).toLowerCase()));
      if (j < 0 && left.length === players.length - i) j = 0;
      if (j < 0) return;
      const r = left.splice(j, 1)[0];
      if (!p.uuid && norm(r.uuid) !== norm(p.tok) && norm(r.name) !== norm(p.tok)) merged.push(p.tok + ' is counted as ' + F.playerName(r));
      p.uuid = r.uuid; p.name = r.name || null; p.unknown = false;
      if (typeof r.is_bot === 'boolean' || typeof r.is_bot_on_smp === 'boolean') p.bot = F.isBot(r);
    });
    return merged;
  }

  function mergeNote(list) {
    if (list.length) boxNote('players', list.join('. ') + '.');
  }

  // /compare answers once per real player: an alt asked for next to its main has no row of
  // its own. Ask /player who it is; when that is a player already here, drop the alt's chip.
  async function foldMerged(my, merged, focusI) {
    const todo = players.filter(p => !p.uuid && !p.unknown);
    if (!todo.length) { mergeNote(merged); return; }
    const main = new Map();
    await Promise.all(todo.map(p => get('player/' + encodeURIComponent(p.tok), { scope: st.scope })
      .then(r => { main.set(p, r); }, () => { /* leave it unresolved */ })));
    if (my !== gen) return;
    let folded = false;
    todo.forEach(p => {
      const r = main.get(p);
      const into = r && players.find(q => q !== p && q.uuid && norm(q.uuid) === norm(r.uuid));
      if (!into) return;
      players.splice(players.indexOf(p), 1);
      folded = true;
      merged.push(p.tok + ' is counted as ' + pName(into) + ', so it is shown once');
    });
    mergeNote(merged);
    if (!folded) return;
    writeState();
    paintChips();
    if (!ready()) { res = null; clearView(); paintMsg(); return; }   // too few players left
    paintMsg();
    paintTable(focusI);
    drawChart();
  }

  async function load(focusI) {
    const my = ++gen;
    info = S.scopeInfo(meta, st.scope);
    resErr = null;
    if (!ready()) {
      res = null; unknownMsg = '';
      clearView();
      paintMsg();
      return;
    }
    el.app.hidden = false;
    if (res) { el.app.classList.add('st-cmp-busy'); el.app.setAttribute('aria-busy', 'true'); }
    else {
      el.table.innerHTML = '<div class="st-empty">Loading…</div>';
      if (!chart) el.chart.innerHTML = '<div class="st-chart"><div class="st-empty">Loading…</div></div>';
    }
    const req = Object.assign({
      uuids: players.map(p => p.uuid || p.tok).join(','),
      keys: keys.map(k => k.id).join(','),
      scope: st.scope, include_bots: bots(),
    }, S.rangeParams(st));
    let r;
    try {
      r = await get('compare', req);
    } catch (err) {
      if (my !== gen) return;
      el.app.classList.remove('st-cmp-busy'); el.app.removeAttribute('aria-busy');
      res = null; resErr = err;
      clearView();
      paintMsg();
      // 404: a name doesn't exist; 400: e.g. an alt and its main make fewer distinct players
      if (err && (err.status === 404 || err.status === 400)) findUnknown(my);
      return;
    }
    if (my !== gen) return;
    el.app.classList.remove('st-cmp-busy'); el.app.removeAttribute('aria-busy');
    res = r; unknownMsg = '';
    const merged = resolve(r.players || []);
    if (!selKey()) st.stat = '';
    writeState();
    paintChips(); paintMsg();
    paintTable(focusI);
    drawChart();
    foldMerged(my, merged, focusI);
    checkBots();
  }

  // After a 404 (or 400) look up the names we haven't resolved: unknown ones are marked, and
  // an alt that turns out to be a player already here (merged accounts) loses its chip.
  async function findUnknown(my) {
    const todo = players.filter(p => !p.uuid);
    const out = await Promise.all(todo.map(p => get('player/' + encodeURIComponent(p.tok), { scope: st.scope })
      .then(r => { p.uuid = r.uuid; p.name = r.name || null; p.bot = F.isBot(r); return null; },
            e => (e && e.status === 404 ? p : null))));
    if (my !== gen) return;
    const bad = out.filter(Boolean);
    bad.forEach(p => { p.unknown = true; });
    if (bad.length) {
      const n = bad.map(p => '"' + p.tok + '"');
      unknownMsg = 'No player called ' + andList(n) + '. Check the spelling, or remove ' + (bad.length === 1 ? 'it' : 'them') + ' with × and search for the player above.';
    }
    const merged = [];
    players.slice().forEach(p => {
      const into = p.uuid && players.find(q => q !== p && q.uuid && norm(q.uuid) === norm(p.uuid));
      if (!into || players.indexOf(into) > players.indexOf(p)) return;   // keep the first of a pair
      players.splice(players.indexOf(p), 1);
      merged.push(p.tok + ' is counted as ' + pName(into) + ', so it is shown once');
    });
    mergeNote(merged);
    if (merged.length) {
      writeState();
      paintChips();
      if (!ready()) { resErr = null; paintMsg(); return; }   // too few players left: "Add at least…"
      load();
      return;
    }
    paintChips(); paintMsg();
  }

  // The bot flag comes with each /compare player (is_bot, read in resolve). A newly
  // found bot turns the toggle on once (STATS_API: compare with bots included).
  function checkBots() {
    if (info.hasBots) applyBots();
  }

  function applyBots() {
    const fresh = players.filter(p => p.bot && !botAuto.has(norm(p.uuid)));
    players.filter(p => p.bot).forEach(p => botAuto.add(norm(p.uuid)));
    if (fresh.length && !st.bots && info.hasBots) {
      st.bots = true;
      writeState();
      buildControls();
      paintChips(); paintMsg();
      load();
      return;
    }
    paintChips(); paintMsg();
  }

  // ---- controls
  function buildControls() {
    S.ui.controls(el.controls, meta, st, () => { load(); }, { range: true });
  }

  // ---- wiring
  function onChipClick(e) {
    const b = e.target.closest('.st-cmp-x');
    if (b) remove(b.dataset.list, +b.dataset.i);
  }
  el.players.addEventListener('click', onChipClick);
  el.keys.addEventListener('click', onChipClick);
  el.quick.addEventListener('click', e => {
    const b = e.target.closest('.st-cmp-qbtn');
    if (!b) return;
    const next = b.nextElementSibling || b.previousElementSibling;
    const k = parseKey(b.dataset.id);
    if (!k) {
      // its category isn't in /meta.categories any more: say so and keep the button
      boxNote('keys', b.textContent + " isn't available from the stats server right now.");
      return;
    }
    addKey(k);
    // the button is gone after the repaint: keep focus in the quick-add row (or the input)
    const same = next && Array.from(el.quick.querySelectorAll('.st-cmp-qbtn')).find(x => x.dataset.id === next.dataset.id);
    (same || el.quick.querySelector('.st-cmp-qbtn') || el.kq).focus();
  });

  el.table.addEventListener('click', e => {
    const tr = e.target.closest('tbody tr[data-i]');
    if (!tr || e.target.closest('a, button')) return;
    selectRow(+tr.dataset.i, e.detail === 0 ? 'key' : 'mouse');
  });
  el.table.addEventListener('keydown', e => {
    const tr = e.target.closest && e.target.closest('tbody tr[data-i]');
    if (!tr || e.target !== tr) return;
    const rows = Array.from(el.table.querySelectorAll('tbody tr[data-i]'));
    const i = rows.indexOf(tr);
    let j = -1;
    if (e.key === 'ArrowDown') j = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = rows.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(+tr.dataset.i, 'key'); return; }
    if (j < 0) return;
    e.preventDefault();
    rows.forEach(x => { x.tabIndex = -1; });
    rows[j].tabIndex = 0;
    rows[j].focus();
  });

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const seen = new Set();
    players = String(p.get('players') || '').split(',').map(s => s.trim()).filter(s => {
      if (!s || seen.has(norm(s))) return false;
      seen.add(norm(s));
      return true;
    }).slice(0, maxPlayers()).map(t => ({ tok: t, uuid: null, name: null, bot: null, unknown: false }));
    const kseen = new Set();
    keys = String(p.get('keys') || '').split(',').map(parseKey).filter(k => {
      if (!k || kseen.has(k.id)) return false;
      kseen.add(k.id);
      return true;
    }).slice(0, cfg().max_keys);
  }

  async function start() {
    el.app.hidden = true;
    try {
      meta = await S.meta();
    } catch (err) {
      document.querySelector('.st-cmp-pick').style.display = 'none';
      S.ui.error(el.msg, err);
      return;
    }
    st = S.state.read(meta, { players: '', keys: '', stat: '' });
    info = S.scopeInfo(meta, st.scope);
    readUrl();
    writeState();
    buildControls();
    S.ui.autocomplete(el.pq, { limit: 10, bots: () => !!bots(), types: ['players'], noneText: 'No players match that.', onPick: it => { el.pq.value = ''; addPlayer(it); } });
    S.ui.autocomplete(el.kq, {
      limit: 10, types: ['stats', 'objectives'], noneText: 'No stats or objectives match that.',
      onPick: it => {
        el.kq.value = '';
        addKey(it.type === 'objective' ? parseKey('scoreboard|' + it.objective) : parseKey(it.category + '|' + it.key));
      },
    });
    paintChips();
    load();
  }

  start();
})();
