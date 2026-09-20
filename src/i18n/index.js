// @ts-check
// About thirty lines of i18n (PLAN.md D9): flat JSON dictionaries, {param} interpolation,
// DOM binding through data-i18n attributes, Indian number formatting.
import en from './en.json';
import hi from './hi.json';

const dicts = { en, hi };
let current = 'en';

export function currentLanguage() {
  return current;
}

/** Best first-visit language: a saved choice, else the browser's languages. */
export function detectLanguage() {
  try {
    const saved = localStorage.getItem('bd.lang');
    if (saved && dicts[saved]) return saved;
  } catch { /* private mode */ }
  for (const l of navigator.languages || [navigator.language]) {
    if (l && l.toLowerCase().startsWith('hi')) return 'hi';
  }
  return 'en';
}

export function setLanguage(lang, root = document) {
  if (!dicts[lang]) lang = 'en';
  current = lang;
  root.documentElement.lang = lang;
  try { localStorage.setItem('bd.lang', lang); } catch { /* ignore */ }
  apply(root);
}

/** @param {string} key @param {Record<string, string|number>} [params] */
export function t(key, params) {
  let s = dicts[current][key] ?? dicts.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
  return s;
}

/** Content fields are objects keyed by language: { en, hi, native? }. */
export function pick(field) {
  if (!field || typeof field !== 'object') return field ?? '';
  return field[current] ?? field.en ?? '';
}

export function formatNumber(n) {
  return new Intl.NumberFormat(current === 'hi' ? 'hi-IN' : 'en-IN').format(n);
}

/** Re-render every bound element: data-i18n="key" (text), data-i18n-aria-label="key", data-i18n-title="key". */
export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
  }
  root.title = `${t('app.title')} · ${t('app.title.other')}`;
}
