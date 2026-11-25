const test = require('node:test');
const assert = require('node:assert/strict');
const { compact, display, statLabel, playerName, when, badge, spotlight } = require('../../assets/js/stats/format.js');

test('compact', () => {
  assert.equal(compact(1552), '1,552'); assert.equal(compact(9999), '9,999');
  assert.equal(compact(20000), '20K'); assert.equal(compact(21700), '21.7K');
  assert.equal(compact(500500), '500.5K'); assert.equal(compact(1e6), '1M');
  assert.equal(compact(55490136), '55.5M'); assert.equal(compact(3460000000), '3.46B');
  assert.equal(compact(0), '0');
});
test('display units', () => {
  assert.equal(display('minecraft:custom','minecraft:play_time',125365377).text, '1,741 h');
  assert.equal(display('minecraft:custom','minecraft:play_time',36000).text, '30 min');
  assert.equal(display('minecraft:custom','minecraft:walk_one_cm',105920516).text, '1,059 km');
  assert.equal(display('minecraft:custom','minecraft:walk_one_cm',45000).text, '450 m');
  assert.equal(display('minecraft:custom','minecraft:damage_dealt',12345).text, '1,235');   // tenths
  assert.equal(display('minecraft:mined','minecraft:stone',1234567).text, '1.2M');
  assert.equal(display('minecraft:mined','minecraft:stone',1234567).exact, '1,234,567');
  assert.equal(display('minecraft:custom','minecraft:sneak_time',72000*20000).text, '20K h');
});
test('labels', () => {
  assert.deepEqual(statLabel('minecraft:used','minecraft:redstone_torch'), {cat:'Used', name:'Redstone torch', full:'Used · Redstone torch'});
  assert.deepEqual(statLabel('minecraft:custom','minecraft:leave_game'), {cat:'', name:'Leave game', full:'Leave game'});
  assert.equal(statLabel(null,'p.bedrock').full, 'p.bedrock');
  assert.equal(playerName({uuid:'b733bdf3-ed4c-48cb', name:null}), 'b733bdf3');
  assert.equal(playerName({uuid:'x', name:'<b>'}), '<b>');            // escaping is the renderer's job
});
test('when', () => {
  assert.deepEqual(when({at:1795528256, earliest_known:0, approximate:1}), {kind:'by', text:'by 24 Nov 2026'});
  assert.deepEqual(when({at:1795528256, earliest_known:1, approximate:0}), {kind:'earliest', text:''});
  assert.deepEqual(when({at:1795528256, earliest_known:0, approximate:0}), {kind:'exact', text:'24 Nov 2026'});
});
test('badges', () => {
  const B = {firsts:[1,10,50], top1:[1,10,50], big_numbers:[1000000,10000000], category_tiers:[100000,1000000,10000000]};
  assert.equal(badge('firsts:10', B).name, 'Pioneer');
  assert.equal(badge('top1:50', B).name, 'Legend');
  assert.equal(badge('milestone:10000000', B).name, 'Ten-Millionaire');
  assert.equal(badge('cat:minecraft:picked_up:3', B).name, 'Collector III');
  assert.equal(badge('cat:minecraft:picked_up:3', B).art, 'hopper');
  assert.equal(badge('veteran', B).name, 'Veteran');
  assert.equal(badge('night_owl', B).name, 'Night Owl');
  assert.equal(badge('firsts:20', B).tier, 0);              // retired tier
  assert.equal(badge('firsts:20', B).name, 'Firsts');
});
test('spotlight escapes and follows templates', () => {
  const s = spotlight({trigger:'outlier', name:'Papi<script>', category:'minecraft:used', key:'minecraft:crimson_hyphae', value:38, detail:{median:2.5, ratio:15.2, holders:18}}, 'CMP');
  assert.ok(s.includes('Papi&lt;script&gt;'));
  assert.equal(s.replace(/<[^>]+>/g,''), 'Papi&lt;script&gt; has used 15.2× more crimson hyphae than the average player');
  assert.equal(spotlight({trigger:'rare', name:'A', category:'minecraft:mined', key:'minecraft:sponge', value:3, detail:{holders:4}}, 'SMP').replace(/<[^>]+>/g,''), 'Only 4 players have ever mined sponge. A has 3.');
  assert.equal(spotlight({trigger:'mover', name:'T', category:'minecraft:custom', key:'minecraft:play_time', value:3473310, detail:{from:2149856, delta:1323454}}, 'CMP').replace(/<[^>]+>/g,''), "T's play time went from 30 h to 48 h this week");
  assert.equal(spotlight({trigger:null}, ''), '');
});
test('badge descs use the live settings shape', () => {
  const B = {veteran_hours:1000, regular:{days:20, window_days:30}, night_owl:{min_buckets:40, window_days:30, share:0.5, start_hour:0, end_hour:6}};
  assert.equal(badge('veteran', B).desc, '1,000 h played');
  assert.equal(badge('regular', B).desc, 'Active on 20 of the last 30 days');
  assert.equal(badge('night_owl', B).desc, 'Mostly plays 0:00–6:00');
  assert.equal(badge('night_owl', {night_owl:{start_hour:1, end_hour:5}}).desc, 'Mostly plays 1:00–5:00');
});
test('review fixes', () => {
  assert.equal(spotlight({trigger:'recent_milestone', name:'A', category:'minecraft:custom', key:'minecraft:play_time', value:1, detail:{threshold:36000000, at:Date.now()/1000}}, 'SMP').replace(/<[^>]+>/g,''), 'A passed 500 h play time just now');
  assert.equal(display('minecraft:custom','minecraft:play_time',71999).text, '1 h');
  assert.equal(display('minecraft:custom','minecraft:play_time',71000).text, '59 min');
  for (const k of ['cat:minecraft:mined:4', 'cat:minecraft:mined:x']) {
    const b = badge(k, {category_tiers:[1,2,3]});
    assert.equal(b.name, 'Miner'); assert.equal(b.tier, 0);
  }
});

