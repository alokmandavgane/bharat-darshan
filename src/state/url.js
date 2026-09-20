// @ts-check
// The URL carries the language as a path prefix (/hi/...), the relief setting and the
// selected unit (?state=kerala). Selection uses replaceState: a tap is not a page.
// Camera and layers join later. History API only.

export const LANGS = ['en', 'hi'];
export const DEFAULT_RELIEF = 12;

export function readUrl(loc = location) {
  const parts = loc.pathname.split('/').filter(Boolean);
  const lang = LANGS.includes(parts[0]) ? parts[0] : null;
  const rest = lang ? parts.slice(1) : parts;
  const q = new URLSearchParams(loc.search);
  const relief = q.has('relief') ? Number(q.get('relief')) : null;
  const state = q.get('state') || null;
  return { lang, rest, relief: Number.isFinite(relief) ? relief : null, state };
}

export function buildUrl({ lang, rest = [], relief, state }) {
  const path = '/' + [lang, ...rest].filter(Boolean).join('/');
  const q = new URLSearchParams();
  if (relief !== undefined && relief !== DEFAULT_RELIEF) q.set('relief', String(relief));
  if (state) q.set('state', state);
  const s = q.toString();
  return path + (s ? '?' + s : '');
}

/** Keep the URL in step with the store, and the store with back/forward. */
export function syncUrl(store) {
  const slugOf = (id) => (id ? store.get('regions')?.byId?.[id]?.slug : null);
  const idOf = (slug) => (slug ? store.get('regions')?.units?.find((u) => u.slug === slug)?.id ?? null : null);
  const write = () => {
    const lang = store.get('lang');
    const relief = store.get('relief');
    const { rest } = readUrl();
    const url = buildUrl({ lang, rest, relief: relief.on ? relief.amount : 0, state: slugOf(store.get('selection')) });
    if (url !== location.pathname + location.search) history.replaceState(null, '', url);
  };
  store.subscribe('lang', write);
  store.subscribe('relief', write);
  store.subscribe('selection', write);
  window.addEventListener('popstate', () => {
    const u = readUrl();
    if (u.lang) store.set('lang', u.lang);
    store.set('selection', idOf(u.state));
  });
  write();
}
