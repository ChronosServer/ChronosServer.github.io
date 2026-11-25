#!/usr/bin/env node
/* Smoke check for the Stats pages: loads each page at desktop and phone width through the
 * dev server, fails on console errors, page errors and same-origin HTTP errors, and saves
 * screenshots to %TEMP%/stats-shots/<slug>-<width>.png.
 *
 *   node tools/check_stats.cjs [baseUrl] [--base URL] [--only /stats/,/stats/player/?p=x]
 *   (Git Bash mangles a lone "/stats/" argument: run it as MSYS_NO_PATHCONV=1 node ...)
 *
 * Base URL defaults to http://localhost:4000 (python tools/dev_server.py).
 * Playwright is global: set NODE_PATH to the output of `npm root -g`.
 *
 * Not failures: /cache/items/ 404s (missing item icons are expected), errors from the
 * third-party head services (crafatar.com, mc-heads.net), and API 404s on pages whose URL
 * contains "p=" or "players=" (an unknown player is a valid state).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const PAGES = ['/stats/', '/stats/explorer/', '/stats/scoreboards/', '/stats/player/', '/stats/compare/', '/stats/milestones/'];
const SIZES = [{ width: 1400, height: 900 }, { width: 390, height: 844 }];
const HEAD_HOSTS = /(^|\.)(crafatar\.com|mc-heads\.net)$/i;

function parseArgs(argv) {
  let base = 'http://localhost:4000', only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') only = argv[++i];
    else if (a.startsWith('--only=')) only = a.slice(7);
    else if (a === '--base') base = argv[++i];
    else if (a.startsWith('--base=')) base = a.slice(7);
    else if (!a.startsWith('--')) base = a;
    else throw new Error('Unknown option ' + a);
  }
  if (only === undefined || only === '') throw new Error('--only needs a comma-separated list of paths');
  // split on commas that start a new path, so query strings like ?players=a,b stay whole
  const pages = only ? only.split(/,(?=\/)/).map(s => s.trim()).filter(Boolean) : PAGES;
  const bad = pages.find(p => !p.startsWith('/'));
  // Git Bash rewrites a lone "/stats/" argument into "C:/Program Files/Git/stats/"
  if (bad) throw new Error(`Page paths must start with "/" (got "${bad}"). In Git Bash, prefix the command with MSYS_NO_PATHCONV=1.`);
  return { base: base.replace(/\/+$/, ''), pages };
}

const slug = p => p.replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';

function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }

// Is a failed request one we expect and ignore?
function expected(url, status, pageUrl, origin) {
  if (HEAD_HOSTS.test(hostOf(url))) return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== origin) return true;               // only same-origin responses are checked
  if (status === 404 && u.pathname.startsWith('/cache/items/')) return true;
  if (status === 404 && u.pathname.startsWith('/api/') && /[?&](p|players)=/.test(pageUrl)) return true;
  return false;
}

async function checkPage(browser, base, p, size, outDir) {
  const origin = new URL(base).origin;
  const pageUrl = base + p;
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  const failedUrls = new Set();   // responses we already judged, so their console echo is not double counted

  page.on('response', r => {
    const s = r.status();
    if (s < 400) return;
    if (expected(r.url(), s, pageUrl, origin)) { failedUrls.add(r.url()); return; }
    problems.push(`HTTP ${s} ${r.url()}`);
    failedUrls.add(r.url());
  });
  page.on('requestfailed', r => {
    if (failedUrls.has(r.url()) || HEAD_HOSTS.test(hostOf(r.url())) || new URL(r.url()).origin !== origin) return;
    problems.push(`request failed ${r.url()} (${(r.failure() || {}).errorText || 'unknown'})`);
  });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() || {}).url || '';
    // "Failed to load resource" errors carry the resource URL; those are judged by the response handler
    if (/Failed to load resource/i.test(m.text()) && (failedUrls.has(loc) || HEAD_HOSTS.test(hostOf(loc)) ||
        expected(loc, 404, pageUrl, origin))) return;
    if (HEAD_HOSTS.test(hostOf(loc))) return;
    problems.push(`console: ${m.text()}${loc ? ' (' + loc + ')' : ''}`);
  });
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));

  let status = 0;
  try {
    const res = await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
    status = res ? res.status() : 0;
    await page.waitForTimeout(400);   // let entrance animations and late renders settle
  } catch (e) {
    problems.push(`navigation: ${e.message.split('\n')[0]}`);
  }
  const file = path.join(outDir, `${slug(p)}-${size.width}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { problems.push(`screenshot: ${e.message}`); }
  await ctx.close();
  return { status, problems, file };
}

async function main() {
  const { base, pages } = parseArgs(process.argv.slice(2));
  const outDir = path.join(os.tmpdir(), 'stats-shots');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const p of pages) {
      const results = [];
      for (const size of SIZES) results.push({ size, ...(await checkPage(browser, base, p, size, outDir)) });
      const bad = results.filter(r => r.problems.length);
      const ok = !bad.length;
      if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}  [${results.map(r => r.size.width + ':' + r.status).join(' ')}]`);
      for (const r of bad) for (const msg of [...new Set(r.problems)]) console.log(`      ${r.size.width}px  ${msg}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`${pages.length - failed}/${pages.length} pages passed. Screenshots: ${outDir}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.error(e.stack || String(e)); process.exitCode = 1; });
