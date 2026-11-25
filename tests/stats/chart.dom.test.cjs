const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const JS = path.join(__dirname, '..', '..', 'assets', 'js', 'stats');
const DAY = 86400, T0 = 1795528256 - 20 * DAY;
let browser, page;

before(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage(); });
after(async () => { if (browser) await browser.close(); });

// Fresh page with the three scripts; `optsSrc` is evaluated in the page so it can carry functions.
async function mount(optsSrc) {
  await page.setContent('<div id=c style="width:800px"></div>');
  for (const f of ['format.js', 'chartmath.js', 'chart.js']) await page.addScriptTag({ path: path.join(JS, f) });
  await page.evaluate(src => { window.chartInst = S.chart(document.getElementById('c'), (0, eval)('(' + src + ')')); }, optsSrc);
}
const base = (series, extra = '') =>
  `{from:${T0}, to:${T0 + 10 * DAY}, liveAt:null, format: v => v + ' u', emptyText:'Nothing tracked yet', series:${series}${extra}}`;

test('renders one path per non-empty series', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'var(--teal)',points:[[${T0},0],[${T0 + DAY},5],[${T0 + 3 * DAY},9]]},
                     {id:'b',label:'CMPs',color:'#c9b37e',points:[[${T0 + 2 * DAY},2],[${T0 + 4 * DAY},4]]},
                     {id:'c',label:'None',color:'red',points:[]}]`));
  assert.equal(await page.locator('#c path.st-line').count(), 2);
  const ds = await page.$$eval('#c path', ps => ps.map(p => p.getAttribute('d')));
  for (const d of ds) { assert.ok(d && d.length > 0); assert.ok(!d.includes('NaN'), d); }
  assert.ok(!(await page.innerHTML('#c')).includes('NaN'));
});

test('empty series shows emptyText', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[]},{id:'b',label:'CMPs',color:'red',points:[]}]`));
  assert.equal(await page.textContent('#c .st-empty'), 'Nothing tracked yet');
  assert.equal(await page.locator('#c svg').count(), 0);
});

test('single point renders value card', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0 + DAY},1234]]},{id:'b',label:'CMPs',color:'red',points:[]}]`));
  const card = await page.textContent('#c .st-valuecard');
  assert.ok(card.includes('1234 u'), card);
  assert.equal(await page.locator('#c path.st-line').count(), 0);
});

test('split axis draws backups zone', async () => {
  const series = `[{id:'a',label:'SMP',color:'teal',points:[[${T0},3],[${T0 + 2 * DAY},5],[${T0 + 9 * DAY},8]]}]`;
  await mount(base(series, `, liveAt:${T0 + 8 * DAY}`));
  assert.equal(await page.locator('#c rect.st-zone').count(), 1);
  assert.equal(await page.locator('#c circle.st-dot').count(), 2);
  await mount(base(series));
  assert.equal(await page.locator('#c rect.st-zone').count(), 0);
  assert.equal(await page.locator('#c circle.st-dot').count(), 0);
});

test('hover shows tooltip', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},10],[${T0 + DAY},20]]},
                     {id:'b',label:'CMPs',color:'red',points:[[${T0},1],[${T0 + 2 * DAY},7]]}]`));
  const box = await page.locator('#c svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  const tip = page.locator('#c .st-tip');
  assert.ok(await tip.isVisible());
  const text = await tip.textContent();
  assert.match(text, /\d{1,2} [A-Z][a-z]{2} \d{4}/);
  for (const s of ['SMP', '20 u', 'CMPs', '7 u']) assert.ok(text.includes(s), text);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  assert.ok(!(await tip.isVisible()));
});

test('keyboard steps through change points', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0 + DAY},1],[${T0 + 3 * DAY},2],[${T0 + 5 * DAY},3]]},
                     {id:'b',label:'CMPs',color:'red',points:[[${T0 + 2 * DAY},4],[${T0 + 4 * DAY},5]]}]`));
  assert.equal(await page.getAttribute('#c svg', 'tabindex'), '0');
  await page.focus('#c svg');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const expected = await page.evaluate(t => S.fmt.date(t), T0 + 2 * DAY);
  const text = await page.textContent('#c .st-tip');
  assert.ok(text.includes(expected), text + ' vs ' + expected);
  assert.ok(text.includes('4 u'), text);
  await page.keyboard.press('End');
  assert.ok((await page.textContent('#c .st-tip')).includes(await page.evaluate(t => S.fmt.date(t), T0 + 5 * DAY)));
});

test('hostile labels are escaped', async () => {
  await mount(base(`[{id:'a',label:'<img src=x onerror=window.pwned=1>',color:'teal',points:[[${T0},1],[${T0 + DAY},2]]}]`));
  const box = await page.locator('#c svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  assert.equal(await page.locator('#c img').count(), 0);
  assert.ok((await page.textContent('#c .st-tip')).includes('<img'));
});

test('leading zeros are trimmed before the value-card check', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},0],[${T0 + DAY},5]]},
                     {id:'b',label:'CMPs',color:'red',points:[[${T0},0],[${T0 + DAY},0],[${T0 + 2 * DAY},0]]}]`));
  const card = await page.textContent('#c .st-valuecard');
  assert.ok(card.includes('5 u') && card.includes('0 u'), card);
  assert.equal(await page.locator('#c path.st-line').count(), 0);
});

