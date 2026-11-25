/*
 * S.ui — shared Stats widgets: player heads, item icons, the controls bar (scope / bots /
 * range / synced pill), search autocomplete, tabs, a sortable paged table, empty and
 * error states.
 *
 * Classes emitted (styled in assets/css/stats.css, Task 7):
 *   heads/icons   st-head st-icon st-letter
 *   controls      st-controls st-seg st-seg-btn on st-select st-check st-custom
 *                 st-synced (with site classes pill / stale)
 *   autocomplete  st-ac st-ac-group st-ac-key st-ac-opt st-ac-sub st-ac-name st-ac-meta
 *                 st-ac-none active
 *   tabs          st-tabs st-tab st-tab-count on
 *   table         st-table-wrap st-table st-num st-sort st-sort-ind st-row-link
 *                 st-pager st-pager-count st-pager-btns st-pg st-pg-prev st-pg-next st-pg-gap
 *   states        st-empty (site classes panel err for errors)
 *   data attrs    data-kind, data-value, data-type, data-id, data-col
 * Inline styles are limited to sizes of fallback squares, hiding (style.display) and
 * the autocomplete listbox position.
 */
(function (root) {
  const S = root.S = root.S || {};
  const esc = s => (S.fmt && S.fmt.esc ? S.fmt.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'));
  const show = (node, on) => { node.style.display = on ? '' : 'none'; };
  let uid = 0;
  const nextId = p => 'st-' + p + '-' + (++uid);

  function letter(ch, size, cls) {
    const s = document.createElement('span');
    s.className = 'st-letter' + (cls ? ' ' + cls : '');
    s.textContent = ch;
    s.setAttribute('aria-hidden', 'true');
    s.style.width = s.style.height = size + 'px';
    return s;
  }

  // Swap a failed img for a letter square, now if attached or as soon as it is.
  function swap(img, node) {
    if (img.parentNode) img.replaceWith(node);
    else img._stSwap = node;
  }

  // ---- heads: Crafatar -> mc-heads -> "?" square. A service that fails 3 times in a row
  // is skipped from then on, so an outage costs a few requests, not one per row.
  const HEADS = [
    (u, n) => 'https://crafatar.com/avatars/' + encodeURIComponent(u) + '?size=' + n + '&overlay',
    (u, n) => 'https://mc-heads.net/avatar/' + encodeURIComponent(u) + '/' + n,
  ];
  const headFails = [0, 0];
  function head(uuid, size) {
    size = size || 32;
    let i = headFails.findIndex(f => f < 3);
    if (i < 0 || !uuid) return letter('?', size, 'st-head');
    const img = document.createElement('img');
    img.className = 'st-head';
    img.alt = '';
    img.width = img.height = size;
    img.decoding = 'async';
    img.onload = () => { headFails[i] = 0; };
    img.onerror = () => {
      headFails[i]++;
      i++;
      while (i < HEADS.length && headFails[i] >= 3) i++;
      if (i < HEADS.length) img.src = HEADS[i](uuid, size);
      else { img.onerror = img.onload = null; swap(img, letter('?', size, 'st-head')); }
    };
    img.src = HEADS[i](uuid, size);
    return img;
  }

  // ---- item icons: /cache/items/<id>.png, letter square on 404; failed ids are remembered.
  const missingIcons = new Set();
  function icon(id, size, ch) {
    size = size || 24;
    id = String(id || '');
    const l = String(ch != null ? ch : id.charAt(0) || '?').toUpperCase();
    if (!id || missingIcons.has(id)) return letter(l, size, 'st-icon');
    const img = document.createElement('img');
    img.className = 'st-icon';
    img.alt = '';
    img.width = img.height = size;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { missingIcons.add(id); img.onerror = null; swap(img, letter(l, size, 'st-icon')); };
    img.src = id.charAt(0) === '/' ? id : '/cache/items/' + encodeURIComponent(id) + '.png';
    return img;
  }

  // Placeholders for HTML strings (table rows): S.ui.hydrate(root) turns them into elements.
  const headHtml = (uuid, size) => '<span data-st-head="' + esc(uuid) + '" data-size="' + (size || 32) + '"></span>';
  const iconHtml = (id, size, ch) => '<span data-st-icon="' + esc(id) + '" data-size="' + (size || 24) + '"' +
    (ch != null ? ' data-letter="' + esc(ch) + '"' : '') + '></span>';
  function hydrate(rootEl) {
    rootEl.querySelectorAll('[data-st-head]').forEach(p => p.replaceWith(head(p.dataset.stHead, +p.dataset.size)));
    rootEl.querySelectorAll('[data-st-icon]').forEach(p =>
      p.replaceWith(icon(p.dataset.stIcon, +p.dataset.size, p.dataset.letter != null ? p.dataset.letter : undefined)));
    rootEl.querySelectorAll('img').forEach(img => { if (img._stSwap) { img.replaceWith(img._stSwap); } });
  }

  // ---- synced pill
  function ago(ms) {
    if (root.C && root.C.ago) return root.C.ago(ms);
    if (!ms) return 'at an unknown time';
    const s = (Date.now() - ms) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function paintSynced(el, lastRunAt) {
    const at = lastRunAt ? lastRunAt * 1000 : null;
    const stale = !!at && (Date.now() - at) / 36e5 > 1;
    el.className = 'pill st-synced' + (stale ? ' stale' : '');
    el.textContent = (stale ? 'Stale, synced ' : 'Synced ') + ago(at);
  }

  // ---- dates for the custom range (local time zone)
  const pad = n => (n < 10 ? '0' : '') + n;
  function ymd(unix) { const d = new Date(unix * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? [+m[1], +m[2] - 1, +m[3]] : null;
  }
  function dayStart(s) { const p = parseYmd(s); return p ? new Date(p[0], p[1], p[2]).getTime() / 1000 : null; }
  function dayEnd(s) { const p = parseYmd(s); return p ? new Date(p[0], p[1], p[2], 23, 59, 59).getTime() / 1000 : null; }

  // Which scopes are segmented buttons and which go into the "Server" select.
  function splitScopes(meta) {
    const scopes = (meta && meta.scopes) || [];
    const servers = (meta && meta.servers) || [];
    const byKey = {};
    servers.forEach(s => { byKey[s.key] = s; });
    const groups = meta && meta.scope_groups;
    const seg = [], sel = [];
    scopes.forEach(k => {
      let inSeg;
      if (k === 'all') inSeg = true;
      else if (groups) inSeg = !!groups[k] || !Object.keys(groups).some(g => groups[g].includes(k));
      // A server is ungrouped when no other server shares its group (meta gives smp group
      // "smp" but also cmp group "cmp", so "group === key" alone would misplace cmp).
      else inSeg = !byKey[k] || !servers.some(o => o.key !== k && o.group === byKey[k].group);
      (inSeg ? seg : sel).push(k);
    });
    const label = k => (byKey[k] && byKey[k].label) || k;
    return { seg, sel, label };
  }

  function segButtons(kind, ariaLabel, items) {
    const g = document.createElement('div');
    g.className = 'st-seg';
    g.dataset.kind = kind;
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', ariaLabel);
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-seg-btn';
      b.dataset.value = it.value;
      b.textContent = it.text;
      b.setAttribute('aria-pressed', 'false');
      g.appendChild(b);
    });
    return g;
  }
  function press(group, value) {
    group.querySelectorAll('button').forEach(b => {
      const on = b.dataset.value === value;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('on', on);
    });
  }

  // ---- controls bar
  function controls(el, meta, st, onChange, opts) {
    opts = opts || {};
    const sp = splitScopes(meta);
    el.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'st-controls';
    el.appendChild(bar);

    const scopeSeg = segButtons('scope', 'Scope', sp.seg.map(k => ({ value: k, text: String(sp.label(k)).toUpperCase() })));
    bar.appendChild(scopeSeg);

    const selWrap = document.createElement('label');
    selWrap.className = 'st-select';
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Server');
    sel.innerHTML = '<option value="">Server</option>' +
      sp.sel.map(k => '<option value="' + esc(k) + '">' + esc(sp.label(k)) + '</option>').join('');
    selWrap.appendChild(sel);
    show(selWrap, sp.sel.length > 0);
    bar.appendChild(selWrap);

    const botWrap = document.createElement('label');
    botWrap.className = 'st-check';
    const bot = document.createElement('input');
    bot.type = 'checkbox';
    botWrap.appendChild(bot);
    botWrap.appendChild(document.createTextNode(' Include bots'));
    bar.appendChild(botWrap);

    let rangeSeg = null, custom = null, fromIn = null, toIn = null, customOpen = false;
    if (opts.range) {
      const presets = Object.keys((meta && meta.settings && meta.settings.range_presets) || {});
      rangeSeg = segButtons('range', 'Time range', presets.map(k => ({ value: k, text: k.toUpperCase() }))
        .concat([{ value: 'all', text: 'ALL' }, { value: 'custom', text: 'CUSTOM' }]));
      bar.appendChild(rangeSeg);
      custom = document.createElement('span');
      custom.className = 'st-custom';
      custom.innerHTML = '<label>From <input type="date" name="from"></label> <label>To <input type="date" name="to"></label>';
      fromIn = custom.querySelector('[name=from]');
      toIn = custom.querySelector('[name=to]');
      const today = ymd(Date.now() / 1000);
      fromIn.max = toIn.max = today;
      bar.appendChild(custom);
    }

    const pill = document.createElement('span');
    bar.appendChild(pill);
    let lastRun = meta && meta.last_run_at;
    paintSynced(pill, lastRun);
    const timer = setInterval(() => {
      if (!pill.isConnected) { clearInterval(timer); return; }
      paintSynced(pill, lastRun);
    }, 60000);

    function paint() {
      press(scopeSeg, sp.seg.includes(st.scope) ? st.scope : null);
      sel.value = sp.sel.includes(st.scope) ? st.scope : '';
      sel.classList.toggle('on', sp.sel.includes(st.scope));
      bot.checked = !!st.bots;
      show(botWrap, !!(S.scopeInfo && S.scopeInfo(meta, st.scope).hasSmp));
      if (rangeSeg) {
        const isCustom = customOpen || (!st.range && st.from != null && st.to != null);
        press(rangeSeg, isCustom ? 'custom' : st.range);
        show(custom, isCustom);
        if (!st.range && st.from != null && st.to != null) { fromIn.value = ymd(st.from); toIn.value = ymd(st.to); }
      }
    }
    function commit() {
      // bots only means something where SMP data is in view; don't carry it into the URL elsewhere
      if (st.bots && S.scopeInfo && !S.scopeInfo(meta, st.scope).hasSmp) st.bots = false;
      if (S.state) S.state.write(st);
      paint();
      onChange(st);
    }

    scopeSeg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || b.dataset.value === st.scope) return;
      st.scope = b.dataset.value;
      commit();
    });
    sel.addEventListener('change', () => {
      if (!sel.value || sel.value === st.scope) { paint(); return; }
      st.scope = sel.value;
      commit();
    });
    bot.addEventListener('change', () => { st.bots = bot.checked; commit(); });
    if (rangeSeg) {
      rangeSeg.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        const v = b.dataset.value;
        if (v === 'custom') {
          customOpen = true;
          paint();
          fromIn.focus();
          return;
        }
        customOpen = false;
        if (v === st.range) { paint(); return; }
        st.range = v; st.from = null; st.to = null;
        commit();
      });
      const onDate = () => {
        const f = dayStart(fromIn.value), t = dayEnd(toIn.value);
        if (f == null || t == null || f > t) return;
        if (!st.range && st.from === f && st.to === t) return;
        st.range = null; st.from = f; st.to = t;
        commit();
      };
      fromIn.addEventListener('change', onDate);
      toIn.addEventListener('change', onDate);
    }
    paint();
    return {
      setSynced(lastRunAt) { lastRun = lastRunAt; paintSynced(pill, lastRun); },
    };
  }

  // ---- autocomplete
  function autocomplete(input, opts) {
    opts = opts || {};
    const limit = opts.limit || 10;
    const list = document.createElement('ul');
    list.id = nextId('ac');
    list.className = 'st-ac';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Search results');
    show(list, false);
    input.insertAdjacentElement('afterend', list);
    const parent = input.parentNode;
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off');

    let items = [], active = -1, timer = null, seq = 0;

    // A blurred .panel around the input is its own stacking layer, so later panels paint over
    // the open list whatever its z-index. Lift every such ancestor while the list is open.
    let hosts = [];
    function lift(on) {
      hosts.forEach(h => h.classList.remove('st-ac-host'));
      hosts = [];
      if (!on) return;
      for (let a = input.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') ||
            cs.filter !== 'none' || cs.transform !== 'none') { a.classList.add('st-ac-host'); hosts.push(a); }
      }
    }
    function close() {
      lift(false);
      show(list, false);
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function place() {
      list.style.position = 'absolute';
      list.style.left = input.offsetLeft + 'px';
      list.style.top = (input.offsetTop + input.offsetHeight) + 'px';
      list.style.minWidth = input.offsetWidth + 'px';
      list.style.zIndex = '50';
    }
    function setActive(i) {
      const opts2 = list.querySelectorAll('[role=option]');
      opts2.forEach((o, j) => {
        o.classList.toggle('active', j === i);
        o.setAttribute('aria-selected', j === i ? 'true' : 'false');
      });
      active = i;
      if (i >= 0 && opts2[i]) {
        input.setAttribute('aria-activedescendant', opts2[i].id);
        if (opts2[i].scrollIntoView) opts2[i].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      clearTimeout(timer); seq++;   // a pending or in-flight search must not reopen the list
      close();
      if (opts.onPick) opts.onPick(it);
    }
    function option(it, cls, html) {
      const idx = items.push(it) - 1;
      const li = document.createElement('li');
      li.id = list.id + '-' + idx;
      li.className = 'st-ac-opt' + (cls ? ' ' + cls : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.dataset.type = it.type;
      li.dataset.index = idx;
      li.innerHTML = html;
      return li;
    }
    function heading(text, cls) {
      const li = document.createElement('li');
      li.className = cls;
      li.setAttribute('role', 'presentation');
      li.textContent = text;
      return li;
    }
    function render(data) {
      items = [];
      list.innerHTML = '';
      // opts.types (e.g. ['players']) limits the groups shown
      const want = g => !opts.types || opts.types.includes(g);
      const players = (want('players') && data && data.players) || [];
      const stats = (want('stats') && data && data.stats) || [];
      const objectives = (want('objectives') && data && data.objectives) || [];
      if (players.length) {
        list.appendChild(heading('Players', 'st-ac-group'));
        players.forEach(p => {
          const li = option({ type: 'player', uuid: p.uuid, name: p.name }, '', '<span class="st-ac-name"></span>');
          li.querySelector('.st-ac-name').textContent = S.fmt ? S.fmt.playerName(p) : (p.name || String(p.uuid).slice(0, 8));
          li.insertBefore(head(p.uuid, 20), li.firstChild);
          list.appendChild(li);
        });
      }
      if (stats.length) {
        list.appendChild(heading('Stats', 'st-ac-group'));
        const order = [], byKey = {};
        stats.forEach(s => {
          if (!byKey[s.key]) { byKey[s.key] = []; order.push(s.key); }
          byKey[s.key].push(s.category);
        });
        const lab = (c, k) => (S.fmt ? S.fmt.statLabel(c, k) : { cat: c, name: k, full: c + ' · ' + k });
        const iid = k => (S.fmt ? S.fmt.itemId(k) : String(k).replace(/^.*:/, ''));
        order.forEach(k => {
          const cats = byKey[k];
          if (cats.length === 1) {
            const l = lab(cats[0], k);
            const li = option({ type: 'stat', category: cats[0], key: k }, '',
              '<span class="st-ac-name">' + esc(l.name) + '</span> <span class="st-ac-meta">' + esc(l.cat) + '</span>');
            li.insertBefore(icon(iid(k), 20), li.firstChild);
            list.appendChild(li);
          } else {
            const h = heading(lab(cats[0], k).name, 'st-ac-key');
            h.insertBefore(icon(iid(k), 20), h.firstChild);
            list.appendChild(h);
            cats.forEach(c => {
              list.appendChild(option({ type: 'stat', category: c, key: k }, 'st-ac-sub',
                '<span class="st-ac-name">' + esc(lab(c, k).cat || c) + '</span>'));
            });
          }
        });
      }
      if (objectives.length) {
        list.appendChild(heading('Objectives', 'st-ac-group'));
        objectives.forEach(o => {
          list.appendChild(option({ type: 'objective', objective: o.objective, servers: o.servers || [] }, '',
            '<span class="st-ac-name">' + esc(o.objective) + '</span>' +
            (o.servers && o.servers.length ? ' <span class="st-ac-meta">' + esc(o.servers.join(', ')) + '</span>' : '')));
        });
      }
      if (!items.length) list.appendChild(heading(opts.noneText || 'No players, stats or objectives match that.', 'st-ac-none'));
      hydrate(list);
      place();
      lift(true);
      show(list, true);
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }
    async function run(q) {
      const my = ++seq;
      let data;
      // ids use _ where labels show spaces: "redstone block" -> redstone_block (names can't hold spaces)
      try { data = await S.api('search', { q: q.replace(/\s+/g, '_'), limit }); } catch (e) { if (my === seq) close(); return; }
      if (my !== seq || input.value.trim() !== q) return;
      render(data);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { seq++; close(); return; }
      timer = setTimeout(() => run(q), 120);
    });
    input.addEventListener('keydown', e => {
      const open = list.style.display !== 'none';
      const n = items.length;
      if (e.key === 'ArrowDown') {
        if (!open || !n) return;
        e.preventDefault(); setActive(active < n - 1 ? active + 1 : 0);
      } else if (e.key === 'ArrowUp') {
        if (!open || !n) return;
        e.preventDefault(); setActive(active > 0 ? active - 1 : n - 1);
      } else if (e.key === 'Enter') {
        if (open && active >= 0) { e.preventDefault(); pick(active); }
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); close(); }
      }
    });
    list.addEventListener('mousedown', e => {
      const li = e.target.closest('[role=option]');
      e.preventDefault();
      if (li) pick(+li.dataset.index);
    });
    input.addEventListener('blur', () => { clearTimeout(timer); seq++; close(); });
    return { close };
  }

  // ---- tabs
  function tabs(el, list, onSelect) {
    el.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'st-tabs';
    bar.setAttribute('role', 'tablist');
    el.appendChild(bar);
    const btns = list.map((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-tab';
      b.id = nextId('tab');
      b.dataset.id = t.id;
      b.setAttribute('role', 'tab');
      b.innerHTML = esc(t.label) + (t.count != null ? '<small class="st-tab-count">' + esc(t.count) + '</small>' : '');
      bar.appendChild(b);
      return b;
    });
    let current = null;
    function select(id, silent) {
      btns.forEach(b => {
        const on = b.dataset.id === id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      const changed = id !== current;
      current = id;
      if (!silent && changed && onSelect) onSelect(id);
    }
    bar.addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) select(b.dataset.id); });
    bar.addEventListener('keydown', e => {
      const i = btns.findIndex(b => b.dataset.id === current);
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % btns.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = btns.length - 1;
      if (j < 0) return;
      e.preventDefault();
      btns[j].focus();
      select(btns[j].dataset.id);
    });
    if (btns.length) select(btns[0].dataset.id, true);
    return {
      select,
      setCount(id, n) {
        const b = btns.find(x => x.dataset.id === id);
        if (!b) return;
        let s = b.querySelector('.st-tab-count');
        if (n == null) { if (s) s.remove(); return; }
        if (!s) { s = document.createElement('small'); s.className = 'st-tab-count'; b.appendChild(s); }
        s.textContent = n;
      },
    };
  }

  // ---- sortable, paged table. rowHtml(row) returns the row's <td> cells.
  // column.sort: true sorts by row[id], a function sorts by its return value; num columns
  // sort descending first, text columns ascending. sortBy: column id; sortDir: "asc"|"desc"
  // overrides that default.
  // ---- pager: "‹ 1 … 39 40 41 … 80 ›" plus "Showing 1,951–2,000 of 4,000". Pages are 1-based.
  // Renders nothing when everything fits on one page. Used by S.ui.table and server-paged lists.
  function pager(el, o) {
    const size = o.pageSize || 50;
    let total = o.total || 0, cur = o.page || 1, nav = null;
    const nf = n => n.toLocaleString('en-GB');
    function pages(last) {
      const want = new Set([1, last, cur - 1, cur, cur + 1].filter(n => n >= 1 && n <= last));
      const out = [];
      let prev = 0;
      Array.from(want).sort((a, b) => a - b).forEach(n => {
        if (n - prev === 2) out.push(prev + 1);          // a gap of one page shows that page
        else if (n - prev > 2) out.push(null);
        out.push(n);
        prev = n;
      });
      return out;
    }
    function render() {
      const last = Math.max(1, Math.ceil(total / size));
      cur = Math.min(Math.max(1, cur), last);
      if (total <= size) { if (nav) { nav.remove(); nav = null; } return; }
      if (!nav) {
        nav = document.createElement('nav');
        nav.className = 'st-pager';
        nav.setAttribute('aria-label', 'Pages');
        nav.addEventListener('click', e => {
          const b = e.target.closest('button[data-page]');
          if (!b || b.disabled) return;
          const n = +b.dataset.page;
          if (n === cur) return;
          cur = n;
          render();
          if (o.onPage) o.onPage(n);
          const top = el.getBoundingClientRect().top;
          if (top < 0 && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
        });
        el.appendChild(nav);
      }
      const from = (cur - 1) * size + 1, to = Math.min(total, cur * size);
      const btn = (n, cls, label, aria) => '<button type="button" class="' + cls + '" data-page="' + n + '"' +
        (aria ? ' aria-label="' + aria + '"' : '') + (n === cur && cls === 'st-pg' ? ' aria-current="page"' : '') +
        ((cls !== 'st-pg' && (n < 1 || n > last)) ? ' disabled' : '') + '>' + label + '</button>';
      nav.innerHTML = '<span class="st-pager-count">Showing ' + nf(from) + '–' + nf(to) + ' of ' + nf(total) + '</span>' +
        '<span class="st-pager-btns">' + btn(cur - 1, 'st-pg-prev', '‹', 'Previous page') +
        pages(last).map(n => n == null ? '<span class="st-pg-gap" aria-hidden="true">…</span>' : btn(n, 'st-pg', String(n))).join('') +
        btn(cur + 1, 'st-pg-next', '›', 'Next page') + '</span>';
    }
    render();
    return {
      set(t, p) { total = t || 0; if (p != null) cur = p; render(); },
      get page() { return cur; },
    };
  }

  // ---- tip: styled tooltip for every [data-tip] inside `root`. Hover or keyboard focus shows it,
  // a tap toggles it (touch), a tap elsewhere / Escape / leaving hides it. One shared bubble.
  let bubble = null, tipFor = null, lastPointer = '', tapWasOpen = false;
  function tipHide() {
    if (!bubble || !tipFor) return;
    tipFor.removeAttribute('aria-describedby');
    tipFor = null;
    bubble.classList.remove('on');
    bubble.hidden = true;
  }
  function tipShow(t) {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'st-bubble';
      bubble.id = 'st-bubble';
      bubble.setAttribute('role', 'tooltip');
      bubble.hidden = true;
      document.body.appendChild(bubble);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') tipHide(); });
      document.addEventListener('pointerdown', e => { if (!e.target.closest || !e.target.closest('[data-tip]')) tipHide(); });
      window.addEventListener('scroll', tipHide, { passive: true });
    }
    if (tipFor && tipFor !== t) tipFor.removeAttribute('aria-describedby');
    tipFor = t;
    bubble.textContent = t.dataset.tip;
    t.setAttribute('aria-describedby', bubble.id);
    bubble.hidden = false;
    const r = t.getBoundingClientRect(), b = bubble.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let top = r.top - b.height - 8;
    if (top < 8) top = r.bottom + 8;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), vw - b.width - 8);
    bubble.style.top = Math.round(top) + 'px';
    bubble.style.left = Math.round(Math.max(8, left)) + 'px';
    requestAnimationFrame(() => { if (tipFor === t) bubble.classList.add('on'); });
  }
  function tip(root) {
    if (!root || root.dataset.stTip) return;
    root.dataset.stTip = '1';
    const at = e => e.target.closest && e.target.closest('[data-tip]');
    root.addEventListener('pointerover', e => { const t = at(e); if (t && e.pointerType === 'mouse') tipShow(t); });
    root.addEventListener('pointerout', e => {
      const t = at(e);
      if (t && e.pointerType === 'mouse' && t === tipFor && !t.contains(e.relatedTarget) && document.activeElement !== t) tipHide();
    });
    root.addEventListener('focusin', e => { const t = at(e); if (t) tipShow(t); });
    root.addEventListener('focusout', e => { const t = at(e); if (t && t === tipFor) tipHide(); });
    root.addEventListener('pointerdown', e => { lastPointer = e.pointerType; const t = at(e); tapWasOpen = !!t && t === tipFor; });
    root.addEventListener('click', e => {
      const t = at(e);
      if (!t || lastPointer !== 'touch') return;
      if (tapWasOpen) tipHide(); else tipShow(t);
    });
  }

  function table(el, o) {
    const columns = o.columns || [];
    const pageSize = o.pageSize || 50;
    let rows = (o.rows || []).slice();
    let page = 1;
    let sortId = null, sortDir = 1;
    if (o.sortBy) {
      const c = columns.find(x => x.id === o.sortBy);
      if (c) {
        sortId = c.id;
        sortDir = o.sortDir === 'asc' ? 1 : o.sortDir === 'desc' ? -1 : c.num ? -1 : 1;
      }
    }

    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'st-table-wrap';
    const t = document.createElement('table');
    t.className = 'st-table';
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const htr = document.createElement('tr');
    columns.forEach(c => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.dataset.col = c.id;
      if (c.num) th.className = 'st-num';
      if (c.sort) {
        th.innerHTML = '<button type="button" class="st-sort">' + esc(c.label) + '<span class="st-sort-ind" aria-hidden="true"></span></button>';
      } else th.textContent = c.label;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead); t.appendChild(tbody);
    wrap.appendChild(t);
    el.appendChild(wrap);
    const pg = pager(el, { total: 0, pageSize, page: 1, onPage: n => { page = n; paint(); } });

    function sortVal(c, r) { return typeof c.sort === 'function' ? c.sort(r) : r[c.id]; }
    function applySort() {
      if (!sortId) return;
      const c = columns.find(x => x.id === sortId);
      if (!c) return;
      const decorated = rows.map((r, i) => [sortVal(c, r), i, r]);
      decorated.sort((a, b) => {
        const x = a[0], y = b[0];
        const xn = x === null || x === undefined || x === '', yn = y === null || y === undefined || y === '';
        if (xn || yn) return xn && yn ? a[1] - b[1] : xn ? 1 : -1;  // blanks last either way
        let d;
        if (typeof x === 'number' && typeof y === 'number') d = x - y;
        else d = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return d * sortDir || a[1] - b[1];
      });
      rows = decorated.map(d => d[2]);
    }
    function paintHead() {
      htr.querySelectorAll('th').forEach(th => {
        const on = th.dataset.col === sortId;
        if (on) th.setAttribute('aria-sort', sortDir < 0 ? 'descending' : 'ascending');
        else th.removeAttribute('aria-sort');
        const ind = th.querySelector('.st-sort-ind');
        if (ind) ind.textContent = on ? (sortDir < 0 ? ' ▾' : ' ▴') : '';
      });
    }
    function paint() {
      const start = (page - 1) * pageSize;
      tbody.innerHTML = rows.slice(start, start + pageSize).map((r, i) =>
        '<tr data-i="' + (start + i) + '"' + (o.onRow ? ' class="st-row-link" tabindex="0"' : '') + '>' + o.rowHtml(r) + '</tr>').join('');
      hydrate(tbody);
      pg.set(rows.length, page);
      paintHead();
    }
    htr.addEventListener('click', e => {
      const b = e.target.closest('.st-sort');
      if (!b) return;
      const id = b.parentNode.dataset.col;
      const c = columns.find(x => x.id === id);
      if (id === sortId) sortDir = -sortDir;
      else { sortId = id; sortDir = c.num ? -1 : 1; }
      page = 1;
      applySort();
      paint();
    });
    if (o.onRow) {
      const act = e => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr || e.target.closest('a, button')) return;
        o.onRow(rows[+tr.dataset.i]);
      };
      tbody.addEventListener('click', act);
      tbody.addEventListener('keydown', e => { if (e.key === 'Enter') act(e); });
    }
    applySort();
    paint();
    return {
      setRows(next) { rows = (next || []).slice(); page = 1; applySort(); paint(); },
      page(n) { page = n; paint(); },
    };
  }

  function empty(el, text) { el.innerHTML = '<div class="st-empty">' + esc(text) + '</div>'; }
  function error(el, err) {
    const msg = S.errorText ? S.errorText(err) : "Couldn't load stats. Try again in a minute.";
    el.innerHTML = '<div class="panel err" role="alert">' + esc(msg) + '</div>';
  }

  S.ui = { head, icon, headHtml, iconHtml, hydrate, controls, autocomplete, tabs, table, pager, tip, empty, error,
           splitScopes, dayStart, dayEnd };
  if (typeof module !== 'undefined') module.exports = S.ui;
})(typeof window !== 'undefined' ? window : globalThis);
