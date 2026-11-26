/* Player dossier (/stats/player/?p=<name or uuid>).
 *
 * No ?p=: only the player search and one line of copy (no /meta request).
 * With ?p=: header (skin render, name, server chips, last seen, bot label) and the giant
 * count of stats where the player is #1 (0 -> their best rank), four headline tiles with
 * rank, badges merged across servers, the "Number one in" grid ("Best ranks" without a #1),
 * a full-width graph of the selected stat (/series for this player; any stat clicked on the
 * page is graphed there) and tabs: All stats, Scoreboards, Milestones, Firsts, Rivals.
 *
 * Requests: first paint is /meta + /player/{p}; the graph's /series follows. Responses are
 * kept per parameter set. `gen` drops stale profile loads, `cgen` stale graphs.
 * Merged accounts: when /player answers with another player than asked for (an alt counted
 * as its main), the URL's p becomes the answer's name (or uuid) and a note says so.
 * Tracking off for the scope: the Scoreboards / All stats tabs and the graph say so.
 * URL state: p, scope, bots, range/from/to (graph only), stat ("<category>|<key>" or
 * "scoreboard|<objective>"), tab.
 * Every API string goes through S.fmt.esc (or textContent) before it reaches the DOM.
 * Page-only classes (stats.css): st-pl st-pl-landing st-pl-lede st-pl-top st-pl-find st-pl-ctl
 * st-pl-head st-pl-skin st-pl-ones st-pl-bot st-pl-anon st-pl-tiles st-pl-sh st-pl-n st-pl-see
 * st-pod-more st-pl-graph st-pl-range st-pl-chart st-pl-tabs st-pl-panel st-pl-filt st-pl-one
 * st-pl-rk st-pl-top1 st-pl-row st-pl-quiet st-pl-intro st-pl-by st-pl-ek st-pl-link st-pl-trend
 * st-pl-empty st-pl-merged.
 */
