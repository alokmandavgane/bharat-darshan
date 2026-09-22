// @ts-check
// Resolving source citations: ids (and the odd plain URL) into lines a reader can read.
//
// PLAN.md section 5, "Source registry". `public/data/sources.json` is the build's cut of
// content/sources.json -- only what the atlas cites -- and everything that shows a source
// resolves through here: the line under a legend, the line under an open page, and the
// credits screen. No DOM, so it can be tested; the shell turns these into elements.

/**
 * @typedef {{ base: string[], licences: Record<string, any>, sources: Record<string, any> }} Registry
 * @typedef {{ id: string, title: string, url: string, vintage: string }} Cite
 */

/** The bare host of a URL, which is what a one-off citation has instead of a title. */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function field(v, lang) {
  if (!v || typeof v !== 'object') return v || '';
  return v[lang] ?? v.en ?? '';
}

/**
 * One citation: a registry id, or a plain URL for a fact that did not earn an entry.
 * Returns null for an id the registry has not got -- the build refuses those, so a null
 * here means a stale data file, and dropping it beats showing the reader an id.
 * @returns {Cite|null}
 */
export function citation(reg, cite, lang) {
  if (typeof cite !== 'string' || !cite) return null;
  if (cite.startsWith('http')) return { id: cite, title: hostOf(cite), url: cite, vintage: '' };
  const s = reg?.sources?.[cite];
  if (!s) return null;
  return { id: cite, title: field(s.title, lang), url: s.url || '', vintage: s.vintage || '' };
}

/**
 * The sources of a layer or a page, in the order it cites them, each once. A legend has
 * room for a few, so `max` keeps the line from becoming the legend.
 * @returns {Cite[]}
 */
export function sourceList(reg, cites, lang, max = 0) {
  const out = [];
  const seen = new Set();
  for (const c of cites || []) {
    const cit = citation(reg, c, lang);
    if (!cit || seen.has(cit.id)) continue;
    seen.add(cit.id);
    out.push(cit);
    if (max && out.length >= max) break;
  }
  return out;
}

/**
 * A source and its year, which is the whole of what a legend says: "Normal rainfall, 1991-2020".
 * A title that already names its year keeps it once: "Census of India 2011", not that twice.
 */
export function citeLabel(cite) {
  if (!cite.vintage || cite.title.includes(cite.vintage)) return cite.title;
  return `${cite.title}, ${cite.vintage}`;
}

/**
 * Every source the atlas uses, for the credits screen: the ones that make the model
 * first (they are on every page), then the rest in registry order. Generated, so it
 * cannot credit a dataset the atlas does not use or miss one it does.
 * @returns {{ id: string, title: string, publisher: string, url: string, vintage: string,
 *            licence: { title: string, url: string }|null, note: string, base: boolean }[]}
 */
export function creditList(reg, lang) {
  const sources = reg?.sources || {};
  const base = (reg?.base || []).filter((id) => sources[id]);
  const ids = [...base, ...Object.keys(sources).filter((id) => !base.includes(id))];
  return ids.map((id) => {
    const s = sources[id];
    const lic = s.licence ? reg.licences?.[s.licence] : null;
    const title = field(s.title, lang);
    // Natural Earth published by Natural Earth: saying it twice is not more credit.
    const publisher = field(s.publisher, lang);
    return {
      id,
      title,
      publisher: publisher === title ? '' : publisher,
      url: s.url || '',
      vintage: s.vintage || '',
      licence: lic ? { title: field(lic.title, lang), url: lic.url || '' } : null,
      note: field(s.note, lang),
      base: base.includes(id),
    };
  });
}
