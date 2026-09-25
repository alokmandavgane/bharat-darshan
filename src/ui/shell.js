// @ts-check
// The chrome: the wordmark, the compass, the status toast, and the sheet -- the one card,
// holding one stack (PLAN.md D14). Plain DOM, bound to the store; every string comes
// from i18n.
import { DEFAULT_CAMERA, kmPerPixel, wrapYaw } from '../engine/camera-math.js';
import { FILL_TYPES } from '../engine/choropleth.js';
import { stepEpisode } from '../engine/episodes.js';
import { currentLanguage, formatNumber, pick, t } from '../i18n/index.js';
import { DEFAULT_RELIEF } from '../state/url.js';
import { citeLabel, creditList, hostOf, sourceList } from './credits.js';
import { firstColour, kindOf, layerKey, layerMark } from './legend.js';
import { scaleBar } from './scale.js';

// The base's own marks: relief, the surroundings and the graticule are not layers in the
// catalogue's sense, so their tiles are drawn here rather than read off a layer.json.
const BASE_MARKS = {
  relief: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l6-11 4 6 3-4 5 9zM9 9l1.5 2.5L12 9"/></svg>',
  surroundings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M3 21c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M7 13V7l5-3 5 3v6"/></svg>',
  graticule: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
};

/**
 * @param {Document} root
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function createShell(root, store) {
  const $ = (sel) => /** @type {HTMLElement} */ (root.querySelector(sel));

  /**
   * Renders are queued and run once, together, at the end of the task that changed the
   * store: opening a page sets eight slices, and a layer switch sets off the engine's
   * own republishing, and each of those used to rebuild the sheet, the strip and the
   * catalogue again. A microtask still runs before the frame is painted.
   */
  const queued = new Set();
  function flush() {
    for (const fn of queued) { queued.delete(fn); fn(); }
  }
  function queue(...fns) {
    if (!queued.size) queueMicrotask(flush);
    for (const fn of fns) queued.add(fn);
  }
  /** Returns a subscriber that queues the renders instead of running them. */
  const later = (...fns) => () => queue(...fns);

  const langRow = $('.lang-row');
  const langLabel = $('.lang-row-label');
  const status = $('.status');
  const statusText = $('.status-text');
  const retry = $('.status-retry');
  const crumb = $('.sheet-crumb');
  const subtitle = $('.sheet-subtitle');
  const draftTag = $('.sheet-draft');
  const hint = $('.sheet-hint');
  const title = $('.sheet-title');
  const alt = $('.sheet-alt');
  const closeBtn = $('.sheet-close');
  const strip = $('.strip');
  const stripMarks = $('.strip-marks');
  const stripAdd = $('.strip-add');
  const stripLegend = $('.strip-legend');
  const scale = $('.scale');
  const scaleBarEl = $('.scale-bar');
  const scaleLabel = $('.scale-label');
  const facts = $('.facts');
  const steps = $('.card-steps');
  const stepPrev = $('.card-prev');
  const stepNext = $('.card-next');
  const stepCount = $('.card-count');
  const tourStep = $('.card-tour');
  const finder = $('.finder');
  const list = $('.unit-list');
  const search = /** @type {HTMLInputElement} */ ($('.search'));
  const units = /** @type {HTMLDetailsElement} */ ($('.units'));
  const unitsCount = $('.units-count');
  const unitGrid = $('.unit-grid');
  const contents = $('.contents');
  const catalogue = $('.catalogue');
  const catalogueSearch = /** @type {HTMLInputElement} */ ($('.catalogue-search'));
  const catalogueNone = $('.catalogue-none');
  const layerList = $('.layer-list');
  const foot = $('.foot');
  const tourRow = $('.tour-row');
  const about = /** @type {HTMLDetailsElement} */ ($('.about'));
  const credits = $('.credits');
  const sheet = $('.sheet');
  const sheetBody = $('.sheet-body');
  const kicker = $('.wordmark .kicker');
  const posterTitle = $('.wordmark .title');
  const posterOther = $('.wordmark .title-other');
  const posterTagline = $('.wordmark .tagline');
  const resetBtn = $('.reset-button');
  const tooltip = $('.tooltip');
  const canvas = $('canvas.map');
  const topbar = $('.topbar');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  // On wide pointer screens the sheet is a side panel beside the country.
  const wide = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');

  /** The plate on show, as the file describes it, or null. */
  const openPlate = () => {
    const id = store.get('plate');
    return id ? (store.get('plates')?.plates || []).find((p) => p.id === id) || null : null;
  };

  // --- the other language: a row at the foot of the contents. A first visit already
  // arrives in the browser's language (detectLanguage), so this is for the reader who
  // wants the other one, and it need not sit on the map.
  langRow.addEventListener('click', () => store.set('lang', store.get('lang') === 'hi' ? 'en' : 'hi'));
  function renderLang() {
    // The row names the other language in that language, so it is set in its script.
    langLabel.lang = store.get('lang') === 'hi' ? 'en' : 'hi';
  }

  retry.addEventListener('click', () => location.reload());
  // The app is one fixed, overflow-hidden box, and a focus() or scrollIntoView() on a
  // control in the sheet's head can still scroll it and leave the map half off screen.
  const app = $('#app');
  app.addEventListener('scroll', () => { app.scrollTop = 0; app.scrollLeft = 0; });
  // The card's own steps walk the tour's route by hand: a card is opened by name alone
  // and the engine fills in the rest, the same way a link does.
  stepPrev.addEventListener('click', () => step(-1));
  stepNext.addEventListener('click', () => step(1));
  /** Back pops one level of the stack: catalogue, item, state, selection, page. */
  closeBtn.addEventListener('click', () => {
    if (store.get('catalogue')) store.set('catalogue', false);
    else if (store.get('item')) store.set('item', null);
    else if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    else if (store.get('selection')) store.set('selection', null);
    else if (store.get('plate')) closePlate();
    sheetBody.scrollTop = 0;
  });

  /**
   * Switch a layer on or off. Two fills at once would fight over the same clay, so
   * switching one on switches the others off. A choropleth and an `areas` layer are both
   * fills -- one tints by the state under a pixel, the other by its own raster -- and
   * either way it is the type that says so, never a layer's name.
   */
  function toggleLayer(id) {
    const catalog = store.get('catalog') || [];
    const active = new Set(store.get('layers')?.active || []);
    if (active.has(id)) active.delete(id);
    else {
      if (FILL_TYPES.includes(catalog.find((l) => l.id === id)?.type)) {
        for (const l of catalog) if (FILL_TYPES.includes(l.type) && l.id !== id) active.delete(l.id);
      }
      active.add(id);
    }
    store.set('layers', { active: [...active] });
  }
  /** A row's switch in the catalogue and the switch in an unfolded legend say the same thing to the store. */
  const onLayerClick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]:not([data-item])');
    if (b) toggleLayer(b.dataset.layer);
  };
  layerList.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-base]');
    if (!b) { onLayerClick(e); return; }
    const kind = b.dataset.base;
    if (kind === 'relief') store.set('relief', { on: !store.get('relief').on }, { animate: true });
    else if (kind === 'surroundings') store.set('surroundings', !store.get('surroundings'));
    else if (kind === 'graticule') store.set('graticule', !store.get('graticule'));
  });
  stripLegend.addEventListener('click', onLayerClick);

  /** What a layer with no key of its own still has to say about itself. */
  function keyHint(layer) {
    const kind = kindOf(layer);
    if (kind === 'regional') return t('layer.regional');
    if (kind === 'label') return t('layer.labels');
    return '';
  }

  /**
   * A layer's key, or -- for one whose colours appear nowhere on the map -- what it is
   * instead. A `regional` layer with no anchors draws nothing, so a row of swatches
   * would be offering the reader colours to look for that are not there.
   */
  function keyFor(layer, opts) {
    return kindOf(layer) === 'regional' ? null : layerKey(layer, opts);
  }

  /**
   * One layer as a row: its mark, its name, its key in miniature, and a switch. The
   * row is the catalogue's, and everything on it is read off the layer's declared type
   * and colours (PLAN.md D5).
   */
  function layerRow(layer, on) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-row';
    b.dataset.layer = layer.id;
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.style.setProperty('--c', firstColour(layer));
    const mark = document.createElement('span');
    mark.className = 'layer-mark';
    mark.dataset.kind = kindOf(layer);
    mark.innerHTML = layerMark(layer);          // static markup from the layer's type and checked colours
    const text = document.createElement('span');
    text.className = 'layer-text';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = pick(layer.title);
    text.appendChild(name);
    const k = keyFor(layer, { compact: true });
    const hint = k ? '' : keyHint(layer);
    if (k || hint) {
      const keyEl = document.createElement('span');
      keyEl.className = 'layer-key';
      if (k) keyEl.appendChild(k); else keyEl.textContent = hint;
      text.appendChild(keyEl);
    }
    const sw = document.createElement('span');
    sw.className = 'switch';
    b.append(mark, text, sw);
    return b;
  }

  /**
   * A row of the base: relief, the surroundings or the graticule. The same shape as a
   * layer's row, so the catalogue reads as one list, with the switch at the same place.
   */
  function baseRow(kind, on, hintText) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-row';
    b.dataset.base = kind;
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    const mark = document.createElement('span');
    mark.className = 'layer-mark';
    mark.dataset.kind = 'base';
    mark.innerHTML = BASE_MARKS[kind];
    const text = document.createElement('span');
    text.className = 'layer-text';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = t(`chip.${kind}`);
    text.appendChild(name);
    if (hintText) {
      const k = document.createElement('span');
      k.className = 'layer-key';
      k.textContent = hintText;
      text.appendChild(k);
    }
    const sw = document.createElement('span');
    sw.className = 'switch';
    b.append(mark, text, sw);
    return b;
  }

  /**
   * The catalogue: the base first, then every layer, grouped as the catalogue groups
   * them -- the group is a field on the layer and its heading a string keyed by that
   * field. No layer id appears here.
   */
  function renderLayerList() {
    layerList.replaceChildren();
    const active = new Set(store.get('layers')?.active || []);
    const relief = store.get('relief') || {};
    const base = document.createElement('div');
    base.className = 'layer-group';
    const bh = document.createElement('h4');
    bh.textContent = t('layer.group.base');
    base.appendChild(bh);
    base.appendChild(baseRow('relief', !!relief.on, relief.on ? t('relief.hint', { n: formatNumber(relief.amount || DEFAULT_RELIEF) }) : ''));
    // The slider under its row: how much the relief is exaggerated by, while it is on.
    const row = document.createElement('div');
    row.className = 'relief';
    row.hidden = !relief.on;
    const label = document.createElement('label');
    label.htmlFor = 'relief-slider';
    label.textContent = t('relief.label');
    const slider = document.createElement('input');
    slider.id = 'relief-slider';
    slider.className = 'relief-slider';
    slider.type = 'range';
    slider.min = '0'; slider.max = '30'; slider.step = '1';
    slider.value = String(relief.amount || DEFAULT_RELIEF);
    slider.setAttribute('aria-label', t('relief.aria'));
    const value = document.createElement('span');
    value.className = 'relief-value';
    value.textContent = t('relief.value', { n: formatNumber(relief.amount || DEFAULT_RELIEF) });
    slider.addEventListener('input', () => {
      value.textContent = t('relief.value', { n: formatNumber(Number(slider.value)) });
      store.set('relief', { amount: Number(slider.value), on: true }, { source: 'slider' });
    });
    row.append(label, slider, value);
    base.appendChild(row);
    base.appendChild(baseRow('surroundings', !!store.get('surroundings'), t('chip.surroundings.hint')));
    base.appendChild(baseRow('graticule', !!store.get('graticule'), t('chip.graticule.hint')));
    layerList.appendChild(base);
    const byGroup = new Map();
    for (const layer of store.get('catalog') || []) {
      const g = layer.group || 'other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(layer);
    }
    for (const [group, layers] of byGroup) {
      const section = document.createElement('div');
      section.className = 'layer-group';
      const h = document.createElement('h4');
      h.textContent = t(`layer.group.${group}`, {}, group);
      section.appendChild(h);
      for (const layer of layers) section.appendChild(layerRow(layer, active.has(layer.id)));
      layerList.appendChild(section);
    }
    if (catalogueSearch.value) filterCatalogue();
  }

  /** The catalogue's own search: typing narrows the rows to those whose names, keys or group headings match. */
  function filterCatalogue() {
    const q = catalogueSearch.value.trim().toLowerCase();
    let shown = 0;
    for (const group of layerList.querySelectorAll('.layer-group')) {
      const heading = group.querySelector('h4')?.textContent?.toLowerCase() || '';
      let any = false;
      for (const row of group.querySelectorAll('.layer-row')) {
        const hit = !q || heading.includes(q) || (row.textContent || '').toLowerCase().includes(q);
        /** @type {HTMLElement} */ (row).hidden = !hit;
        any = any || hit;
      }
      const relief = /** @type {HTMLElement | null} */ (group.querySelector('.relief'));
      if (relief) relief.hidden = !!q || !store.get('relief')?.on;
      /** @type {HTMLElement} */ (group).hidden = !any;
      if (any) shown++;
    }
    catalogueNone.hidden = !q || !!shown;
  }
  catalogueSearch.addEventListener('input', filterCatalogue);
  catalogueSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && catalogueSearch.value) { catalogueSearch.value = ''; filterCatalogue(); e.stopPropagation(); }
  });

  const LEGEND_SOURCES = 3;   // a legend says where it came from; it is not the credits screen

  /**
   * "Sources: Natural Earth, India-WRIS, Wikipedia" -- the line under a legend or an open
   * page, each name linking to the publisher and carrying the data's year where there is
   * one. It resolves ids through the registry the build wrote, so the same census cited by
   * ten layers is written down once (PLAN.md section 5, "Source registry").
   */
  function sourceNote(cites, max = 0) {
    const reg = store.get('sources');
    const found = sourceList(reg, cites, currentLanguage(), max);
    if (!found.length) return null;
    const p = document.createElement('p');
    p.className = 'legend-sources';
    p.append(`${t('facts.sources')}: `);
    found.forEach((c, i) => {
      if (i) p.append(', ');
      if (!c.url) { p.append(citeLabel(c)); return; }
      const a = document.createElement('a');
      a.href = c.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = citeLabel(c);
      p.appendChild(a);
    });
    if (max && (cites || []).length > found.length) p.append(' …');
    return p;
  }

  // --- the strip: the key, as the second line of the sheet's head (PLAN.md D14)
  //
  // One mark per layer drawn, in catalogue order; a page's own layer stays listed when
  // hidden, greyed, so a tap can bring it back. A tapped mark unfolds that layer's legend
  // under the strip: its samples, its caveat, its sources, and a switch. The strip is in
  // the head, so it is on every level of the stack and a reader inside a state card can
  // still look a colour up.

  /** The layer whose legend is unfolded, or null. */
  let openKey = null;

  stripMarks.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]');
    if (!b) return;
    openKey = openKey === b.dataset.layer ? null : b.dataset.layer;
    renderStrip();
  });
  stripAdd.addEventListener('click', () => {
    store.set('catalogue', true);
    if (store.get('sheet')?.snap === 'peek') store.set('sheetSnap', { name: 'half', t: performance.now() });
  });
  // A new page comes with its own layers; the legend that was open belongs to the last.
  store.subscribe('plate', (id, prev) => { if (id !== prev) { openKey = null; store.set('catalogue', false); } });

  function renderStrip() {
    const catalog = store.get('catalog') || [];
    const active = new Set(store.get('layers')?.active || []);
    const own = new Set(pageLayers(openPlate()));
    const rows = catalog.filter((l) => active.has(l.id) || own.has(l.id));
    // The catalogue is the strip, spelled out: the strip steps aside while it is open.
    strip.hidden = !rows.length || !!store.get('catalogue');
    if (!rows.some((l) => l.id === openKey)) openKey = null;
    stripMarks.replaceChildren();
    for (const layer of rows) {
      const on = active.has(layer.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'strip-mark';
      b.dataset.layer = layer.id;
      b.dataset.off = on ? '' : '1';
      b.setAttribute('aria-expanded', String(openKey === layer.id));
      const label = t('strip.read', { name: pick(layer.title) });
      b.setAttribute('aria-label', label);
      b.title = label;
      b.innerHTML = layerMark(layer);          // static markup from the layer's type and checked colours
      stripMarks.appendChild(b);
    }
    renderStripLegend(rows.find((l) => l.id === openKey), active);
  }

  /** The unfolded legend of one layer: name and switch, then its key, caveat and sources. */
  function renderStripLegend(layer, active) {
    stripLegend.replaceChildren();
    stripLegend.hidden = !layer || strip.hidden;
    if (stripLegend.hidden) return;
    const on = active.has(layer.id);
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'strip-legend-head';
    head.dataset.layer = layer.id;
    head.setAttribute('role', 'switch');
    head.setAttribute('aria-checked', String(on));
    const label = t(on ? 'layer.hide' : 'layer.show', { name: pick(layer.title) });
    head.setAttribute('aria-label', label);
    head.title = label;
    const name = document.createElement('span');
    name.className = 'strip-legend-name';
    name.textContent = pick(layer.title);
    const sw = document.createElement('span');
    sw.className = 'switch';
    head.append(name, sw);
    stripLegend.appendChild(head);
    const k = keyFor(layer, {});
    if (k) stripLegend.appendChild(k);
    else {
      const hintText = keyHint(layer);
      if (hintText) {
        const p = document.createElement('p');
        p.className = 'legend-note';
        p.textContent = hintText;
        stripLegend.appendChild(p);
      }
    }
    // A layer with no key still owes the reader its source, so the line goes on whatever
    // is drawn -- a legend is a nicety, a citation is not (PLAN.md 5).
    const src = sourceNote(layer.sources, LEGEND_SOURCES);
    if (src) stripLegend.appendChild(src);
  }

  /**
   * The credits screen, generated from the registry (PLAN.md section 5). The sources that
   * make the model come first -- they are on every page -- and each line says who
   * published it, under what licence, and what this atlas took from it.
   */
  function renderCredits() {
    const reg = store.get('sources');
    const lines = creditList(reg, currentLanguage());
    credits.replaceChildren();
    credits.hidden = !lines.length;
    for (const c of lines) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = c.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = citeLabel(c);
      li.append(a);
      if (c.publisher) li.append(` — ${c.publisher}`);
      if (c.licence) {
        li.append(' · ');
        if (c.licence.url) {
          const lic = document.createElement('a');
          lic.href = c.licence.url;
          lic.target = '_blank';
          lic.rel = 'noopener';
          lic.textContent = c.licence.title;
          li.appendChild(lic);
        } else {
          li.append(c.licence.title);
        }
      }
      if (c.note) {
        const span = document.createElement('span');
        span.className = 'credit-note';
        span.textContent = c.note;
        li.append(span);
      }
      credits.appendChild(li);
    }
  }

  /** Drafts are said so in the head's meta line; the about text leads with it too. */
  function setDraft(isDraft) {
    sheet.dataset.draft = isDraft ? '1' : '';
    draftTag.hidden = !isDraft;
  }

  // --- the compass: home, and the way back to north
  resetBtn.addEventListener('click', () => store.set('home', { t: performance.now() }));
  store.subscribe('home', (req) => {
    if (!req) return;
    if (store.get('catalogue')) store.set('catalogue', false);
    if (store.get('item')) store.set('item', null);
    if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'home' });
    if (store.get('selection')) store.set('selection', null);
    about.open = false;
    store.set('sheetSnap', { name: 'peek', t: performance.now() });
  });
  // The needle turns with the map. Now that the model goes the whole way round, the
  // compass is the only way back to north from a turned view, so it says so when the
  // view is turned rather than sitting there looking like decoration (F3).
  store.subscribe('camera', (c) => {
    renderScale(c);
    resetBtn.style.setProperty('--yaw', `${c.yaw.toFixed(1)}deg`);
    const turned = Math.abs(wrapYaw(c.yaw - DEFAULT_CAMERA.yaw)) > 8;
    resetBtn.dataset.turned = turned ? 'yes' : '';
    const label = t(turned ? 'view.north' : 'view.reset');
    resetBtn.setAttribute('aria-label', label);
    resetBtn.title = label;
  }, { immediate: true });

  // --- episodes: a story page steps through its tour's groups one at a time (the engine's
  // episodes.js); the page carries the steps, under its play button
  /** @type {HTMLElement | null} */
  let pageEpisodes = null;
  const arrow = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function episodeStepper() {
    const el = document.createElement('div');
    el.className = 'page-episodes';
    el.setAttribute('role', 'group');
    el.hidden = true;
    el.innerHTML = `<div class="episode-row">
        <button type="button" class="episode-prev">${arrow('M15 5l-7 7 7 7')}</button>
        <div class="episode-now" aria-live="polite"><span class="episode-swatch"></span>
          <span class="episode-text"><span class="episode-count"></span><span class="episode-name"></span></span></div>
        <button type="button" class="episode-next">${arrow('M9 5l7 7-7 7')}</button>
      </div>
      <button type="button" class="episode-all"></button>`;
    const go = (by) => {
      const eps = store.get('episodes');
      const ep = store.get('episode');
      if (!eps?.list?.length) return;
      const next = stepEpisode(eps.list.map((e) => e.id), ep?.plate === eps.plate ? ep.id : null, by);
      store.set('tour', { playing: false });
      store.set('episode', { plate: eps.plate, id: next }, { source: 'stepper' });
    };
    /** @type {HTMLElement} */ (el.querySelector('.episode-prev')).addEventListener('click', () => go(-1));
    /** @type {HTMLElement} */ (el.querySelector('.episode-next')).addEventListener('click', () => go(1));
    /** @type {HTMLElement} */ (el.querySelector('.episode-all')).addEventListener('click', () => {
      const eps = store.get('episodes');
      const ep = store.get('episode');
      if (!eps?.list?.length) return;
      store.set('tour', { playing: false });
      const all = ep?.plate === eps.plate && ep.id === null;
      store.set('episode', { plate: eps.plate, id: all ? eps.list[0].id : null }, { source: 'stepper' });
    });
    pageEpisodes = el;
    return el;
  }

  function renderEpisodes() {
    const el = pageEpisodes;
    if (!el || !el.isConnected) return;
    const eps = store.get('episodes');
    const ep = store.get('episode');
    const list = eps?.plate === openPlate()?.id ? eps.list : [];
    el.hidden = list.length < 2;
    if (el.hidden) return;
    el.setAttribute('aria-label', t('episode.steps'));
    const at = ep?.plate === eps.plate ? list.findIndex((e) => e.id === ep.id) : -1;
    const now = at >= 0 ? list[at] : null;
    const $$ = (sel) => /** @type {HTMLElement} */ (el.querySelector(sel));
    $$('.episode-count').textContent = now
      ? t('episode.count', { n: formatNumber(at + 1), total: formatNumber(list.length) })
      : t('episode.everything', { total: formatNumber(list.length) });
    $$('.episode-name').textContent = now ? pick(now.title) : '';
    $$('.episode-name').hidden = !now;
    $$('.episode-swatch').style.background = now?.color || 'transparent';
    $$('.episode-swatch').hidden = !now;
    for (const [sel, key] of [['.episode-prev', 'episode.prev'], ['.episode-next', 'episode.next']]) {
      $$(sel).setAttribute('aria-label', t(key));
      $$(sel).title = t(key);
    }
    const all = $$('.episode-all');
    all.textContent = t(now ? 'episode.all' : 'episode.one');
    all.setAttribute('aria-pressed', String(!now));
  }
  store.subscribe('episodes', renderEpisodes);
  store.subscribe('episode', renderEpisodes);
  store.subscribe('lang', renderEpisodes);

  // --- the tour: a row at the foot of the contents starts it; the card's steps carry it
  const toggleTour = () => store.set('tour', { playing: !store.get('tour')?.playing });
  /** @type {HTMLButtonElement | null} the open story's own play button, when the page has one */
  let pageTour = null;
  tourRow.addEventListener('click', toggleTour);
  tourStep.addEventListener('click', toggleTour);
  function renderTour() {
    const tr = store.get('tour') || {};
    const playing = !!tr.playing;
    tourRow.hidden = !playing && !tr.total;
    const label = t(playing ? 'tour.pause' : 'tour.play');
    for (const b of [tourRow, tourStep]) {
      b.setAttribute('aria-pressed', String(playing));
      b.setAttribute('aria-label', label);
      b.title = label;
    }
    /** @type {HTMLElement} */ (tourRow.querySelector('span')).textContent = label;
    if (pageTour) {
      const own = playing ? label : (pageTour.dataset.label || label);
      pageTour.setAttribute('aria-pressed', String(playing));
      pageTour.setAttribute('aria-label', own);
      pageTour.title = own;
      /** @type {HTMLElement} */ (pageTour.querySelector('span')).textContent = own;
    }
    root.body.dataset.tour = playing ? 'playing' : '';
  }
  store.subscribe('tour', (tr, prev) => {
    renderTour();
    // the cards read best with the sheet half open; the map is framed above it
    if (tr?.playing && !prev?.playing) store.set('sheetSnap', { name: 'half', t: performance.now() });
  }, { immediate: true });

  // --- finding and picking: the search results, the unit grid, the lists on a card
  search.addEventListener('input', () => renderList());
  search.addEventListener('focus', () => {
    if (store.get('sheet')?.snap === 'peek') store.set('sheetSnap', { name: 'half', t: performance.now() });
  });
  const openItem = (btn) => store.set('item', { layer: btn.dataset.layer, id: btn.dataset.item, data: null, categories: null, fields: null });
  facts.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-layer][data-item]');
    if (btn) openItem(btn);
  });
  for (const el of [list, unitGrid]) {
    el.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-id], button[data-item]');
      if (!btn) return;
      if (btn.dataset.item) {
        // A found item is opened by name alone; the engine fills it in and flies to it.
        openItem(btn);
        store.set('sheetSnap', { name: 'peek', t: performance.now() });
        return;
      }
      const id = Number(btn.dataset.id);
      store.set('selection', id);
      // Picking from the list goes as deep as tapping the map does.
      if (store.get('level')?.id !== id) store.set('level', { name: 'state', id }, { source: 'ui' });
      store.set('sheetSnap', { name: 'peek', t: performance.now() });
    });
  }

  /** Names other than the one shown as the title: the other UI language, then the native script. */
  function otherNames(u) {
    const cur = currentLanguage();
    const parts = [cur === 'hi' ? u.name.en : u.name.hi, u.name.native];
    return parts.filter((n, i, a) => n && n !== u.name[cur] && a.indexOf(n) === i).join(' · ');
  }

  const SEARCH_HITS = 40;      // enough to find anything, few enough to stay light on a phone

  /** One row of a list: a button with its name and a quieter second line. */
  function listRow(name, alt, data) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    Object.assign(b.dataset, data);
    const main = document.createElement('span');
    main.className = 'unit-list-name';
    main.textContent = name;
    const second = document.createElement('span');
    second.className = 'unit-list-alt';
    second.textContent = alt;
    b.append(main, second);
    li.appendChild(b);
    return li;
  }

  const sortedUnits = (r) => [...r.units].sort((a, b) => pick(a.name).localeCompare(pick(b.name), currentLanguage()));

  /**
   * What the search field finds: the units whose names match, and -- since the engine
   * publishes an index of what is drawn -- whatever the layers on show can answer with,
   * so a state view finds that state's places. Nothing typed, nothing listed.
   */
  function renderList() {
    const r = store.get('regions');
    const q = search.value.trim().toLowerCase();
    list.hidden = !q;
    root.body.dataset.searching = q ? '1' : '';
    if (!q || !r) { list.replaceChildren(); return; }
    const hit = (name) => Object.values(name || {}).some((n) => n && String(n).toLowerCase().includes(q));
    const rows = sortedUnits(r).filter((u) => hit(u.name)).map((u) => listRow(pick(u.name), otherNames(u), { id: String(u.id) }));
    const catalog = store.get('catalog') || [];
    for (const x of (store.get('index') || []).filter((i) => hit(i.name)).slice(0, SEARCH_HITS)) {
      const layer = catalog.find((l) => l.id === x.layer);
      rows.push(listRow(pick(x.name), layer ? pick(layer.title) : '', { layer: x.layer, item: x.id }));
    }
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'unit-list-none';
      li.textContent = t('list.none');
      rows.push(li);
    }
    list.replaceChildren(...rows);
  }

  /** Every unit, behind its fold, so each one is reachable without hitting it. */
  function renderUnits() {
    const r = store.get('regions');
    if (!r) return;
    unitsCount.textContent = formatNumber(r.units.length);
    unitGrid.replaceChildren(...sortedUnits(r).map((u) => listRow(pick(u.name), otherNames(u), { id: String(u.id) })));
  }

  // --- the atlas: plates are pages, and the contents page is how you turn to one
  //
  // A plate is a preset of view state and nothing more (PLAN.md D11): opening one writes
  // the same store keys a URL does, so the engine never learns the word "plate" and
  // adding a page needs no code. The contents is ordinary DOM, which is also what makes
  // it the screen-reader and no-WebGL view of the atlas.

  /** Turn to a page: its layers, its relief, and the country framed again. */
  function openPlateById(id) {
    const plate = (store.get('plates')?.plates || []).find((p) => p.id === id);
    if (!plate) return;
    store.set('plate', id);
    store.set('item', null);
    store.set('layers', { active: [...(plate.eras ? plate.eras[0].layers : plate.layers)] });
    store.set('base', plate.base || 'physical');
    if (plate.relief !== undefined) store.set('relief', { on: plate.relief > 0, amount: plate.relief || DEFAULT_RELIEF }, { animate: true });
    if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    store.set('selection', null);
    store.set('home', { t: performance.now() });
  }

  /** Back to the contents, and the map back to what it shows when no page is open. */
  function closePlate() {
    store.set('plate', null);
    store.set('item', null);
    store.set('layers', { active: (store.get('catalog') || []).filter((l) => l.default_on).map((l) => l.id) });
    store.set('base', 'physical');
    store.set('relief', { on: true, amount: DEFAULT_RELIEF }, { animate: true });
  }

  /**
   * A page's tile in the contents: the mark of the first layer it draws, on its base.
   * The tile previews the map the way the layer rows preview a layer, from data alone.
   */
  function plateMark(plate) {
    const catalog = store.get('catalog') || [];
    const layers = (plate.layers || []).map((id) => catalog.find((l) => l.id === id)).filter(Boolean);
    // The first layer that draws a thing: a page of names or of card-only items has
    // nothing to preview, and one of its other layers will.
    const first = layers.find((l) => !['label', 'regional'].includes(kindOf(l))) || layers[0];
    const el = document.createElement('span');
    el.className = 'plate-mark';
    el.dataset.base = plate.base || 'physical';
    if (first) {
      el.style.setProperty('--c', firstColour(first));
      el.innerHTML = layerMark(first);
    }
    return el;
  }

  /** The contents when no page is open: its sections, and a tile and a line for each page. */
  function renderContentsList(data) {
    const bySection = new Map();
    for (const plate of data.plates) {
      if (!store.get('drafts') && plate.status !== 'reviewed') continue;
      if (!bySection.has(plate.section)) bySection.set(plate.section, []);
      bySection.get(plate.section).push(plate);
    }
    for (const section of data.sections) {
      const plates = bySection.get(section);
      if (!plates) continue;
      const h = document.createElement('h4');
      h.className = 'contents-section';
      h.textContent = t(`atlas.section.${section}`);
      const ul = document.createElement('ul');
      ul.className = 'contents-list';
      for (const plate of plates) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'contents-item';
        b.dataset.plate = plate.id;
        const text = document.createElement('span');
        text.className = 'contents-item-text';
        const name = document.createElement('span');
        name.className = 'contents-item-name';
        name.textContent = pick(plate.title);
        const blurb = document.createElement('span');
        blurb.className = 'contents-item-blurb';
        blurb.textContent = pick(plate.blurb);
        text.append(name, blurb);
        b.append(plateMark(plate), text);
        li.appendChild(b);
        ul.appendChild(li);
      }
      contents.append(h, ul);
    }
  }

  /**
   * A page of eras (kingdoms and empires) shows one era's layers at a time. Which era is
   * on is read off the layers themselves, so a link or the back button that restores the
   * layers restores the era with them.
   */
  function eraOn(plate) {
    if (!plate?.eras) return null;
    const active = new Set(store.get('layers')?.active || []);
    return plate.eras.find((e) => e.layers.length === active.size && e.layers.every((id) => active.has(id))) || null;
  }
  /** The layers a page is showing now: its era's, or all of them. */
  function pageLayers(plate) {
    if (!plate) return [];
    return plate.eras ? (eraOn(plate) || plate.eras[0]).layers : plate.layers || [];
  }

  /** @type {HTMLElement | null} */
  let pageEras = null;
  function eraStepper(plate) {
    const el = document.createElement('div');
    el.className = 'page-episodes page-eras';
    el.setAttribute('role', 'group');
    el.innerHTML = `<div class="episode-row">
        <button type="button" class="episode-prev">${arrow('M15 5l-7 7 7 7')}</button>
        <div class="episode-now" aria-live="polite"><span class="episode-text"><span class="episode-count"></span><span class="episode-name"></span></span></div>
        <button type="button" class="episode-next">${arrow('M9 5l7 7-7 7')}</button>
      </div>
      <p class="era-blurb"></p>`;
    const go = (by) => {
      const i = plate.eras.indexOf(eraOn(plate) || plate.eras[0]);
      const next = plate.eras[Math.max(0, Math.min(plate.eras.length - 1, i + by))];
      store.set('item', null);
      store.set('layers', { active: [...next.layers] });
    };
    /** @type {HTMLElement} */ (el.querySelector('.episode-prev')).addEventListener('click', () => go(-1));
    /** @type {HTMLElement} */ (el.querySelector('.episode-next')).addEventListener('click', () => go(1));
    pageEras = el;
    return el;
  }
  function renderEras() {
    const el = pageEras;
    const plate = openPlate();
    if (!el || !el.isConnected || !plate?.eras) return;
    const era = eraOn(plate);
    const i = era ? plate.eras.indexOf(era) : -1;
    const $$ = (sel) => /** @type {HTMLElement} */ (el.querySelector(sel));
    $$('.episode-count').textContent = era
      ? `${pick(era.display)} · ${t('era.count', { n: formatNumber(i + 1), total: formatNumber(plate.eras.length) })}`
      : t('era.mixed');
    $$('.episode-name').textContent = era ? pick(era.title) : '';
    $$('.era-blurb').textContent = era ? pick(era.blurb) : '';
    const prev = /** @type {HTMLButtonElement} */ (el.querySelector('.episode-prev'));
    const next = /** @type {HTMLButtonElement} */ (el.querySelector('.episode-next'));
    prev.disabled = i <= 0;
    next.disabled = i < 0 ? false : i >= plate.eras.length - 1;
    for (const [b, key] of [[prev, 'era.prev'], [next, 'era.next']]) {
      b.setAttribute('aria-label', t(key));
      b.title = t(key);
    }
    el.setAttribute('aria-label', t('era.steps'));
  }
  store.subscribe('layers', () => { renderEras(); const plate = openPlate(); if (plate?.eras) queue(renderSheet); });
  store.subscribe('lang', renderEras);

  /** The open page's own words and its sources. Its layers are the strip above. */
  function renderPage(plate) {
    const p = document.createElement('p');
    p.className = 'contents-blurb';
    p.textContent = pick(plate.blurb);
    contents.appendChild(p);
    pageEras = null;
    if (plate.eras) {
      contents.appendChild(eraStepper(plate));
      renderEras();
    }
    // A story names its stops, so its page carries the play button itself, under its own
    // title: the foot's tour row belongs to the contents, which a page does not show.
    pageTour = null;
    if (plate.tour) {
      pageTour = /** @type {HTMLButtonElement} */ (tourRow.cloneNode(true));
      pageTour.classList.add('page-tour');
      pageTour.querySelector('[data-i18n]')?.removeAttribute('data-i18n');   // its label is the page's, not a string
      pageTour.hidden = false;
      pageTour.dataset.label = pick(plate.tour.title) || t('tour.play');
      pageTour.addEventListener('click', toggleTour);
      contents.appendChild(pageTour);
      renderTour();
      contents.appendChild(episodeStepper());
      renderEpisodes();
    }
    // A page cannot show a map without saying whose it is: the build unions its layers'
    // sources into the plate, so this line is never the page's own promise (PLAN.md D11).
    const src = sourceNote(plate.sources);
    if (src) contents.appendChild(src);
  }

  contents.addEventListener('click', (e) => {
    const page = /** @type {HTMLElement} */ (e.target).closest('button[data-plate]');
    if (page) { openPlateById(page.dataset.plate || ''); sheetBody.scrollTop = 0; }
  });

  // Wide enough to read a round number off, narrow enough to stay out of the way. A
  // declaration, not a const: the camera subscriber above runs before this line does.
  function scaleSpan(w) { return Math.max(90, Math.min(150, w * 0.3)); }

  function renderScale(cam) {
    const vp = store.get('viewport');
    if (!cam || !vp?.w) return;
    const { km, px } = scaleBar(kmPerPixel(cam, vp), scaleSpan(vp.w));
    scale.hidden = !km;
    if (!km) return;
    scaleBarEl.style.setProperty('--w', `${px.toFixed(1)}px`);
    scaleLabel.textContent = t('scale.km', { n: formatNumber(km) });
  }

  /**
   * The share card of a page (`?poster=1`, rendered by tools/share-image.mjs). The wordmark
   * becomes the page's own -- its title, the same title in the other language, its blurb --
   * with the atlas's name shrunk to a kicker above. A card pasted into a chat has to say
   * which page it is, and the page already carries the words to say it with (PLAN.md D11).
   */
  function renderPoster() {
    if (!store.get('poster')) return;
    const plate = openPlate();
    kicker.hidden = !plate;
    root.body.dataset.posterPage = plate ? '1' : '';
    if (!plate) return;
    const other = currentLanguage() === 'hi' ? 'en' : 'hi';
    // Two spans, not one string: the Latin name takes the small-caps kicker treatment and
    // the Devanagari one must not (it is never letter-spaced or uppercased).
    const name = (lang, text) => {
      const el = document.createElement('span');
      el.lang = lang;
      el.textContent = text;
      return el;
    };
    kicker.replaceChildren(name('en', 'Bharat Darshan'), ' · ', name('hi', 'भारत दर्शन'));
    // These carry the app's own strings by default; the page's words are not translations
    // of them, so the binding goes with the text (i18n's apply() would put it back).
    for (const [el, text] of [[posterTitle, pick(plate.title)], [posterOther, plate.title[other] || ''],
      [posterTagline, pick(plate.blurb)]]) {
      el.removeAttribute('data-i18n');
      el.textContent = text;
    }
  }

  /** One label/value row as its own definition list, for cards with a single fact. */
  function factRow(label, value) {
    const dl = document.createElement('dl');
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    div.append(dt, dd);
    dl.appendChild(div);
    return dl;
  }

  /** The fact card for a unit: structured, sourced, shown only once reviewed (or with drafts on). */
  function renderFacts(u) {
    facts.replaceChildren();
    const f = u.facts;
    if (!f) return;
    if (f.status !== 'reviewed' && !store.get('drafts')) {
      const p = document.createElement('p');
      p.className = 'facts-pending';
      p.textContent = t('facts.pending');
      facts.appendChild(p);
      setDraft(false);
      return;
    }
    setDraft(f.status !== 'reviewed');
    const dl = document.createElement('dl');
    const row = (label, value) => {
      if (!value) return;
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      div.append(dt, dd);
      dl.appendChild(div);
    };
    row(t('facts.capital'), pick(f.capital));
    row(t('facts.languages'), (f.languages || []).map(pick).join(', '));
    row(t('facts.area'), f.area_km2 ? t('facts.area.value', { n: formatNumber(f.area_km2) }) : '');
    row(t('facts.population'), f.population_2011 ? formatNumber(f.population_2011) : '');
    facts.appendChild(dl);
    if (f.blurb) {
      const p = document.createElement('p');
      p.className = 'facts-blurb';
      p.textContent = pick(f.blurb);
      facts.appendChild(p);
    }
    if (f.sources?.length) {
      const p = document.createElement('p');
      p.className = 'facts-sources';
      p.append(t('facts.sources') + ': ');
      f.sources.forEach((src, i) => {
        const a = document.createElement('a');
        a.href = src;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = hostOf(src);
        if (i) p.append(', ');
        p.appendChild(a);
      });
      facts.appendChild(p);
    }
    regionalSections(u.id);
  }

  /**
   * What a `regional` layer has for this state: items that belong to the states that
   * keep them rather than to a point on the map, so they are read here instead of drawn.
   * Sorted the way the build sorted them, priority first.
   */
  function regionalSections(unitId) {
    for (const layer of store.get('regional') || []) {
      const month = store.get('month');
      const mine = (layer.items || []).filter((i) => (i.regions || []).includes(unitId)
        && (store.get('drafts') || i.status === 'reviewed')
        // An item with no month of its own is never scrubbed away; Eid moves through the
        // year, and hiding it eleven months in twelve would be a lie.
        && !(month && i.month && i.month !== month));
      if (!mine.length) continue;
      const h = document.createElement('h2');
      h.className = 'facts-heading';
      h.textContent = pick(layer.title);
      const ul = document.createElement('ul');
      ul.className = 'facts-list';
      for (const it of mine) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.layer = layer.id;
        b.dataset.item = it.id;
        const name = document.createElement('span');
        name.textContent = pick(it.name);
        // Whatever tells this item apart at a glance: when it falls, or what it calls
        // itself. A festival has a month; a language has its own script.
        const aside = document.createElement('span');
        aside.className = 'facts-list-when';
        aside.textContent = it.month ? t(`month.${it.month}`) : (it.name?.native || '');
        b.append(name, aside);
        li.appendChild(b);
        ul.appendChild(li);
      }
      facts.append(h, ul);
    }
  }

  /** Where the open card sits in the tour's route, or -1 when it is not one of its stops. */
  function stepIndex() {
    const sel = store.get('item');
    const stops = store.get('tour')?.stops || [];
    if (!sel) return -1;
    return stops.findIndex((s) => s.layer === sel.layer && s.id === sel.id);
  }

  function step(by) {
    const stops = store.get('tour')?.stops || [];
    const at = stepIndex();
    if (at < 0 || stops.length < 2) return;
    const next = (at + by + stops.length) % stops.length;      // the route is a loop
    // data: null on purpose. The store shallow-merges, so a bare { layer, id } would keep
    // the card that is open and show it under the new name until the engine caught up.
    store.set('item', { layer: stops[next].layer, id: stops[next].id, data: null, categories: null, fields: null });
  }

  /** The prev / next row, with the tour's play/pause, shown while the open card is one of several stops. */
  function renderSteps() {
    const stops = store.get('tour')?.stops || [];
    const at = stepIndex();
    steps.hidden = at < 0 || stops.length < 2;
    if (steps.hidden) return;
    stepCount.textContent = t('card.count', { n: formatNumber(at + 1), total: formatNumber(stops.length) });
  }

  /** The item card: name, kind and place in the head; its fields, blurb and sources below. */
  function renderItem(sel, r) {
    const it = sel.data;
    const layer = (store.get('catalog') || []).find((l) => l.id === sel.layer);
    const cat = (sel.categories || []).find((c) => c.id === it.category);
    document.body.dataset.selection = it.id;
    title.textContent = pick(it.name);
    const others = otherNames({ name: it.name });
    alt.textContent = others;
    alt.hidden = !others;
    // A point belongs to one region; a regional item to the several that keep it.
    const where = it.regions
      ? it.regions.map((x) => r.byId[x]).filter(Boolean)
      : [r.byId[it.region]].filter(Boolean);
    const places = where.length > 3
      ? t('facts.regions', { n: formatNumber(where.length) })
      : where.map((x) => pick(x.name)).join(', ');
    subtitle.textContent = [cat ? pick(cat.title) : pick(layer?.title), places].filter(Boolean).join(' · ');
    facts.replaceChildren();
    // A line item knows how far it runs inside India; a point has no such number.
    if (typeof it.km === 'number') {
      facts.appendChild(factRow(t('facts.length'), t('facts.km', { n: formatNumber(Math.round(it.km)) })));
    }
    // Columns the layer declared for itself (PLAN.md section 5): label and unit are data.
    for (const [name, spec] of Object.entries(sel.fields || {})) {
      const v = it[name];
      if (v === undefined || v === null) continue;
      // A year is a number but not a quantity: 1866, not 1,866. A month names itself, and
      // a `name` is a proper name, which is written in both languages like any other.
      const shown = spec.type === 'month' ? t(`month.${v}`)
        : spec.type === 'name' ? pick(v)
          : typeof v === 'number' && spec.type !== 'year' ? formatNumber(v) : String(v);
      facts.appendChild(factRow(pick(spec.label), spec.unit ? pick(spec.unit).replace('{n}', shown) : shown));
    }
    if (pick(it.blurb)) {
      const p = document.createElement('p');
      p.className = 'facts-blurb';
      p.textContent = pick(it.blurb);
      facts.appendChild(p);
    }
    if (it.sources?.length) {
      const ps = document.createElement('p');
      ps.className = 'facts-sources';
      ps.append(t('facts.sources') + ': ');
      it.sources.forEach((src, i) => {
        const a = document.createElement('a');
        a.href = src; a.target = '_blank'; a.rel = 'noopener'; a.textContent = hostOf(src);
        if (i) ps.append(', ');
        ps.appendChild(a);
      });
      facts.appendChild(ps);
    }
    setDraft(it.status !== 'reviewed');
  }

  /**
   * The sheet is the subject: the catalogue, an item's card, the selected unit (peek
   * card or state view), the open page, or the atlas's contents. One place decides what
   * the head says and which blocks of the body show, so the body is never two answers
   * at once. The head names the level -- a kicker for a page, a crumb for anything
   * inside one -- and Back pops one level (PLAN.md D14).
   */
  let subject = '';
  function renderSheet() {
    const r = store.get('regions');
    const sel = store.get('item');
    const id = store.get('selection');
    const u = id && r ? r.byId[id] : null;
    const inState = store.get('level')?.name === 'state';
    const plate = openPlate();
    const inCatalogue = !!store.get('catalogue');
    // A new subject starts with a clear field: results typed for the last one would
    // otherwise stand in front of this one's card.
    const now = [sel?.id || '', id || '', plate?.id || '', inState, inCatalogue].join('|');
    if (now !== subject && search.value) { search.value = ''; renderList(); }
    subject = now;
    document.body.dataset.level = inState ? 'state' : 'country';
    const view = inCatalogue ? 'layers' : sel?.data ? 'item' : u ? 'unit' : plate ? 'page' : 'contents';
    sheet.dataset.view = view;
    const show = (el, on) => { el.hidden = !on; };
    const section = plate ? t(`atlas.section.${plate.section}`, {}, plate.section) : '';
    const setCrumb = (text) => { crumb.textContent = text; crumb.hidden = !text; };
    const setBack = (label) => {
      closeBtn.hidden = !label;
      if (label) { closeBtn.setAttribute('aria-label', label); closeBtn.title = label; }
    };
    show(finder, view !== 'item' && view !== 'layers');
    show(facts, view === 'item' || view === 'unit');
    show(contents, view === 'page' || view === 'contents');
    show(catalogue, view === 'layers');
    show(units, view === 'contents' || view === 'page');
    show(foot, view === 'contents');
    hint.hidden = true;
    alt.hidden = true;
    queue(renderStrip);

    if (view === 'layers') {
      // Under the catalogue's title, where it was opened from.
      const from = sel?.data ? pick(sel.data.name) : u ? pick(u.name) : plate ? pick(plate.title) : t('sheet.title');
      setCrumb(from);
      title.textContent = t('menu.layers');
      const n = (store.get('layers')?.active || []).length;
      subtitle.textContent = t('layer.count.drawn', { n: formatNumber(n) });
      setBack(t('sheet.back.to', { name: from }));
      setDraft(false);
      if (fine.matches) catalogueSearch.focus({ preventScroll: true });
      return;
    }

    if (sel?.data && r) {
      setCrumb(plate ? `${section} › ${pick(plate.title)}` : '');
      renderItem(sel, r);
      setBack(t('sheet.close'));
      return;
    }

    document.body.dataset.selection = u ? u.slug : '';
    if (u) {
      setCrumb(plate ? `${section} › ${pick(plate.title)}` : '');
      title.textContent = pick(u.name);
      const others = otherNames(u);
      alt.textContent = others;
      alt.hidden = !others;
      subtitle.textContent = t(u.type === 'ut' ? 'unit.ut' : 'unit.state');
      setBack(inState ? t('sheet.back.to', { name: plate ? pick(plate.title) : t('sheet.title') }) : t('sheet.close'));
      if (!u.facts) setDraft(false);
      renderFacts(u);
      return;
    }

    setDraft(false);
    contents.replaceChildren();
    const data = store.get('plates');
    if (plate && !inState) {
      // The head is the page's: its title, where it sits, and the way back to the contents.
      setCrumb('');
      title.textContent = pick(plate.title);
      const n = pageLayers(plate).length;
      subtitle.textContent = [section, n === 1 ? t('layer.count.one') : t('layer.count', { n: formatNumber(n) })].join(' · ');
      setBack(t('atlas.back'));
      renderPage(plate);
      return;
    }
    setCrumb('');
    title.textContent = t('sheet.title');
    setBack('');
    if (r) {
      const states = r.units.filter((x) => x.type === 'state').length;
      subtitle.textContent = t('sheet.subtitle', { states: formatNumber(states), uts: formatNumber(r.units.length - states) });
    }
    if (data && !inState) {
      renderContentsList(data);
      const pages = data.plates.filter((p) => store.get('drafts') || p.status === 'reviewed').length;
      hint.textContent = `${t('atlas.contents')} · ${t('atlas.pages', { n: formatNumber(pages) })}`;
      hint.hidden = !pages;
    }
  }

  /** Hover: a pointer cursor over a state or a line and, on fine pointers, its name. */
  function renderHover() {
    const r = store.get('regions');
    const id = store.get('hover');
    const p = store.get('pointer');
    const line = store.get('hoverLine');
    const u = line || (id && r ? r.byId[id] : null);
    canvas.dataset.hover = u ? '1' : '';
    if (!u || !p || !fine.matches) { tooltip.hidden = true; return; }
    tooltip.textContent = pick(u.name);
    const rect = canvas.getBoundingClientRect();
    tooltip.style.left = `${rect.width / 2 + p.x}px`;
    tooltip.style.top = `${rect.height / 2 - p.y}px`;
    tooltip.hidden = false;
  }

  function renderStatus(s) {
    root.body.dataset.status = s;
    status.hidden = s === 'ready' || s === 'fallback';
    const key = { loading: 'status.loading', error: 'status.error', 'context-lost': 'status.loading' }[s] || 'status.loading';
    statusText.textContent = t(key);
    retry.hidden = s !== 'error';
  }

  /** Everything that reads the layers on show: the catalogue and the strip. */
  function renderLayers() {
    queue(renderLayerList, renderStrip);
  }

  // The slider changes only the numbers on its own row; rebuilding the list would also
  // replace the slider under the finger on every step of the drag.
  store.subscribe('relief', (relief, _, meta) => {
    const key = layerList.querySelector('[data-base="relief"] .layer-key');
    if (meta.source === 'slider' && key) key.textContent = t('relief.hint', { n: formatNumber(relief.amount) });
    else queue(renderLayerList);
  });
  store.subscribe('surroundings', later(renderLayerList));
  store.subscribe('graticule', later(renderLayerList));
  store.subscribe('regions', later(renderUnits, renderSheet, renderList), { immediate: true });
  for (const k of ['selection', 'level', 'drafts', 'plates', 'plate', 'regional', 'month', 'catalogue']) store.subscribe(k, later(renderSheet));
  store.subscribe('item', later(renderSheet, renderSteps));
  store.subscribe('index', later(renderList));
  // The atlas's own pages, fetched once. They are small and they are the way in.
  fetch('/data/plates.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    store.set('plates', d);
    const wanted = store.get('plate');
    if (wanted && d.plates.some((p) => p.id === wanted)) openPlateById(wanted);
    else if (wanted) store.set('plate', null);
  }).catch(() => {});
  store.subscribe('plates', () => { renderPoster(); queue(renderStrip); });
  store.subscribe('plate', renderPoster);
  store.subscribe('viewport', () => renderScale(store.get('camera')));
  store.subscribe('sources', later(renderLayerList, renderStrip, renderSheet, renderCredits));
  // The source registry: every dataset once, which the legends, the pages and the credits
  // all resolve their ids through (PLAN.md section 5, "Source registry").
  fetch('/data/sources.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d) store.set('sources', d);
  }).catch(() => {});
  store.subscribe('tour', later(renderSteps));
  store.subscribe('catalog', renderLayers, { immediate: true });
  store.subscribe('layers', renderLayers);
  store.subscribe('hover', renderHover);
  store.subscribe('hoverLine', renderHover);
  store.subscribe('pointer', renderHover);
  store.subscribe('status', renderStatus, { immediate: true });
  renderLang();
  store.subscribe('lang', () => {
    renderLang();
    queue(renderLayerList, renderStrip, renderUnits, renderList, renderSheet, renderTour, renderCredits);
    renderHover();
    renderStatus(store.get('status'));
    renderScale(store.get('camera'));
  });

  // Camera padding: the wordmark on top; on phones the sheet at the bottom, up to half;
  // on wide pointer screens the sheet is a panel on the right (see style.css): India is
  // portrait-shaped, and the panel takes the dead space beside it rather than covering
  // it (PLAN.md section 3, "Layout").
  function updatePadding(animate = false) {
    if (root.body.dataset.poster) return;          // the share-image render sets its own framing
    const s = store.get('sheet') || {};
    // The sheet's visible height, up to half: an open sheet keeps the map framed above it.
    const covered = Math.min(s.visible || s.peek || 0, s.half || Infinity);
    store.set('padding', wide.matches
      ? { top: topbar.offsetHeight + 16, right: sheet.offsetWidth + 40, bottom: 36, left: 24 }
      : { top: topbar.offsetHeight + 8, right: 8, bottom: covered + 12, left: 8 }, { animate });
  }
  wide.addEventListener('change', () => updatePadding());
  const ro = new ResizeObserver(() => updatePadding());
  ro.observe(topbar);
  store.subscribe('sheet', () => updatePadding(true));
  store.subscribe('viewport', () => updatePadding());
  updatePadding();
}