// ---- Task 12b
const F = require('../../assets/js/stats/format.js');
test('negatives use a real minus sign', () => {
  assert.equal(compact(-3), '−3');
  assert.equal(compact(-21700), '−21.7K');
  assert.equal(compact(-1552), '−1,552');
  assert.equal(compact(-0.2), '0');
  assert.equal(display('scoreboard', 'digs', -3).text, '−3');
  assert.equal(display('scoreboard', 'digs', -21700).text, '−21.7K');
  assert.equal(display('scoreboard', 'digs', -21700).exact, '−21,700');
  assert.equal(display('minecraft:custom', 'minecraft:play_time', -72000 * 5).text, '−5 h');
  assert.equal(display('minecraft:custom', 'minecraft:walk_one_cm', -45000).text, '−450 m');
  assert.equal(display('minecraft:custom', 'minecraft:walk_one_cm', -105920516).text, '−1,059 km');
});
test('signed shows an explicit + or −', () => {
  assert.equal(F.signed('scoreboard', 'digs', 5).text, '+5');
  assert.equal(F.signed('scoreboard', 'digs', -3).text, '−3');
  assert.equal(F.signed('scoreboard', 'digs', 0).text, '0');
  assert.equal(F.signed('minecraft:custom', 'minecraft:play_time', 72000 * 3).text, '+3 h');
  assert.equal(F.signed('scoreboard', 'digs', -21700).exact, '−21,700');
});
const plain = s => s.replace(/<[^>]+>/g, '');
test('spotlight rare: singular and plural', () => {
  assert.equal(plain(spotlight({ trigger: 'rare', name: 'A', category: 'minecraft:mined', key: 'minecraft:sponge', value: 3, detail: { holders: 1 } }, 'SMP')),
    'Only 1 player has ever mined sponge. A has 3.');
  assert.equal(plain(spotlight({ trigger: 'rare', name: 'A', category: 'minecraft:mined', key: 'minecraft:sponge', value: 3, detail: { holders: 4 } }, 'SMP')),
    'Only 4 players have ever mined sponge. A has 3.');
  assert.equal(plain(spotlight({ trigger: 'rare', name: 'A', category: 'minecraft:custom', key: 'minecraft:bell_ring', value: 3, detail: { holders: 1 } }, 'SMP')),
    'Only 1 player has any bell ring. A has 3.');
});
test('spotlight recent_first uses the infinitive', () => {
  const rf = (cat, key) => plain(spotlight({ trigger: 'recent_first', name: 'A', category: cat, key, value: 1, detail: {} }, 'SMP'));
  assert.equal(rf('minecraft:mined', 'minecraft:sponge'), 'A was the first on SMP to mine sponge');
  assert.equal(rf('minecraft:picked_up', 'minecraft:egg'), 'A was the first on SMP to pick up egg');
  assert.equal(rf('minecraft:killed_by', 'minecraft:warden'), 'A was the first on SMP to be killed by warden');
  assert.equal(rf('minecraft:broken', 'minecraft:shears'), 'A was the first on SMP to break shears');
  assert.equal(F.INFINITIVE.used, 'use');
  assert.equal(F.INFINITIVE.crafted, 'craft');
  assert.equal(F.INFINITIVE.dropped, 'drop');
  assert.equal(F.INFINITIVE.killed, 'kill');
});
test('spotlight mover for a non-custom category', () => {
  assert.equal(plain(spotlight({ trigger: 'mover', name: 'T', category: 'minecraft:mined', key: 'minecraft:stone', value: 50000, detail: { from: 20000, delta: 30000 } }, 'SMP')),
    'T went from 20K to 50K stone mined this week');
});
test('axisUnit follows the display units', () => {
  assert.deepEqual(F.axisUnit('minecraft:custom', 'minecraft:play_time', 72000 * 500), { div: 72000, suffix: ' h', minStep: 0 });
  assert.deepEqual(F.axisUnit('minecraft:custom', 'minecraft:play_time', 1200 * 30), { div: 1200, suffix: ' min', minStep: 1 });
  assert.deepEqual(F.axisUnit('minecraft:custom', 'minecraft:walk_one_cm', 1e8), { div: 1e5, suffix: ' km', minStep: 0 });
  assert.deepEqual(F.axisUnit('minecraft:custom', 'minecraft:walk_one_cm', 50000), { div: 100, suffix: ' m', minStep: 1 });
  assert.deepEqual(F.axisUnit('minecraft:custom', 'minecraft:damage_dealt', 500), { div: 10, suffix: '', minStep: 0 });
  assert.deepEqual(F.axisUnit('minecraft:mined', 'minecraft:stone', 5), { div: 1, suffix: '', minStep: 1 });
  assert.deepEqual(F.axisUnit('scoreboard', 'digs', 5), { div: 1, suffix: '', minStep: 1 });
});
test('tick labels carry the precision of the step', () => {
  assert.equal(F.tick(41800, 200, ' h'), '41,800 h');
  assert.equal(F.tick(42000, 200, ' h'), '42,000 h');
  assert.equal(F.tick(0, 200, ' h'), '0');
  assert.equal(F.tick(2.5, 0.5, ' km'), '2.5 km');
  assert.equal(F.tick(55000000, 1e6, ''), '55M');
  assert.equal(F.tick(55200000, 2e5, ''), '55.2M');
  assert.equal(F.tick(55050000, 5e4, ''), '55.05M');
  assert.equal(F.tick(250000, 50000, ''), '250K');
  assert.equal(F.tick(-300, 100, ''), '−300');
});

