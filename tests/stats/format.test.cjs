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
