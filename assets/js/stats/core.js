(function (root) {
  const S = root.S = root.S || {};

  class ApiError extends Error {
    constructor(message, status, kind) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.kind = kind;
    }
  }

  // Callers must encodeURIComponent any path segment they build into `path`.
  async function api(path, params) {
    const q = [];
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v === null || v === undefined || v === '') return;
      q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    const url = '/api/stats/' + path + (q.length ? '?' + q.join('&') : '');
    let res, text;
    try {
      res = await fetch(url);
      text = await res.text();
    } catch (e) {
      throw new ApiError('network error', 0, 'network');
    }
    const type = (res.headers && res.headers.get('content-type')) || '';
    const trimmed = String(text).trim();
    if (!/json/i.test(type) || trimmed.charAt(0) === '<') {
      throw new ApiError('non-JSON response', res.status, 'blocked');
    }
    let body;
    try { body = JSON.parse(trimmed); } catch (e) {
      throw new ApiError('unreadable response', res.status, 'blocked');
    }
    if (!res.ok) {
      const msg = body && typeof body.error === 'string' ? body.error : 'HTTP ' + res.status;
      throw new ApiError(msg, res.status, 'http');
    }
    return body;
  }

  function errorText(err) {
    if (err && err.kind === 'blocked') return "The stats server didn't answer. Try again in a minute.";
    if (err && err.kind === 'http') {
      if (err.status === 404 && /player/i.test(err.message)) {
        return 'No player by that name. Check the spelling or search for them.';
      }
      if (err.status >= 500) return 'The stats server had a problem (HTTP ' + err.status + '). Try again in a minute.';
      return 'The stats server rejected that request (' + err.message + ').';
    }
    return "Couldn't reach the stats server. Check your connection and try again.";
  }

  let metaPromise = null;
  function meta() {
    if (!metaPromise) {
      metaPromise = api('meta');
      metaPromise.catch(() => { metaPromise = null; });
    }
    return metaPromise;
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  let lastDefaults = {};
  const CORE_KEYS = ['scope', 'bots', 'range', 'from', 'to'];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function uint(v) {
    return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
  }

  const state = {
    read(m, extraDefaults) {
      const p = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
      const scopes = (m && m.scopes) || [];
      let scope = p.get('scope');
      if (!scopes.includes(scope)) {
        scope = lsGet('stats.scope');
        if (!scopes.includes(scope)) scope = 'smp';
      }
      const presets = Object.keys((m && m.settings && m.settings.range_presets) || {});
      const r = p.get('range');
      const range = r && (r === 'all' || presets.includes(r)) ? r : null;
      const st = {
        scope,
        bots: p.get('bots') === 'true',
        range,
        from: uint(p.get('from')),
        to: uint(p.get('to')),
      };
      if (st.range || st.from === null || st.to === null || st.from > st.to) { st.from = null; st.to = null; }
      lastDefaults = extraDefaults || {};
      Object.keys(lastDefaults).forEach(k => {
        const d = lastDefaults[k];
        const raw = p.get(k);
        if (raw === null) st[k] = d;
        else if (typeof d === 'boolean') st[k] = raw === 'true';
        else if (typeof d === 'number') { const n = num(raw); st[k] = n === null ? d : n; }
        else st[k] = raw;
      });
      return st;
    },
    write(st, defaults) {
      const defs = defaults || lastDefaults;
      const q = [];
      const add = (k, v) => q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      if (st.scope) add('scope', st.scope);
      if (st.bots) add('bots', 'true');
      if (st.range) add('range', st.range);
      if (!st.range && st.from !== null && st.from !== undefined) add('from', st.from);
      if (!st.range && st.to !== null && st.to !== undefined) add('to', st.to);
      Object.keys(st).forEach(k => {
        if (CORE_KEYS.includes(k)) return;
        const v = st[k];
        if (v === null || v === undefined || v === '' || v === defs[k]) return;
        add(k, v);
      });
      const path = (typeof location !== 'undefined' && location.pathname) || '';
      const hash = (typeof location !== 'undefined' && location.hash) || '';
      try { history.replaceState(null, '', path + (q.length ? '?' + q.join('&') : '') + hash); } catch (e) { /* ignore */ }
      if (st.scope) lsSet('stats.scope', st.scope);
    },
  };

  function scopeInfo(m, scope) {
    const servers = (m && m.servers) || [];
    const groups = m && m.scope_groups;
    if (groups) {
      const keys = servers.map(s => s.key);
      const bots = k => servers.some(s => s.key === k && s.filters_bots);
      if (scope === 'all') {
        const parts = [];
        keys.forEach(k => {
          const g = Object.keys(groups).find(n => groups[n].includes(k));
          const part = g || k;
          if (!parts.includes(part)) parts.push(part);
        });
        return { servers: keys, hasSmp: keys.some(bots), parts };
      }
      if (groups[scope]) {
        const members = groups[scope];
        return { servers: members.slice(), hasSmp: members.some(bots), parts: [scope] };
      }
      return { servers: [scope], hasSmp: bots(scope), parts: [scope] };
    }
    if (scope === 'all') return { servers: null, hasSmp: true, parts: ['all'] };
    const one = servers.find(s => s.key === scope);
    return { servers: one ? [scope] : null, hasSmp: !!(one && one.filters_bots), parts: [scope] };
  }

  function rangeParams(st) {
    if (st.range) return { range: st.range };
    if (st.from !== null && st.from !== undefined && st.to !== null && st.to !== undefined) {
      return { from: st.from, to: st.to };
    }
    return {};
  }

  S.ApiError = ApiError; S.api = api; S.errorText = errorText; S.meta = meta;
  S.state = state; S.scopeInfo = scopeInfo; S.rangeParams = rangeParams;
  if (typeof module !== 'undefined') {
    module.exports = { ApiError, api, errorText, meta, state, scopeInfo, rangeParams };
  }
})(typeof window !== 'undefined' ? window : globalThis);