test('series that trim to one point still draw as lines beside a real series', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},0],[${T0 + DAY},5]]},
                     {id:'b',label:'CMPs',color:'red',points:[[${T0},1],[${T0 + 2 * DAY},3]]}]`));
  assert.equal(await page.locator('#c .st-valuecard').count(), 0);
  assert.equal(await page.locator('#c path.st-line').count(), 2);
});

test('tooltip hides inline even when a stylesheet sets its display', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},1],[${T0 + DAY},2]]}]`));
  await page.addStyleTag({ content: '.st-tip{display:block}' });
  const tip = page.locator('#c .st-tip');
  assert.ok(!(await tip.isVisible()));
  const box = await page.locator('#c svg').boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  assert.ok(await tip.isVisible());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 200);
  assert.ok(!(await tip.isVisible()));
});

test('update keeps keyboard focus on the chart', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},1],[${T0 + DAY},2]]}]`));
  await page.focus('#c svg');
  await page.evaluate(t => chartInst.update({ series: [{ id: 'a', label: 'SMP', color: 'teal', points: [[t, 3], [t + 86400, 4]] }] }), T0);
  assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('#c svg')));
});

test('update re-renders and destroy cleans up', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},1],[${T0 + DAY},2]]}]`));
  await page.evaluate(() => chartInst.update({ series: [] }));
  assert.equal(await page.locator('#c .st-empty').count(), 1);
  await page.evaluate(() => chartInst.destroy());
  assert.equal(await page.innerHTML('#c'), '');
});

test('viewBox width follows the container so axis text keeps its size on phones', async () => {
  await mount(base(`[{id:'a',label:'SMP',color:'teal',points:[[${T0},1],[${T0 + 3 * DAY},2],[${T0 + 6 * DAY},5]]}]`));
  const vbWidth = () => page.$eval('#c svg', s => +s.getAttribute('viewBox').split(' ')[2]);
  assert.equal(await vbWidth(), 800);
  await page.$eval('#c', el => { el.style.width = '390px'; });
  await page.waitForFunction(() => document.querySelector('#c svg').getAttribute('viewBox').split(' ')[2] === '390');
  const box = await page.locator('#c svg').boundingBox();
  assert.ok(Math.abs(box.width - 390) < 1, String(box.width));
  // one viewBox unit is one CSS px: the label renders at its CSS font size, not scaled down
  const h = await page.$eval('#c text.st-axis', t => t.getBoundingClientRect().height);
  assert.ok(h > 8, 'axis text height ' + h);
  const ds = await page.$$eval('#c path', ps => ps.map(p => p.getAttribute('d')));
  for (const d of ds) assert.ok(!d.includes('NaN'), d);
});

test('ranged chart raises the y axis to nice display-unit ticks; all-time keeps 0', async () => {
  const H = 72000;
  const series = `[{id:'a',label:'SMP',color:'teal',points:[[${T0 - 5 * DAY},${41700 * H}],[${T0 + DAY},${41750 * H}],[${T0 + 5 * DAY},${41820 * H}]]}]`;
  const axis = `, axis: m => S.fmt.axisUnit('minecraft:custom','minecraft:play_time', m)`;
  await mount(base(series, axis + ', zero:false'));
  const labels = () => page.$$eval('#c text.st-axis[text-anchor=end]', ts => ts.map(t => t.textContent));
  let ys = await labels();
  assert.ok(!ys.includes('0'), ys.join(' | '));
  assert.ok(ys.includes('41,800 h'), ys.join(' | '));
  const ds = await page.$$eval('#c path', ps => ps.map(p => p.getAttribute('d')));
  for (const d of ds) assert.ok(!d.includes('NaN'), d);
  // nothing is drawn below the plot area
  const maxY = await page.$eval('#c path.st-line', p => Math.max(...p.getAttribute('d').match(/V[\d.]+|,[\d.]+/g).map(s => +s.slice(1))));
  assert.ok(maxY <= 300 - 26 + 0.5, String(maxY));
  await mount(base(series, axis));
  ys = await labels();
  assert.equal(ys[0], '0');
  assert.ok(ys.every(l => l === '0' || / h$/.test(l)), ys.join(' | '));
});
