const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const JS = path.join(__dirname, '..', '..', 'assets', 'js', 'stats');
let browser, page;
before(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage(); });
after(async () => { if (browser) await browser.close(); });

async function mount(code) {
  await page.setContent('<div id=c></div><div id=h></div>');
  await page.addScriptTag({ path: path.join(JS, 'viz.js') });
  await page.evaluate(code);
}
const HOURS = '(()=>{const h=new Array(24).fill(0);h[21]=3.4;h[10]=1;return h})()';
const GRID = '(()=>{const g=Array.from({length:7},()=>new Array(24).fill(0));g[2][21]=3.4;g[0][10]=1;return g})()';

test('clock renders 24 hour segments with a label', async () => {
  await mount(`S.viz.clock(document.getElementById('c'), ${HOURS}, {now:new Date(2026,10,25,9)})`);
  assert.equal(await page.locator('#c .st-clock-seg').count(), 24);
  assert.equal(await page.getAttribute('#c svg', 'role'), 'img');
  assert.equal(await page.getAttribute('#c svg', 'aria-label'), 'Busiest hour: 21:00, 3.4 players on average');
  assert.ok(!(await page.innerHTML('#c')).includes('NaN'));
});

test('heatmap renders 7x24 cells with titles', async () => {
  await mount(`S.viz.heatmap(document.getElementById('c'), ${GRID})`);
  assert.equal(await page.locator('#c rect.st-heat-cell').count(), 168);
  assert.equal(await page.locator('#c rect.st-heat-cell > title').count(), 168);
  assert.equal((await page.locator('#c .st-heat-day').allTextContents()).join(), 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
  assert.equal(await page.getAttribute('#c svg', 'role'), 'img');
});

test('all-zero input renders without NaN', async () => {
  await mount(`const z=new Array(24).fill(0);S.viz.clock(document.getElementById('c'), z, {now:new Date()});
    S.viz.heatmap(document.getElementById('h'), Array.from({length:7},()=>z.slice()))`);
  assert.equal(await page.locator('#c .st-clock-seg').count(), 24);
  assert.equal(await page.locator('#h rect.st-heat-cell').count(), 168);
  assert.ok(!(await page.innerHTML('body')).includes('NaN'));
});

test('module loads in node without document', () => {
  const v = require('../../assets/js/stats/viz.js');
  assert.equal(typeof v.clock, 'function');
});