(function () {
  const S = window.S, F = S.fmt, esc = F.esc;
  const $ = id => document.getElementById(id);
  const DEF_STAT = 'minecraft:custom|minecraft:play_time';
  const TABS = ['all', 'scoreboards', 'milestones', 'firsts', 'rivals'];
  const PODS = 7;          // "Number one in" cards before "+N more"
  const PAGE = 50;         // table rows per page
  const MS_PAGE = 20;      // milestone rows per page

  const el = {
    landing: $('pl-landing'), lede: $('pl-lede'), msg: $('pl-msg'), top: $('pl-top'), q: $('pl-q'),
    controls: $('pl-controls'), body: $('pl-body'),
  };

  let meta = null, st = null, info = null, prof = null, gen = 0, cgen = 0, chart = null;
  let tabs = null, curTab = 'all', customOpen = false;
  let rows = [];                                  // prof.stats with labels, for the All stats tab
  let fText = '', fCat = '', fOnes = false, allTbl = null, msPage = 1, msFocus = false;
  let mergedFrom = '';                            // what the URL asked for, when the API answered with another player
  const get = S.memo();

  // ---- small helpers
  const fmtCount = n => Number(n || 0).toLocaleString('en-GB');
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hasIcon = cat => !['custom', 'killed', 'killed_by', 'scoreboard'].includes(F.itemId(cat));
  const bots = () => (info.hasBots && st.bots ? 'true' : null);
  const serverLabel = k => { const s = (meta.servers || []).find(x => x.key === k); return s ? s.label : String(k).toUpperCase(); };
  const serverIdx = k => { const i = (meta.servers || []).findIndex(x => x.key === k); return i < 0 ? 999 : i; };
  const scopeServers = () => info.servers || (meta.servers || []).map(s => s.key);
  const scopeText = () => (st.scope === 'all' ? 'across all servers' : 'on ' + serverLabel(st.scope));
  // moving between players keeps the session's scope (and bots when on)
  const playerHref = (name, uuid) => S.kit.playerHref(st, name, uuid);
  const name = () => F.playerName(prof);
  const catLabel = c => (F.itemId(c) === 'custom' ? 'General' : F.statLabel(c, 'x').cat);
  const plural = (n, w) => fmtCount(n) + ' ' + w + (n === 1 ? '' : 's');
  const ago = unix => (window.C && C.ago ? C.ago(unix * 1000) : F.ago(unix));

  function statHtml(cat, key) {
    const l = F.statLabel(cat, key);
    return (l.cat ? '<span>' + esc(l.cat) + ' · </span>' : '') + esc(l.name);
  }
  function artHtml(cat, key, size) {
    const l = F.statLabel(cat, key);
    return hasIcon(cat) ? S.ui.iconHtml(F.itemId(key), size, l.name.charAt(0)) : S.ui.iconHtml('', size, l.name.charAt(0));
  }
  function rankHtml(r) {
    return '<span class="st-pl-rk' + (r.rank === 1 ? ' st-pl-top1' : '') + '">#' + esc(fmtCount(r.rank)) + ' <small>of ' + esc(fmtCount(r.of)) + '</small></span>';
  }

  // ---- selected stat (graph)
  function parseStat(v) {
    const i = String(v || '').indexOf('|');
    if (i <= 0) return null;
    const a = v.slice(0, i), b = v.slice(i + 1);
    if (!b) return null;
    if (a === 'scoreboard') return { kind: 'scoreboard', cat: '', key: b };
    if ((meta.categories || []).length && !(meta.categories || []).includes(a)) return null;
    return { kind: 'stat', cat: a, key: b };
  }
  const sel = () => parseStat(st.stat) || parseStat(DEF_STAT);
  const selId = s => (s.kind === 'scoreboard' ? 'scoreboard|' + s.key : s.cat + '|' + s.key);
  function selTitle(s) {
    if (s.kind === 'scoreboard') return s.key;
    const h = F.HEADLINES.find(x => x[0] === s.cat && x[1] === s.key);
    return h ? h[2] : F.statLabel(s.cat, s.key).full;
  }
  const boardLink = (kind, cat, key) => '<a class="st-board-link" href="' + esc(S.kit.boardHref(kind, cat, key, st)) + '">Leaderboard →</a>';
  const disp = (s, v) => F.display(s.kind === 'scoreboard' ? 'scoreboard' : s.cat, s.key, v);

  // ---- header
  // former names (renames, merged accounts), escaped: names come from players
  function akaHtml() {
    const aka = (prof.aka || []).filter(Boolean);
    return aka.length ? '<p class="st-pl-aka">Also known as ' + aka.map(esc).join(', ') + '</p>' : '';
  }
  function headerHtml() {
    const ones = prof.stats.filter(s => s.rank === 1).length;
    const chips = (prof.servers || []).map(k => '<span class="st-chip">' + esc(serverLabel(k)) + '</span>').join('');
    const bits = [chips];
    if (!prof.name) bits.push('<span class="st-pl-anon">Name not known yet</span>');
    if (prof.last_activity) bits.push('<span>· last seen ' + esc(ago(prof.last_activity)) + '</span>');
    if (F.isBot(prof)) bits.push('<span class="st-chip st-pl-bot">' + esc(F.botLabel(prof)) + '</span>');
    let big = '';
    if (prof.stats.length) {
      if (ones) {
        big = '<a class="st-pl-ones" href="#pl-ones"><div class="st-bigcount" data-count="' + ones + '">' + esc(fmtCount(ones)) + '</div>' +
          '<p>' + (ones === 1 ? 'stat' : 'stats') + ' where ' + esc(name()) + ' is #1 ' + esc(scopeText()) + '</p></a>';
      } else {
        const best = prof.stats.reduce((m, s) => Math.min(m, s.rank), Infinity);
        big = '<a class="st-pl-ones" href="#pl-ones"><div class="st-bigcount">#' + esc(fmtCount(best)) + '</div><p>best rank ' + esc(scopeText()) + '</p></a>';
      }
    }
    const merged = mergedFrom ? '<p class="st-pl-merged">Showing ' + esc(name()) + ' — ' + esc(mergedFrom) + ' is counted as the same player.</p>' : '';
    return '<header class="st-pl-head"><div class="st-ph"><span class="st-pl-skin" id="pl-skin"></span>' +
      '<div><h1>' + esc(name()) + '</h1>' + akaHtml() + '<div class="st-meta">' + bits.join('') + '</div>' + merged + '</div></div>' + big + '</header>';
  }

  function paintSkin() {
    const box = $('pl-skin');
    if (!box) return;
    const img = document.createElement('img');
    img.className = 'st-body';
    img.alt = '';
    img.width = 110;
    img.decoding = 'async';
    img.onerror = () => { img.onerror = null; img.replaceWith(S.ui.head(prof.uuid, 72)); };
    img.src = 'https://mc-heads.net/body/' + encodeURIComponent(prof.uuid) + '/120';
    box.appendChild(img);
  }

  function countUp(node) {
    const n = +node.dataset.count;
    if (!(n >= 10) || reduced() || !window.requestAnimationFrame) return;
    const t0 = performance.now(), dur = Math.min(1400, 500 + n * 2);
    node.setAttribute('aria-label', fmtCount(n));
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmtCount(Math.round(n * e));
      if (k < 1 && node.isConnected) requestAnimationFrame(step);
    };
    node.textContent = '0';
    requestAnimationFrame(step);
  }

  // ---- headline tiles
  function tilesHtml() {
    const cur = sel();
    return '<div class="st-tiles st-pl-tiles">' + F.HEADLINES.map(h => {
      const s = prof.stats.find(x => x.category === h[0] && x.key === h[1]);
      const on = cur.kind === 'stat' && cur.cat === h[0] && cur.key === h[1];
      let v = '<span class="st-v">–</span><span class="st-rk">None yet</span>';
      if (s) {
        const d = F.display(h[0], h[1], s.value);
        const i = d.text.lastIndexOf(' ');
        const num = i > 0 ? d.text.slice(0, i) : d.text, unit = i > 0 ? d.text.slice(i + 1) : '';
        v = '<span class="st-v"><span title="' + esc(d.exact) + '">' + esc(num) + '</span>' + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</span>' +
          '<span class="st-rk">Rank <b>#' + esc(fmtCount(s.rank)) + '</b> of ' + esc(fmtCount(s.of)) + '</span>';
      }
      return '<button type="button" class="st-tile' + (on ? ' on' : '') + '" data-kind="stat" data-cat="' + esc(h[0]) + '" data-key="' + esc(h[1]) +
        '" aria-pressed="' + on + '" aria-controls="pl-graph"><span class="st-lab">' + esc(h[2]) + '</span>' + v + '</button>';
    }).join('') + '</div>';
  }

  // ---- badges: one card per key, its servers listed; highest tier first
  function badgesHtml() {
    const by = new Map();
    (prof.badges || []).forEach(b => {
      if (!by.has(b.badge_key)) by.set(b.badge_key, []);
      const list = by.get(b.badge_key);
      if (!list.includes(b.server_key)) list.push(b.server_key);
    });
    const cfg = (meta.settings && meta.settings.badges) || {};
    const cards = Array.from(by.entries()).map(([k, sv], i) => Object.assign({ k, sv: sv.sort((a, b) => serverIdx(a) - serverIdx(b)), i }, F.badge(k, cfg)))
      .sort((a, b) => b.tier - a.tier || b.sv.length - a.sv.length || a.i - b.i);
    let body;
    if (!cards.length) body = '<p class="st-pl-empty">No badges ' + esc(scopeText()) + ' yet. They come with firsts, #1 spots, big numbers and long play time.</p>';
    else {
      body = '<div class="st-badges">' + cards.map(b =>
        '<div class="st-badge' + (b.tier >= 3 ? ' t3' : '') + '"' + (b.desc ? ' data-tip="' + esc(b.desc) + '" tabindex="0"' : '') + '>' +
        '<div class="st-art" aria-hidden="true">' + (b.art ? S.ui.iconHtml(b.art, 22, b.name.charAt(0)) : esc(b.name.charAt(0))) + '</div>' +
        '<div><div class="st-badge-n">' + esc(b.name) + '</div><div class="st-badge-s">' + esc(b.sv.map(serverLabel).join(' · ')) +
        (b.desc ? '<span class="sr-only">. ' + esc(b.desc) + '</span>' : '') + '</div></div></div>').join('') + '</div>';
    }
    return '<section class="st-sec"><h2>Badges' + (cards.length ? ' <small class="st-pl-n">' + esc(fmtCount(cards.length)) + '</small>' : '') + '</h2>' + body + '</section>';
  }

  // ---- "Number one in" (or "Best ranks")
  function podHtml(s, i) {
    const d = F.display(s.category, s.key, s.value);
    // the pod selects the stat into the graph; the corner link opens its full leaderboard
    return '<div class="st-podcell"><button type="button" class="st-pod" style="--i:' + i + '" data-kind="stat" data-cat="' + esc(s.category) + '" data-key="' + esc(s.key) + '" aria-controls="pl-graph">' +
      artHtml(s.category, s.key, 40) + '<span class="st-pod-st">' + statHtml(s.category, s.key) + '</span>' +
      '<span class="st-pod-v"><span title="' + esc(d.exact) + '">' + esc(d.text) + '</span><small>#' + esc(fmtCount(s.rank)) + ' of ' + esc(fmtCount(s.of)) + '</small></span></button>' +
      boardLink('stat', s.category, s.key) + '</div>';
  }

  function onesHtml() {
    if (!prof.stats.length) return '';
    const ones = prof.stats.filter(s => s.rank === 1).sort((a, b) => b.of - a.of);
    if (ones.length) {
      const many = ones.length > PODS + 1;
      const shown = many ? ones.slice(0, PODS) : ones;
      return '<section class="st-sec" id="pl-ones"><div class="st-pl-sh"><h2>Number one in</h2>' +
        '<button type="button" class="st-again st-pl-see" data-seeall>See all ' + esc(fmtCount(ones.length)) + '</button></div>' +
        '<div class="st-pods">' + shown.map(podHtml).join('') +
        (many ? '<button type="button" class="st-pod st-pod-more" style="--i:' + PODS + '" data-seeall><span>+ ' + esc(fmtCount(ones.length - PODS)) + ' more</span><small>Open the list</small></button>' : '') +
        '</div></section>';
    }
    const best = prof.stats.slice().sort((a, b) => a.rank / a.of - b.rank / b.of || a.rank - b.rank).slice(0, PODS + 1);
    return '<section class="st-sec" id="pl-ones"><div class="st-pl-sh"><h2>Best ranks</h2></div>' +
      '<div class="st-pods">' + best.map(podHtml).join('') + '</div></section>';
  }

  // ---- graph
  function graphHtml() {
    const presets = Object.keys((meta.settings && meta.settings.range_presets) || {});
    const btns = presets.concat(['all', 'custom']).map(k =>
      '<button type="button" class="st-seg-btn" data-value="' + esc(k) + '" aria-pressed="false">' + esc(k.toUpperCase()) + '</button>').join('');
    return '<section class="st-sec st-pl-graph" id="pl-graph" tabindex="-1"><div class="st-pl-sh"><h2 id="pl-ctitle"></h2><a class="st-board-link" id="pl-board" href="#">Leaderboard →</a>' +
      '<div class="st-pl-range"><div class="st-seg" role="group" aria-label="Graph range" id="pl-range">' + btns + '</div>' +
      '<span class="st-custom" id="pl-custom"><label>From <input type="date" name="from"></label> <label>To <input type="date" name="to"></label></span></div></div>' +
      '<div class="panel st-pl-chart"><div id="pl-chart"></div><div class="st-note" id="pl-note"></div></div></section>';
  }

  function paintRange() {
    const box = $('pl-range');
    if (!box) return;
    const isCustom = customOpen || (!st.range && st.from != null && st.to != null);
    const v = isCustom ? 'custom' : (st.range || 'all');
    box.querySelectorAll('button').forEach(b => {
      const on = b.dataset.value === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const c = $('pl-custom');
    c.style.display = isCustom ? '' : 'none';
    if (!st.range && st.from != null && st.to != null) {
      const ymd = t => { const d = new Date(t * 1000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      c.querySelector('[name=from]').value = ymd(st.from);
      c.querySelector('[name=to]').value = ymd(st.to);
    }
  }

  const liveAt = () => S.liveAt(meta, st.scope);
  const offText = kind => S.kit.untracked(meta, st.scope, kind);

  function paintNote(res) {
    const note = $('pl-note');
    if (!note) return;
    const bits = ['Click any stat on this page to graph it here.'];
    const since = S.kit.sinceText(meta, st, res, scopeServers(), 'clamped');
    if (since) bits.push(esc(S.kit.cap(since)));
    note.innerHTML = bits.join(' &nbsp;·&nbsp; ') + S.kit.liveNote(liveAt(), res);
  }

  // `err`: an API error, or a string for a plain empty state
  function chartMessage(err) {
    if (chart) { chart.destroy(); chart = null; }
    const box = $('pl-chart');
    box.innerHTML = '<div class="st-chart"></div>';
    if (typeof err === 'string') S.ui.empty(box.firstChild, err);
    else S.ui.error(box.firstChild, err);
    paintNote(null);
  }

  async function drawChart() {
    const my = ++cgen, g = gen;
    const box = $('pl-chart');
    if (!box) return;
    const s = sel();
    $('pl-ctitle').textContent = selTitle(s);
    $('pl-board').href = S.kit.boardHref(s.kind, s.cat, s.key, st);
    paintRange();
    const off = offText(s.kind);
    if (off) { chartMessage(off); return; }
    if (!chart) box.innerHTML = '<div class="st-chart"><div class="st-empty">Loading…</div></div>';
    const params = s.kind === 'scoreboard' ? { kind: 'scoreboard', key: s.key } : { kind: 'stat', category: s.cat, key: s.key };
    Object.assign(params, { uuids: prof.uuid, scope: st.scope, include_bots: bots() }, S.rangeParams(st));
    let res;
    try {
      res = await get('series', params);
    } catch (err) {
      if (my !== cgen || g !== gen) return;
      chartMessage(err);
      return;
    }
    if (my !== cgen || g !== gen) return;
    const ranged = S.kit.ranged(st);
    const o = {
      series: [{ id: prof.uuid, label: name(), color: 'var(--teal)', points: ((res && res.series) || {})[prof.uuid] || [] }],
      from: res.effective_from, to: res.to, liveAt: liveAt(), height: 300,
      zero: !ranged, axis: S.kit.axis(s.kind === 'scoreboard' ? 'scoreboard' : s.cat, s.key),
      format: v => (v === 0 ? '0' : disp(s, v).text),
      emptyText: name() + ' has no ' + selTitle(s).toLowerCase() + ' recorded ' + (ranged ? 'in this range' : scopeText()) + ' yet.',
    };
    if (chart) chart.update(o); else { box.innerHTML = ''; chart = S.chart(box, o); }
    paintNote(res);
  }

  // `focus`: move keyboard focus to the graph section (table row picks, keyboard activation)
  function selectStat(kind, cat, key, scroll, focus) {
    st.stat = selId({ kind, cat, key });
    S.state.write(st);
    el.body.querySelectorAll('.st-pl-tiles .st-tile').forEach(b => {
      const on = kind === 'stat' && b.dataset.cat === cat && b.dataset.key === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    drawChart();
    if (scroll) {
      const g = $('pl-graph');
      if (g) g.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    }
    if (focus) {
      const g = $('pl-graph');
      if (g) g.focus({ preventScroll: !!scroll });
    }
  }

  // ---- tabs
  function tabsHtml() {
    return '<section class="st-sec panel st-pl-tabs" id="pl-tabsec"><div id="pl-tabbar"></div>' +
      '<div class="st-pl-panel" id="pl-panel" role="tabpanel" tabindex="-1"></div></section>';
  }

  function paintTab(id) {
    curTab = id;
    st.tab = id;
    S.state.write(st);
    const panel = $('pl-panel');
    const tab = document.querySelector('#pl-tabbar [data-id="' + id + '"]');
    if (tab) panel.setAttribute('aria-labelledby', tab.id);
    allTbl = null;
    if (id === 'all') paintAll(panel);
    else if (id === 'scoreboards') paintBoards(panel);
    else if (id === 'milestones') paintMilestones(panel);
    else if (id === 'firsts') paintFirsts(panel);
    else paintRivals(panel);
  }

  // All stats: filter text, category buttons, "#1 only", table sorted by rank / of
  function paintAll(panel) {
    const off = offText('stat');
    if (off) { allTbl = null; S.ui.empty(panel, off); return; }
    const present = new Set(rows.map(r => r.category));
    const cats = (meta.categories || []).filter(c => present.has(c));
    rows.forEach(r => { if (!cats.includes(r.category)) cats.push(r.category); });
    if (fCat && !cats.includes(fCat)) fCat = '';
    const ones = rows.filter(r => r.rank === 1).length;
    const catBtn = (v, t) => '<button type="button" class="st-seg-btn' + (fCat === v ? ' on' : '') + '" data-cat="' + esc(v) + '" aria-pressed="' + (fCat === v) + '">' + esc(t) + '</button>';
    panel.innerHTML = '<div class="st-filt st-pl-filt">' +
      '<input class="st-sel" id="pl-filter" type="search" placeholder="Filter stats" aria-label="Filter stats">' +
      (ones ? '<button type="button" class="st-pl-one' + (fOnes ? ' on' : '') + '" id="pl-one" aria-pressed="' + fOnes + '">#1 only <small>' + esc(fmtCount(ones)) + '</small></button>' : '') +
      '<div class="st-seg" role="group" aria-label="Category" id="pl-cats">' + catBtn('', 'All') + cats.map(c => catBtn(c, catLabel(c))).join('') + '</div>' +
      '</div><div id="pl-tbl"></div>';
    const input = $('pl-filter');
    input.value = fText;
    input.addEventListener('input', () => { fText = input.value; paintAllRows(); });
    $('pl-cats').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.dataset.cat === fCat) return;
      fCat = b.dataset.cat;
      $('pl-cats').querySelectorAll('button').forEach(x => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      paintAllRows();
    });
    const one = $('pl-one');
    if (one) one.addEventListener('click', () => { setOnes(!fOnes); paintAllRows(); });
    paintAllRows();
  }

  function setOnes(on) {
    fOnes = on;
    const one = $('pl-one');
    if (one) { one.classList.toggle('on', on); one.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }

  function allHits() {
    const q = fText.trim().toLowerCase(), qid = q.replace(/ /g, '_');
    return rows.filter(r => (!fCat || r.category === fCat) && (!fOnes || r.rank === 1) &&
      (!q || r.lab.toLowerCase().includes(q) || F.itemId(r.key).includes(qid)));
  }

  function paintAllRows() {
    const box = $('pl-tbl');
    if (!box) return;
    const hits = allHits();
    if (!hits.length) {
      allTbl = null;
      if (!rows.length) S.ui.empty(box, name() + ' has no stats ' + scopeText() + ' yet.');
      else S.ui.empty(box, 'No stats match ' + (fText.trim() ? '"' + fText.trim() + '"' : 'this filter') + (fOnes ? ' among the #1 spots' : '') + '.');
      return;
    }
    if (allTbl) { allTbl.setRows(hits); return; }
    allTbl = S.ui.table(box, {
      columns: [
        { id: 'stat', label: 'Stat', sort: r => r.lab.toLowerCase() },
        { id: 'value', label: 'Value', num: true, sort: true },
        { id: 'rank', label: 'Rank', num: true, sort: r => r.rank / r.of },
        { id: 'board', label: '', sort: null },
      ],
      rows: hits, pageSize: PAGE, sortBy: 'rank', sortDir: 'asc',
      rowHtml: r => {
        const d = F.display(r.category, r.key, r.value);
        return '<td>' + artHtml(r.category, r.key, 20) + statHtml(r.category, r.key) + '</td>' +
          '<td class="st-num" title="' + esc(d.exact) + '">' + esc(d.text) + '</td><td class="st-num">' + rankHtml(r) + '</td>' +
          '<td class="st-board-cell">' + boardLink('stat', r.category, r.key) + '</td>';
      },
      onRow: r => selectStat('stat', r.category, r.key, true, true),
    });
  }

  function paintBoards(panel) {
    const off = offText('scoreboard');
    if (off) { S.ui.empty(panel, off); return; }
    const list = prof.scoreboards || [];
    if (!list.length) { S.ui.empty(panel, name() + ' has no scoreboard scores ' + scopeText() + ' yet.'); return; }
    panel.innerHTML = '<div></div>';
    S.ui.table(panel.firstChild, {
      columns: [
        { id: 'objective', label: 'Objective', sort: r => String(r.objective).toLowerCase() },
        { id: 'value', label: 'Score', num: true, sort: true },
        { id: 'rank', label: 'Rank', num: true, sort: r => r.rank / r.of },
        { id: 'board', label: '', sort: null },
      ],
      rows: list, pageSize: PAGE, sortBy: 'rank', sortDir: 'asc',
      rowHtml: r => {
        const d = F.display('scoreboard', r.objective, r.value);
        return '<td>' + esc(r.objective) + '</td><td class="st-num" title="' + esc(d.exact) + '">' + esc(d.text) + '</td><td class="st-num">' + rankHtml(r) + '</td>' +
          '<td class="st-board-cell">' + boardLink('scoreboard', null, r.objective) + '</td>';
      },
      onRow: r => selectStat('scoreboard', '', r.objective, true, true),
    });
  }

  function whenHtml(r) {
    const w = F.when(r);
    if (w.kind === 'earliest') return '<span class="st-feed-d">before tracking</span>';
    return '<span class="st-feed-d' + (w.kind === 'by' ? ' by' : '') + '">' + esc(w.text) + '</span>';
  }

  function milestoneRow(r) {
    const v = F.display(r.category, r.stat_key, r.threshold).text;
    return '<button type="button" class="st-feed-row st-pl-row" data-kind="stat" data-cat="' + esc(r.category) + '" data-key="' + esc(r.stat_key) + '" aria-controls="pl-graph">' +
      artHtml(r.category, r.stat_key, 28) +
      '<span class="st-feed-t">' + (r.earliest_known ? 'Already had ' : 'Passed ') + '<b>' + esc(v) + '</b> ' + statHtml(r.category, r.stat_key) +
      ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></span>' + whenHtml(r) + '</button>';
  }

  function paintMilestones(panel) {
    const list = prof.milestones || [];
    if (!list.length) {
      S.ui.empty(panel, 'No milestones ' + scopeText() + ' yet. They appear when ' + name() + ' passes a round number in a stat.');
      return;
    }
    const dated = list.filter(r => !r.earliest_known).sort((a, b) => b.at - a.at);
    const early = list.filter(r => r.earliest_known);
    // one ordered list (dated newest first, then the before-tracking ones), cut into pages
    const start = (msPage - 1) * MS_PAGE, end = start + MS_PAGE;
    const d = dated.slice(start, end);
    const e = early.slice(Math.max(0, start - dated.length), Math.max(0, end - dated.length));
    panel.innerHTML = (d.length ? '<div class="st-feed">' + d.map(milestoneRow).join('') + '</div>' : '') +
      (e.length ? '<h3 class="st-pl-quiet">Already reached before tracking began</h3><div class="st-feed st-pl-early">' + e.map(milestoneRow).join('') + '</div>' : '');
    S.ui.hydrate(panel);
    S.ui.pager(panel, { total: list.length, pageSize: MS_PAGE, page: msPage, onPage: n => { msPage = n; msFocus = true; paintMilestones(panel); }, focus: msFocus });
    msFocus = false;
  }

  function paintFirsts(panel) {
    const list = prof.firsts || [];
    if (!list.length) { S.ui.empty(panel, name() + ' holds no firsts ' + scopeText() + ' yet.'); return; }
    const dated = list.filter(r => !r.earliest_known).length;
    const early = list.length - dated;
    const intro = !dated
      ? esc(name()) + ' is the earliest known holder of ' + esc(plural(early, 'stat')) + ' (already true when tracking began).'
      : esc(name()) + ' was first on a server to get ' + esc(plural(dated, 'stat')) +
        (early ? ', and is the earliest known holder of ' + esc(fmtCount(early)) + ' more (already true when tracking began)' : '') + '.';
    panel.innerHTML = '<p class="st-pl-intro">' + intro + '</p><div></div>';
    S.ui.table(panel.lastChild, {
      columns: [
        { id: 'stat', label: 'Stat', sort: r => F.statLabel(r.category, r.stat_key).full.toLowerCase() },
        { id: 'server', label: 'Server', sort: r => serverIdx(r.server_key) },
        { id: 'at', label: 'When', num: true, sort: r => (r.earliest_known ? null : r.at) },
      ],
      rows: list, pageSize: PAGE, sortBy: 'at', sortDir: 'desc',
      rowHtml: r => {
        const w = F.when(r);
        const when = w.kind === 'earliest' ? '<span class="st-pl-ek">Earliest known holder</span>'
          : '<span' + (w.kind === 'by' ? ' class="st-pl-by" title="Happened between two backups; known only by this date"' : '') + '>' + esc(w.text) + '</span>';
        return '<td>' + artHtml(r.category, r.stat_key, 20) + statHtml(r.category, r.stat_key) + '</td><td>' + esc(serverLabel(r.server_key)) + '</td><td class="st-num">' + when + '</td>';
      },
      onRow: r => selectStat('stat', r.category, r.stat_key, true, true),
    });
  }

  function paintRivals(panel) {
    const list = prof.rivals || [];
    if (!list.length) {
      S.ui.empty(panel, 'No rivals yet. Rivals appear when another player is close behind in a stat and closing in.');
      return;
    }
    panel.innerHTML = '<div class="st-feed">' + list.map(r => {
      const ahead = r.uuid_a === prof.uuid;
      const other = F.playerName({ name: r.other_name, uuid: r.other_uuid });
      const gap = F.display(r.category, r.stat_key, Math.abs(r.gap)).text;
      const days = r.overtake_days != null && r.closing_per_day > 0 ? Math.max(1, Math.round(r.overtake_days)) : null;
      const trend = days != null ? 'catching up in ' + days + (days === 1 ? ' day' : ' days') : 'gap widening';
      return '<div class="st-feed-row">' + S.ui.headHtml(r.other_uuid, 28) +
        '<div class="st-feed-t">' + (ahead ? 'Ahead of ' : 'Behind ') + '<a class="st-pl-link" href="' + esc(playerHref(r.other_name, r.other_uuid)) + '">' + esc(other) + '</a> by <b>' + esc(gap) + '</b> in ' +
        '<button type="button" class="st-pl-link" data-kind="stat" data-cat="' + esc(r.category) + '" data-key="' + esc(r.stat_key) + '" aria-controls="pl-graph">' + statHtml(r.category, r.stat_key) + '</button>' +
        ' <span>on ' + esc(serverLabel(r.server_key)) + '</span></div>' +
        '<div class="st-feed-d st-pl-trend' + (days != null ? ' on' : '') + '">' + (days != null && ahead ? esc(other) + ' is ' : '') + esc(trend) + '</div></div>';
    }).join('') + '</div>';
    S.ui.hydrate(panel);
  }

  function buildTabs() {
    const n = k => fmtCount((prof[k] || []).length);
    tabs = S.ui.tabs($('pl-tabbar'), [
      { id: 'all', label: 'All stats', count: n('stats') },
      { id: 'scoreboards', label: 'Scoreboards', count: n('scoreboards') },
      { id: 'milestones', label: 'Milestones', count: n('milestones') },
      { id: 'firsts', label: 'Firsts', count: n('firsts') },
      { id: 'rivals', label: 'Rivals', count: n('rivals') },
    ], paintTab);
    $('pl-tabbar').querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-controls', 'pl-panel'));
    const first = TABS.includes(st.tab) ? st.tab : 'all';
    tabs.select(first, true);
    paintTab(first);
  }

  // "See all N": the All stats tab, #1 only, scrolled to and focused on the first row
  function seeAll() {
    fText = ''; fCat = ''; fOnes = true;
    if (curTab !== 'all') tabs.select('all'); else paintTab('all');
    const sec = $('pl-tabsec');
    sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    const tr = $('pl-panel').querySelector('tr[data-i]');
    (tr || $('pl-panel')).focus({ preventScroll: true });
  }

  // ---- whole profile
  function paintProfile() {
    rows = prof.stats.map(s => Object.assign({}, s, { lab: F.statLabel(s.category, s.key).full }));
    if (chart) { chart.destroy(); chart = null; }
    const empty = !prof.stats.length && !(prof.scoreboards || []).length;
    if (empty) {
      el.body.innerHTML = headerHtml() + '<div class="panel st-empty st-pl-none"><b>Nothing ' + esc(scopeText()) + ' yet</b>' +
        esc(name()) + ' has no stats or scores ' + esc(scopeText()) + '.' +
        (st.scope !== 'all' ? ' <a href="' + esc(allHref()) + '">See all servers</a>' : '') + '</div>';
      paintSkin();
      return;
    }
    el.body.innerHTML = headerHtml() + tilesHtml() + badgesHtml() + onesHtml() + graphHtml() + tabsHtml();
    S.ui.tip(el.body);
    S.ui.hydrate(el.body);
    paintSkin();
    const big = el.body.querySelector('.st-bigcount[data-count]');
    if (big) countUp(big);
    buildTabs();
    drawChart();
  }

  function allHref() {
    const q = new URLSearchParams(location.search);
    q.set('scope', 'all');
    return location.pathname + '?' + q.toString();
  }

  function showLanding(msgErr) {
    el.body.hidden = true;
    el.body.innerHTML = '';
    el.landing.hidden = false;
    el.controls.style.display = 'none';
    el.lede.hidden = !!msgErr;
    el.msg.innerHTML = '';
    el.top.classList.add('st-pl-big');
    if (msgErr) {
      S.ui.error(el.msg, msgErr);
      if (msgErr.status === 404) {
        el.msg.firstChild.textContent = 'No player called "' + st.p + '". Check the spelling or search below.';
      }
    }
  }

  async function load() {
    const my = ++gen;
    fText = ''; fCat = ''; fOnes = false; msPage = 1;
    ++cgen;
    info = S.scopeInfo(meta, st.scope);
    if (chart) { chart.destroy(); chart = null; }
    el.body.innerHTML = '<div class="st-empty">Loading ' + esc(st.p) + '…</div>';
    let res;
    try {
      res = await get('player/' + encodeURIComponent(st.p), { scope: st.scope, include_bots: bots() });
    } catch (err) {
      if (my !== gen) return;
      if (err && err.status === 404) { showLanding(err); return; }
      prof = null;
      el.body.innerHTML = '';
      S.ui.error(el.body, err);
      return;
    }
    if (my !== gen) return;
    canonical(res);
    prof = Object.assign({}, res, { stats: res.stats || [] });
    document.title = name() + ' | Chronos';
    paintProfile();
  }

  // The API may answer for another account than asked (merged accounts): the URL then names
  // the player it showed, and the note keeps what was asked for.
  function canonical(res) {
    const want = res.name || res.uuid;
    if (!want || want === st.p) return;
    const norm = v => String(v || '').toLowerCase().replace(/-/g, '');
    if (norm(st.p) !== norm(res.name) && norm(st.p) !== norm(res.uuid)) mergedFrom = st.p;
    st.p = want;
    S.state.write(st);
  }

  // ---- wiring
  el.body.addEventListener('click', e => {
    if (e.target.closest('[data-seeall]')) { seeAll(); return; }
    const b = e.target.closest('button[data-key]');
    if (b && !b.closest('.st-table')) {
      // e.detail === 0: activated from the keyboard
      selectStat(b.dataset.kind || 'stat', b.dataset.cat || '', b.dataset.key, true, e.detail === 0);
      return;
    }
    const r = e.target.closest('#pl-range button');
    if (r) {
      const v = r.dataset.value;
      if (v === 'custom') {
        customOpen = true; paintRange();
        $('pl-custom').querySelector('[name=from]').focus();
        return;
      }
      customOpen = false;
      const next = v === 'all' ? null : v;
      if (next === st.range && st.from == null) { paintRange(); return; }
      st.range = next; st.from = null; st.to = null;
      S.state.write(st);
      drawChart();
    }
  });
  el.body.addEventListener('change', e => {
    if (!e.target.closest('#pl-custom')) return;
    const c = $('pl-custom');
    const f = S.ui.dayStart(c.querySelector('[name=from]').value), t = S.ui.dayEnd(c.querySelector('[name=to]').value);
    if (f == null || t == null || f > t) return;
    st.range = null; st.from = f; st.to = t;
    S.state.write(st);
    drawChart();
  });

  function onPick(it) {
    if (it.type !== 'player') return;
    el.q.value = '';
    location.href = playerHref(it.name, it.uuid);
  }

  async function start() {
    S.ui.autocomplete(el.q, { limit: 10, types: ['players'], noneText: 'No players match that.', onPick, bots: () => !!bots() });
    const p = (new URLSearchParams(location.search).get('p') || '').trim();
    if (!p) {
      el.top.classList.add('st-pl-big');
      return;
    }
    el.landing.hidden = true;
    el.body.hidden = false;
    el.body.innerHTML = '<div class="st-empty">Loading ' + esc(p) + '…</div>';
    try {
      meta = await S.meta();
    } catch (err) {
      el.body.innerHTML = '';
      S.ui.error(el.body, err);
      return;
    }
    st = S.state.read(meta, { p: '', stat: DEF_STAT, tab: 'all' });
    st.p = p;
    if (!parseStat(st.stat)) st.stat = DEF_STAT;
    if (!TABS.includes(st.tab)) st.tab = 'all';
    S.state.write(st);
    S.ui.controls(el.controls, meta, st, () => load());
    load();
  }

  start();
})();
