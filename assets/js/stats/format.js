(function (root) {
  const S = root.S = root.S || {};

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const CATEGORY = { mined: 'Mined', used: 'Used', crafted: 'Crafted', broken: 'Broken', picked_up: 'Picked up', dropped: 'Dropped', killed: 'Killed', killed_by: 'Killed by', custom: '' };
  const VERB = { mined: 'mined', used: 'used', crafted: 'crafted', broken: 'broken', picked_up: 'picked up', dropped: 'dropped', killed: 'killed', killed_by: 'been killed by' };
  // "was the first to <infinitive> sponge"
  const INFINITIVE = { mined: 'mine', used: 'use', crafted: 'craft', broken: 'break', picked_up: 'pick up', dropped: 'drop', killed: 'kill', killed_by: 'be killed by' };
  const MINUS = '−';
  const NOUN = { mined: 'Miner', used: 'Builder', crafted: 'Crafter', broken: 'Toolbreaker', picked_up: 'Collector', dropped: 'Dropper', killed: 'Hunter', killed_by: 'Victim' };
  const HEADLINES = [
    ['minecraft:custom', 'minecraft:play_time', 'Hours played'],
    ['minecraft:custom', 'minecraft:walk_one_cm', 'Distance walked'],
    ['minecraft:custom', 'minecraft:mob_kills', 'Mobs killed'],
    ['minecraft:custom', 'minecraft:deaths', 'Deaths']
  ];
  const TICK_KEYS = ['play_time', 'total_world_time', 'time_since_death', 'time_since_rest', 'sneak_time'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ROMAN = ['I', 'II', 'III'];
  // Category pictures, chosen by the owner (curated like HEADLINES). A value starting with "/"
  // is a site image; anything else is an item id under /cache/items/.
  const CAT_ICON = { broken: '/assets/img/cat-broken.png', crafted: 'crafting_table', custom: 'player_head', dropped: 'dirt',
    killed: 'diamond_sword', killed_by: 'creeper_spawn_egg', mined: 'diamond_pickaxe', picked_up: 'netherrack', used: 'firework_rocket' };
  const catIcon = (category) => CAT_ICON[itemId(category)] || null;

  const itemId = (key) => String(key == null ? '' : key).replace(/^[^:]*:/, '');
  const sentence = (s) => { s = s.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
  const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const catName = (cat) => {
    const k = itemId(cat);
    return Object.prototype.hasOwnProperty.call(CATEGORY, k) ? CATEGORY[k] : titleCase(k);
  };
  const group = (n) => n.toLocaleString('en-US');
  const trim = (s) => s.indexOf('.') === -1 ? s : s.replace(/\.?0+$/, '');

  // Negatives get a real minus sign (U+2212); a value that rounds to 0 shows as "0".
  function compact(n) {
    if (n < 0) { const r = compact(-n); return r === '0' ? r : MINUS + r; }
    const a = Math.abs(n);
    if (a < 1e4) return group(Math.round(n));
    const units = [[1e3, 'K', 1], [1e6, 'M', 1], [1e9, 'B', 2]];
    let i = a < 1e6 ? 0 : a < 1e9 ? 1 : 2;
    let s = (n / units[i][0]).toFixed(units[i][2]);
    if (i < 2 && Math.abs(parseFloat(s)) >= 1000) { i++; s = (n / units[i][0]).toFixed(units[i][2]); }
    return trim(s) + units[i][1];
  }

  function display(category, key, raw) {
    if (raw < 0) {
      const d = display(category, key, -raw);
      const neg = t => (/^0( |$)/.test(t) ? t : MINUS + t);
      return { text: neg(d.text), exact: neg(d.exact) };
    }
    const k = itemId(key);
    const isCustom = itemId(category) === 'custom';
    if (isCustom && /_one_cm$/.test(k)) {
      const m = raw / 100;
      if (m >= 1000) return { text: compact(Math.round(raw / 1e5)) + ' km', exact: group(Math.round(raw / 1e4) / 10) + ' km' };
      return { text: Math.round(m) + ' m', exact: group(Math.round(m * 10) / 10) + ' m' };
    }
    if (isCustom && TICK_KEYS.indexOf(k) !== -1) {
      const h = raw / 72000;
      const exact = group(Math.round(h * 10) / 10) + ' h';
      if (h < 1 && Math.round(raw / 1200) < 60) return { text: Math.round(raw / 1200) + ' min', exact };
      if (h < 1) return { text: '1 h', exact };
      return { text: compact(Math.round(h)) + ' h', exact };
    }
    if (isCustom && /^damage_/.test(k)) return { text: compact(raw / 10), exact: group(Math.round(raw) / 10) };
    return { text: compact(raw), exact: group(raw) };
  }

  // A change with an explicit sign: "+3 h", "−3", "0".
  function signed(category, key, raw) {
    const d = display(category, key, raw);
    return raw > 0 && !/^0( |$)/.test(d.text) ? { text: '+' + d.text, exact: '+' + d.exact } : d;
  }

  // The display unit for a chart axis whose values reach `maxAbs` (raw): divide raw values by
  // `div`, append `suffix`. minStep 1 keeps whole-number units on whole-number ticks.
  function axisUnit(category, key, maxAbs) {
    const k = itemId(key);
    const isCustom = itemId(category) === 'custom';
    const m = Math.abs(maxAbs) || 0;
    if (isCustom && /_one_cm$/.test(k)) return m / 100 >= 1000 ? { div: 1e5, suffix: ' km', minStep: 0 } : { div: 100, suffix: ' m', minStep: 1 };
    if (isCustom && TICK_KEYS.indexOf(k) !== -1) return m < 72000 ? { div: 1200, suffix: ' min', minStep: 1 } : { div: 72000, suffix: ' h', minStep: 0 };
    if (isCustom && /^damage_/.test(k)) return { div: 10, suffix: '', minStep: 0 };
    return { div: 1, suffix: '', minStep: 1 };
  }

  // Axis tick label in display units. The unit (none / K / M / B) and the decimals come from
  // the axis as a whole: `maxAbs` (the largest |tick|) and `step`, so every label on one axis
  // shares them and neighbouring ticks never read the same: 41,800 h; 55.05M; 1.001B.
  function tick(v, step, suffix, maxAbs) {
    if (v === 0) return '0';
    if (v < 0) return MINUS + tick(-v, step, suffix, maxAbs);
    const m = Math.max(Math.abs(maxAbs || 0), v);
    // decimals that show a multiple of x exactly (2.5 -> 1, 0.05 -> 2)
    const dec = x => { let d = 0; while (d < 9 && Math.abs(x * Math.pow(10, d) - Math.round(x * Math.pow(10, d))) > 1e-6) d++; return d; };
    const plain = () => { const d = dec(step); return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + (suffix || ''); };
    if (m < 1e5) return plain();
    const u = m < 1e6 ? [1e3, 'K'] : m < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
    const d = dec(step / u[0]);
    if (u[1] === 'K' && d > 0) return plain();   // "416,341" reads better than "416.341K"
    return (v / u[0]).toFixed(d) + u[1] + (suffix || '');
  }

  function statLabel(category, key) {
    if (category == null || category === 'scoreboard') return { cat: '', name: key, full: key };
    const name = sentence(itemId(key));
    const cat = catName(category);
    return { cat, name, full: cat ? cat + ' · ' + name : name };
  }

  function playerName(p) { return p.name ? p.name : String(p.uuid).slice(0, 8); }

  // Viewer's local time zone, en-GB short ("24 Nov 2026"); manual so ICU "Sept" never appears.
  function date(unix) {
    const d = new Date(unix * 1000);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function when(row) {
    if (row.earliest_known) return { kind: 'earliest', text: '' };
    if (row.approximate) return { kind: 'by', text: 'by ' + date(row.at) };
    return { kind: 'exact', text: date(row.at) };
  }

  // Same wording as the site's C.ago.
  function ago(unix) {
    const s = Math.max(0, Date.now() / 1000 - unix);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function badge(badgeKey, badges) {
    badges = badges || {};
    const parts = String(badgeKey).split(':');
    const fam = parts[0];
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    const tiered = (list, names, generic, art, desc) => {
      const n = Number(parts[1]);
      const i = (list || []).indexOf(n);
      return { name: i < 0 ? (generic) : (names[i] || generic), family: fam, tier: i < 0 ? 0 : i + 1, art, desc: desc(n) };
    };
    if (fam === 'firsts') return tiered(badges.firsts, ['Trailblazer', 'Pioneer', 'Founder'], 'Firsts', 'spyglass', (n) => plural(n, 'real first') + ' on this server');
    if (fam === 'top1') return tiered(badges.top1, ['Champion', 'Dominator', 'Legend'], 'Number one', 'gold_block', (n) => '#1 in ' + plural(n, 'stat') + ' at once');
    if (fam === 'milestone') return tiered(badges.big_numbers, ['Millionaire', 'Ten-Millionaire'], 'Big number', 'experience_bottle', (n) => 'One stat past ' + compact(n));
    if (fam === 'cat') {
      const t = Number(parts[parts.length - 1]);
      const cat = parts.slice(1, -1).join(':');
      const k = itemId(cat);
      const ok = t === 1 || t === 2 || t === 3;
      const noun = NOUN[k] || titleCase(k);
      const thr = (badges.category_tiers || [])[t - 1];
      return {
        name: ok ? noun + ' ' + ROMAN[t - 1] : noun, family: 'cat', tier: ok ? t : 0, art: catIcon(cat),
        desc: catName(cat) + ' total' + (thr != null ? ' ≥ ' + compact(thr) : '')
      };
    }
    if (fam === 'veteran') return { name: 'Veteran', family: fam, tier: 1, art: null, desc: group(badges.veteran_hours || 1000) + ' h played' };
    if (fam === 'regular') { const r = badges.regular || {}; return { name: 'Regular', family: fam, tier: 1, art: null, desc: 'Active on ' + (r.days || 20) + ' of the last ' + (r.window_days || 30) + ' days' }; }
    if (fam === 'night_owl') { const o = badges.night_owl || {}; return { name: 'Night Owl', family: fam, tier: 1, art: null, desc: 'Mostly plays ' + (o.start_hour != null ? o.start_hour : 0) + ':00–' + (o.end_hour != null ? o.end_hour : 6) + ':00' }; }
    if (fam === 'overtaker') return { name: 'Overtaker', family: fam, tier: 1, art: null, desc: 'Passed the player above in a rivalry' };
    return { name: titleCase(String(badgeKey)), family: fam, tier: 0, art: null, desc: '' };
  }

  function spotlight(spot, serverLabel) {
    if (!spot || !spot.trigger) return '';
    const d = spot.detail || {};
    const isCustom = itemId(spot.category) === 'custom';
    const thing = esc(statLabel(spot.category, spot.key).name.toLowerCase());
    const vb = isCustom ? '' : esc(VERB[itemId(spot.category)] || '') + ' ';
    const inf = isCustom ? '' : esc(INFINITIVE[itemId(spot.category)] || 'get') + ' ';
    const holders = Number(d.holders) === 1 ? '1 player has' : esc(d.holders) + ' players have';
    const v = (n) => esc(display(spot.category, spot.key, n).text);
    const name = '<b>' + esc(spot.name) + '</b>';
    const ratio = '<span class="st-num">' + esc(d.ratio) + '×</span>';
    const server = esc(serverLabel);
    switch (spot.trigger) {
      case 'outlier':
        return isCustom
          ? name + '\'s ' + thing + ' is ' + ratio + ' the average player\'s'
          : name + ' has ' + vb + ratio + ' more ' + thing + ' than the average player';
      case 'rare':
        return isCustom
          ? 'Only ' + holders + ' any ' + thing + '. ' + name + ' has ' + v(spot.value) + '.'
          : 'Only ' + holders + ' ever ' + vb + thing + '. ' + name + ' has ' + v(spot.value) + '.';
      case 'recent_milestone':
        return name + ' passed ' + v(d.threshold) + ' ' + thing + ' ' + vb + esc(ago(d.at));
      case 'recent_first':
        return isCustom
          ? name + ' was the first on ' + server + ' to get any ' + thing
          : name + ' was the first on ' + server + ' to ' + inf + thing;
      case 'mover':
        return isCustom
          ? name + '\'s ' + thing + ' went from ' + v(d.from) + ' to ' + v(spot.value) + ' this week'
          : name + ' went from ' + v(d.from) + ' to ' + v(spot.value) + ' ' + thing + ' ' + vb + 'this week';
      default:
        return '';
    }
  }

  S.fmt = { compact, display, signed, axisUnit, tick, INFINITIVE, statLabel, itemId, playerName, date, when, badge, catIcon, spotlight, esc, CATEGORY, VERB, NOUN, HEADLINES };
  if (typeof module !== 'undefined') module.exports = S.fmt;
})(typeof window !== 'undefined' ? window : globalThis);
