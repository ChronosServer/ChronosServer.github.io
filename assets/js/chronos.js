(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // fetch JSON, return the data plus when the file was last written (Last-Modified)
  async function json(url) {
    const r = await fetch(url, {cache: 'no-cache'});
    if (!r.ok) throw new Error(url + ' returned HTTP ' + r.status);
    const lm = r.headers.get('Last-Modified');
    return {data: await r.json(), at: lm ? new Date(lm) : null};
  }
  function ago(d) {
    if (!d) return 'at an unknown time';
    const s = (Date.now() - d) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function stamp(el, at, maxHours = 12) {
    const stale = at && (Date.now() - at) / 36e5 > maxHours;
    el.className = 'pill' + (stale ? ' stale' : '');
    el.textContent = (stale ? 'Stale, synced ' : 'Synced ') + ago(at);
  }
  function fail(el, e) {
    el.innerHTML = '<div class="panel err">Could not load data. ' + esc(e.message) + '</div>';
  }
  window.C = {esc, json, ago, stamp, fail};
})();
