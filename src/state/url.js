// @ts-check
// The URL carries the language as a path prefix (/hi/...) and, for now, the relief
// setting. Camera and layers join in Phase 1. History API only.

export const LANGS = ['en', 'hi'];
export const DEFAULT_RELIEF = 12;

export function readUrl(loc = location) {
  const parts = loc.pathname.split('/').filter(Boolean);
  const lang = LANGS.includes(parts[0]) ? parts[0] : null;
  const rest = lang ? parts.slice(1) : parts;
  const q = new URLSearchParams(loc.search);
  const relief = q.has('relief') ? Number(q.get('relief')) : null;
  return { lang, rest, relief: Number.isFinite(relief) ? relief : null };
}

export function buildUrl({ lang, rest = [], relief }) {
  const path = '/' + [lang, ...rest].filter(Boolean).join('/');
  const q = new URLSearchParams();
  if (relief !== undefined && relief !== DEFAULT_RELIEF) q.set('relief', String(relief));
  const s = q.toString();
  return path + (s ? '?' + s : '');
}

/** Keep the URL in step with the store, and the store with back/forward. */
export function syncUrl(store) {
  const write = () => {
    const lang = store.get('lang');
    const relief = store.get('relief');
    const { rest } = readUrl();
    const url = buildUrl({ lang, rest, relief: relief.on ? relief.amount : 0 });
    if (url !== location.pathname + location.search) history.replaceState(null, '', url);
  };
  store.subscribe('lang', write);
  store.subscribe('relief', write);
  window.addEventListener('popstate', () => {
    const u = readUrl();
    if (u.lang) store.set('lang', u.lang);
  });
  write();
}