// ---- Task 12b review fixes
test('tick: one unit and decimal count per axis, distinct labels', () => {
  const axis = (ticks, step) => { const m = Math.max(...ticks.map(Math.abs)); return ticks.map(t => F.tick(t, step, '', m)); };
  assert.deepEqual(axis([0, 50000, 100000, 150000], 50000), ['0', '50K', '100K', '150K']);
  assert.deepEqual(axis([99980, 99990, 100000], 10), ['99,980', '99,990', '100,000']);
  assert.deepEqual(axis([416341, 416342], 1), ['416,341', '416,342']);
  assert.deepEqual(axis([0, 2.5e6, 5e6, 7.5e6, 1e7], 2.5e6), ['0', '2.5M', '5.0M', '7.5M', '10.0M']);
  assert.deepEqual(axis([0, 250000, 500000], 250000), ['0', '250K', '500K']);
  const b = axis([1e9, 1.001e9, 1.002e9], 1e6);
  assert.deepEqual(b, ['1.000B', '1.001B', '1.002B']);
  const fine = axis([1e9, 1e9 + 2e3, 1e9 + 4e3], 2e3);
  assert.equal(new Set(fine).size, 3, fine.join(' | '));
  assert.deepEqual(axis([41800, 42000], 200), ['41,800', '42,000']);
});
test('signed drops the sign when the value shows as 0', () => {
  assert.equal(F.signed('minecraft:custom', 'minecraft:play_time', 100).text, '0 min');
  assert.equal(F.signed('scoreboard', 'digs', 0.2).text, '0');
  assert.equal(F.signed('scoreboard', 'digs', -0.2).text, '0');
});
