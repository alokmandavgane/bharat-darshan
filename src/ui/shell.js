// @ts-check
// Header, layer chips, relief slider, status toast and the sheet's content. Plain DOM,
// bound to the store; every string comes from i18n.
import { DEFAULT_CAMERA, wrapYaw } from '../engine/camera-math.js';
import { CATEGORICAL } from '../engine/choropleth.js';
import { symbolSizer } from '../engine/points.js';
import { currentLanguage, formatNumber, pick, t } from '../i18n/index.js';
import { glyphSvg } from '../glyphs.js';

/**
 * @param {Document} root
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function createShell(root, store) {
  const $ = (sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  const menuBtn = $('.menu-button');
  const menu = $('.menu');
  const langOptions = [...root.querySelectorAll('.lang-option')];
  const reliefChip = $('.chip-relief');
  const surroundingsChip = $('.chip-surroundings');
  const reliefRow = $('.relief');
  const slider = /** @type {HTMLInputElement} */ ($('.relief-slider'));
  const sliderValue = $('.relief-value');
  const status = $('.status');
  const statusText = $('.status-text');
  const retry = $('.status-retry');
  const subtitle = $('.sheet-subtitle');
  const title = $('.sheet-title');
  const alt = $('.sheet-alt');
  const closeBtn = $('.sheet-close');
  const facts = $('.facts');
  const steps = $('.card-steps');
  const stepPrev = $('.card-prev');
  const stepNext = $('.card-next');
  const stepCount = $('.card-count');
  const listWrap = $('.unit-list-wrap');
  const monthPanel = $('.month-panel');
  const list = $('.unit-list');
  const search = /** @type {HTMLInputElement} */ ($('.search'));
  const chips = $('.layer-chips');
  const scrubber = $('.scrubber');
  const scrubberRow = $('.scrubber-row');
  const sheet = $('.sheet');
  const sheetBody = $('.sheet-body');
  const infoBtn = $('.sheet-info');
  const about = $('.about');
  const aboutDraft = $('.about-draft');
  const tourBtn = $('.tour-button');
  const resetBtn = $('.reset-button');
  const tooltip = $('.tooltip');
  const canvas = $('canvas.map');
  const topbar = $('.topbar');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  // --- the menu: language, relief and layers live behind one button
  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    root.body.dataset.menu = open ? 'open' : '';
  }
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  root.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    const t = /** @type {Node} */ (e.target);
    if (!menu.contains(t) && !menuBtn.contains(t)) setMenu(false);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); e.stopImmediatePropagation(); }
  }, true);
  langOptions.forEach((b) => b.addEventListener('click', () => store.set('lang', b.dataset.lang)));
  function renderLang() {
    const lang = store.get('lang');
    langOptions.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }
  reliefChip.addEventListener('click', () => store.set('relief', { on: !store.get('relief').on }, { animate: true }));
  surroundingsChip.addEventListener('click', () => store.set('surroundings', !store.get('surroundings')));
  store.subscribe('surroundings', (on) => surroundingsChip.setAttribute('aria-pressed', String(!!on)), { immediate: true });
  slider.addEventListener('input', () => store.set('relief', { amount: Number(slider.value), on: true }));
  retry.addEventListener('click', () => location.reload());
  // The card's own steps walk the tour's route by hand: a card is opened by name alone
  // and the engine fills in the rest, the same way a link does.
  stepPrev.addEventListener('click', () => step(-1));
  stepNext.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', () => {
    if (store.get('item')) store.set('item', null);
    else if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    else store.set('selection', null);
  });
  scrubberRow.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-month]');
    if (!b) return;
    store.set('month', b.dataset.month ? Number(b.dataset.month) : null);
  });
  chips.addEventListener('click', (e) => {
    const chip = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]');
    if (!chip) return;
    const id = chip.dataset.layer;
    const catalog = store.get('catalog') || [];
    const active = new Set(store.get('layers')?.active || []);
    if (active.has(id)) active.delete(id);
    else {
      // Two choropleths at once would fight over the same clay, so switching one on
      // switches the others off. The type says so, never a layer's name.
      if (catalog.find((l) => l.id === id)?.type === 'choropleth') {
        for (const l of catalog) if (l.type === 'choropleth' && l.id !== id) active.delete(l.id);
      }
      active.add(id);
    }
    store.set('layers', { active: [...active] });
  });

  /**
   * The layer switches, grouped as the catalogue groups them and each carrying its
   * legend while it is on. Everything here is data: the group is a field on the layer,
   * its heading a string keyed by that field, and the swatches are the layer's own
   * categories. No layer id appears in this file.
   */
  function renderChips() {
    chips.replaceChildren();
    const active = new Set(store.get('layers')?.active || []);
    const byGroup = new Map();
    for (const layer of store.get('catalog') || []) {
      const g = layer.group || 'other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(layer);
    }
    for (const [group, list] of byGroup) {
      const section = document.createElement('div');
      section.className = 'layer-group';
      if (byGroup.size > 1) {
        const h = document.createElement('h4');
        h.textContent = t(`layer.group.${group}`, {}, group);
        section.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'chips';
      for (const layer of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip chip-layer';
        b.dataset.layer = layer.id;
        b.setAttribute('aria-pressed', String(active.has(layer.id)));
        const ic = document.createElement('span');
        ic.className = 'chip-icon';
        ic.innerHTML = glyphSvg(layer.icon);         // static markup from the glyph set only
        const label = document.createElement('span');
        label.textContent = pick(layer.title);
        b.append(ic, label);
        row.appendChild(b);
      }
      section.appendChild(row);
      for (const layer of list) {
        if (!active.has(layer.id) || layer.marker === 'label') continue;
        const legend = layerLegend(layer);
        if (legend) section.appendChild(legend);
      }
      chips.appendChild(section);
    }
  }

  /** A swatch and a name per category: a dot for points, a stroke for lines. */
  /**
   * The scrubber (PLAN.md section 9, "India through the year"): thirteen switches, the
   * whole year and each month. It appears only when something on show has months to
   * scrub, which the layer's own declared fields say, so no layer id appears here.
   */
  function renderScrubber() {
    const catalog = store.get('catalog') || [];
    // Before the catalogue lands there is nothing to say, and nothing to clear either:
    // clearing here would throw away a month the URL asked for.
    if (!catalog.length) { scrubber.hidden = true; return; }
    const active = new Set(store.get('layers')?.active || []);
    const has = catalog.some((l) => active.has(l.id)
      && Object.values(l.fields || {}).some((f) => f.type === 'month'));
    scrubber.hidden = !has;
    if (!has) {
      if (store.get('month')) store.set('month', null);
      return;
    }
    const at = store.get('month');
    const make = (value, label, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip chip-month';
      b.dataset.month = value === null ? '' : String(value);
      b.setAttribute('aria-pressed', String(at === value));
      b.textContent = label;
      if (title) b.title = title;
      return b;
    };
    scrubberRow.replaceChildren(
      make(null, t('month.all')),
      ...Array.from({ length: 12 }, (_, i) => make(i + 1, t(`month.short.${i + 1}`), t(`month.${i + 1}`))),
    );
  }

  /** A choropleth's own legend: its bands, their ranges, the unit, and any caveat. */
  function scaleLegend(layer) {
    const scale = layer.scale || [];
    if (scale.length < 2) return null;
    const out = document.createDocumentFragment();
    const ul = document.createElement('ul');
    ul.className = 'legend';
    ul.dataset.kind = 'choropleth';
    scale.forEach((band, i) => {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.setProperty('--c', band.color);
      const next = scale[i + 1];
      const label = next
        ? `${formatNumber(band.from)}\u2013${formatNumber(next.from)}`
        : `${formatNumber(band.from)}+`;
      li.append(sw, document.createTextNode(label));
      ul.appendChild(li);
    });
    out.appendChild(ul);
    // "{n} per km²" with nothing in place of the number is the unit on its own.
    const unit = pick(layer.unit || {}).replace('{n}', '').trim();
    if (unit) {
      const p = document.createElement('p');
      p.className = 'legend-unit';
      p.textContent = unit;
      out.appendChild(p);
    }
    if (layer.note) {
      const p = document.createElement('p');
      p.className = 'legend-note';
      p.textContent = pick(layer.note);
      out.appendChild(p);
    }
    return out;
  }

  function layerLegend(layer) {
    // A choropleth coloured by a numeric scale reads as ranges of a unit; one coloured by
    // category reads as its categories, like any other layer, and only the caveat differs.
    const categorical = layer.scale === CATEGORICAL;
    if (layer.type === 'choropleth' && !categorical) return scaleLegend(layer);
    const cats = layer.categories || [];
    if (cats.length < 2) return null;
    const ul = document.createElement('ul');
    ul.className = 'legend';
    ul.dataset.kind = categorical ? 'choropleth' : layer.type;
    for (const c of cats) {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.setProperty('--c', c.color || 'var(--ink)');
      li.append(sw, document.createTextNode(pick(c.title)));
      ul.appendChild(li);
    }
    const size = sizeLegend(layer);
    if (!layer.note && !size) return ul;
    const out = document.createDocumentFragment();
    out.append(ul);
    if (size) out.append(size);
    if (layer.note) {
      const p = document.createElement('p');
      p.className = 'legend-note';
      p.textContent = pick(layer.note);
      out.append(p);
    }
    return out;
  }

  /**
   * A `symbols` layer's other key: what the circles' sizes mean. The values it shows are
   * the layer's own (`size.legend`), and the circle beside each is drawn at exactly the
   * diameter the map would draw it at, by the same sizer the engine uses.
   */
  function sizeLegend(layer) {
    if (layer.marker !== 'symbol' || !layer.size?.legend?.length) return null;
    const sizer = symbolSizer(layer.size);
    const ul = document.createElement('ul');
    ul.className = 'legend legend-sizes';
    for (const v of layer.size.legend) {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'legend-size';
      sw.style.setProperty('--d', `${sizer({ [layer.size.field]: v }).toFixed(1)}px`);
      const unit = pick((layer.fields || {})[layer.size.field]?.unit || {});
      li.append(sw, document.createTextNode(unit ? unit.replace('{n}', formatNumber(v)) : formatNumber(v)));
      ul.appendChild(li);
    }
    return ul;
  }


  // --- the info button: about the map, how to use it, credits; and a card's review status
  function setAbout(open) {
    about.hidden = !open;
    infoBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    sheetBody.scrollTop = 0;
    if (store.get('sheet')?.snap === 'peek') store.set('sheetSnap', { name: 'half', t: performance.now() });
  }
  infoBtn.addEventListener('click', () => setAbout(about.hidden));
  /** Drafts turn the info button terracotta; its tooltip says so, and the about text leads with it. */
  function setDraft(isDraft) {
    sheet.dataset.draft = isDraft ? '1' : '';
    aboutDraft.hidden = !isDraft;
    const label = isDraft ? t('facts.draft') : t('sheet.about.heading');
    infoBtn.setAttribute('aria-label', label);
    infoBtn.title = label;
  }

  // --- corner controls: the tour and the compass (home)
  resetBtn.addEventListener('click', () => store.set('home', { t: performance.now() }));
  store.subscribe('home', (req) => {
    if (!req) return;
    if (store.get('item')) store.set('item', null);
    if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'home' });
    if (store.get('selection')) store.set('selection', null);
    setAbout(false);
    store.set('sheetSnap', { name: 'peek', t: performance.now() });
  });
  // The needle turns with the map. Now that the model goes the whole way round, the
  // compass is the only way back to north from a turned view, so it says so when the
  // view is turned rather than sitting there looking like decoration (F3).
  store.subscribe('camera', (c) => {
    resetBtn.style.setProperty('--yaw', `${c.yaw.toFixed(1)}deg`);
    const turned = Math.abs(wrapYaw(c.yaw - DEFAULT_CAMERA.yaw)) > 8;
    resetBtn.dataset.turned = turned ? 'yes' : '';
    const label = t(turned ? 'view.north' : 'view.reset');
    resetBtn.setAttribute('aria-label', label);
    resetBtn.title = label;
  }, { immediate: true });
  tourBtn.addEventListener('click', () => store.set('tour', { playing: !store.get('tour')?.playing }));
  function renderTour() {
    const tr = store.get('tour') || {};
    const playing = !!tr.playing;
    tourBtn.hidden = !playing && !tr.total;
    tourBtn.setAttribute('aria-pressed', String(playing));
    const label = t(playing ? 'tour.pause' : 'tour.play');
    tourBtn.setAttribute('aria-label', label);
    tourBtn.title = label;
    root.body.dataset.tour = playing ? 'playing' : '';
  }
  store.subscribe('tour', (tr, prev) => {
    renderTour();
    // the cards read best with the sheet half open; the map is framed above it
    if (tr?.playing && !prev?.playing) { setAbout(false); store.set('sheetSnap', { name: 'half', t: performance.now() }); }
  }, { immediate: true });
  search.addEventListener('input', () => renderList());
  facts.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]');
    if (!btn) return;
    store.set('item', { layer: btn.dataset.layer, id: btn.dataset.item, data: null, categories: null, fields: null });
  });
  list.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-id], button[data-layer]');
    if (!btn) return;
    if (btn.dataset.layer) {
      // A found item is opened by name alone; the engine fills it in and flies to it.
      store.set('item', { layer: btn.dataset.layer, id: btn.dataset.item, data: null, categories: null, fields: null });
      store.set('sheetSnap', { name: 'peek', t: performance.now() });
      return;
    }
    const id = Number(btn.dataset.id);
    store.set('selection', id);
    // Picking from the list goes as deep as tapping the map does.
    if (store.get('level')?.id !== id) store.set('level', { name: 'state', id }, { source: 'ui' });
    store.set('sheetSnap', { name: 'peek', t: performance.now() });
  });

  function renderRelief(r) {
    reliefChip.setAttribute('aria-pressed', String(r.on));
    reliefRow.hidden = !r.on;
    slider.value = String(r.amount);
    sliderValue.textContent = t('relief.value', { n: formatNumber(r.amount) });
  }

  /** Names other than the one shown as the title: the other UI language, then the native script. */
  function otherNames(u) {
    const cur = currentLanguage();
    const parts = [cur === 'hi' ? u.name.en : u.name.hi, u.name.native];
    return parts.filter((n, i, a) => n && n !== u.name[cur] && a.indexOf(n) === i).join(' · ');
  }

  const SEARCH_HITS = 40;      // enough to find anything, few enough to stay light on a phone

  /** One row of the list: a button with its name and a quieter second line. */
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

  /**
   * Every unit, so each one is reachable without hitting it, and -- once something is
   * typed -- whatever the layers on show can also answer with. The engine publishes that
   * index, so this searches exactly what is drawn: a state view finds that state's places.
   */
  function renderList() {
    const r = store.get('regions');
    if (!r) return;
    const lang = currentLanguage();
    const q = search.value.trim().toLowerCase();
    const hit = (name) => Object.values(name || {}).some((n) => n && String(n).toLowerCase().includes(q));
    const units = r.units.filter((u) => !q || hit(u.name)).sort((a, b) => pick(a.name).localeCompare(pick(b.name), lang));
    const rows = units.map((u) => listRow(pick(u.name), otherNames(u), { id: String(u.id) }));
    if (q) {
      const catalog = store.get('catalog') || [];
      for (const x of (store.get('index') || []).filter((i) => hit(i.name)).slice(0, SEARCH_HITS)) {
        const layer = catalog.find((l) => l.id === x.layer);
        rows.push(listRow(pick(x.name), layer ? pick(layer.title) : '', { layer: x.layer, item: x.id }));
      }
    }
    list.replaceChildren(...rows);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  /** The fact card for a unit: structured, sourced, shown only once reviewed (or with drafts on). */
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

  /**
   * With a month chosen and no state lifted, the sheet answers for the whole country:
   * what falls in it, and where. The engine's index is already narrowed to the month,
   * so this is only the rendering of it.
   */
  function renderMonth() {
    monthPanel.replaceChildren();
    const month = store.get('month');
    monthPanel.hidden = !month;
    if (!month) return;
    const name = t(`month.${month}`);
    const h = document.createElement('h2');
    h.className = 'facts-heading';
    h.textContent = t('sheet.month.heading', { month: name });
    const rows = (store.get('regional') || [])
      // Only layers that are about time at all. A language is not in any month, and
      // listing every one of them under April is not what the year asked.
      .filter((layer) => Object.values(layer.fields || {}).some((f) => f.type === 'month'))
      .flatMap((layer) => {
        // Within those, items with a month of their own and those with none: Eid can
        // fall in any month, so leaving it out of every list would be the wrong tidy.
        const keep = (layer.items || []).filter((i) => (i.month === month || !i.month)
          && (store.get('drafts') || i.status === 'reviewed'));
        return keep.map((i) => ({ layer, item: i }));
      });
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'legend-note';
      p.textContent = t('scrubber.none', { month: name });
      monthPanel.append(h, p);
      return;
    }
    const r = store.get('regions');
    const ul = document.createElement('ul');
    ul.className = 'facts-list';
    for (const { layer, item } of rows) {
      const where = (item.regions || []).map((x) => r?.byId?.[x]).filter(Boolean);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.layer = layer.id;
      b.dataset.item = item.id;
      const nm = document.createElement('span');
      nm.textContent = pick(item.name);
      const sub = document.createElement('span');
      sub.className = 'facts-list-when';
      sub.textContent = where.length > 3
        ? t('facts.regions', { n: formatNumber(where.length) })
        : where.map((x) => pick(x.name)).join(', ');
      b.append(nm, sub);
      li.appendChild(b);
      ul.appendChild(li);
    }
    monthPanel.append(h, ul);
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

  /** The prev / next row, shown only while the open card is one of several stops. */
  function renderSteps() {
    const stops = store.get('tour')?.stops || [];
    const at = stepIndex();
    steps.hidden = at < 0 || stops.length < 2 || !!store.get('tour')?.playing;
    if (steps.hidden) return;
    stepCount.textContent = t('card.count', { n: formatNumber(at + 1), total: formatNumber(stops.length) });
  }

  /** The sheet head and body: an item, the selected unit (peek card or state view), or the country with its list. */
  function renderSelection() {
    const r = store.get('regions');
    const sel = store.get('item');
    // The month panel answers for the whole country; a card of its own is on top of it.
    monthPanel.hidden = true;
    if (sel?.data && r) {
      const it = sel.data;
      const layer = (store.get('catalog') || []).find((l) => l.id === sel.layer);
      const cat = (sel.categories || []).find((c) => c.id === it.category);
      document.body.dataset.selection = it.id;
      closeBtn.hidden = false;
      closeBtn.setAttribute('aria-label', t('sheet.close'));
      closeBtn.textContent = '×';
      listWrap.hidden = true;
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
      facts.hidden = false;
      facts.replaceChildren();
      // A line item knows how far it runs inside India; a point has no such number.
      if (typeof it.km === 'number') {
        facts.appendChild(factRow(t('facts.length'), t('facts.km', { n: formatNumber(Math.round(it.km)) })));
      }
      // Columns the layer declared for itself (PLAN.md section 5): label and unit are data.
      for (const [name, spec] of Object.entries(sel.fields || {})) {
        const v = it[name];
        if (v === undefined || v === null) continue;
        // A year is a number but not a quantity: 1866, not 1,866. A month names itself.
        const shown = spec.type === 'month' ? t(`month.${v}`)
          : typeof v === 'number' && spec.type !== 'year' ? formatNumber(v) : String(v);
        facts.appendChild(factRow(pick(spec.label), spec.unit ? pick(spec.unit).replace('{n}', shown) : shown));
      }
      const p = document.createElement('p');
      p.className = 'facts-blurb';
      p.textContent = pick(it.blurb);
      facts.appendChild(p);
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
      return;
    }
    const id = store.get('selection');
    const u = id && r ? r.byId[id] : null;
    const inState = store.get('level')?.name === 'state';
    document.body.dataset.selection = u ? u.slug : '';
    document.body.dataset.level = inState ? 'state' : 'country';
    closeBtn.hidden = !u && !inState;
    closeBtn.setAttribute('aria-label', t(inState ? 'sheet.back' : 'sheet.close'));
    closeBtn.textContent = inState ? '←' : '×';
    facts.hidden = !u;
    listWrap.hidden = !!u;
    if (!u) {
      renderList();
      renderMonth();
      setDraft(false);
      title.textContent = t('sheet.title');
      alt.hidden = true;
      if (r) {
        const states = r.units.filter((x) => x.type === 'state').length;
        subtitle.textContent = t('sheet.subtitle', { states: formatNumber(states), uts: formatNumber(r.units.length - states) });
      }
      return;
    }
    title.textContent = pick(u.name);
    const others = otherNames(u);
    alt.textContent = others;
    alt.hidden = !others;
    subtitle.textContent = t(u.type === 'ut' ? 'unit.ut' : 'unit.state');
    if (!u.facts) setDraft(false);
    renderFacts(u);
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

  store.subscribe('relief', renderRelief, { immediate: true });
  store.subscribe('regions', renderSelection, { immediate: true });
  store.subscribe('selection', renderSelection);
  store.subscribe('level', renderSelection);
  store.subscribe('drafts', renderSelection);
  store.subscribe('item', () => { renderSelection(); renderSteps(); });
  store.subscribe('index', renderList);
  store.subscribe('regional', () => { renderSelection(); renderScrubber(); });
  store.subscribe('month', () => { renderScrubber(); renderSelection(); });
  store.subscribe('tour', renderSteps);
  for (const key of ['selection', 'level', 'item']) store.subscribe(key, () => setAbout(false));
  store.subscribe('catalog', () => { renderChips(); renderScrubber(); }, { immediate: true });
  store.subscribe('layers', () => { renderChips(); renderScrubber(); });
  store.subscribe('hover', renderHover);
  store.subscribe('hoverLine', renderHover);
  store.subscribe('pointer', renderHover);
  store.subscribe('status', renderStatus, { immediate: true });
  renderLang();
  store.subscribe('lang', () => {
    renderLang();
    renderRelief(store.get('relief'));
    renderChips();
    renderSelection();
    renderHover();
    renderStatus(store.get('status'));
    renderTour();
  });

  // Camera padding: header on top; on phones the sheet peek at the bottom; on wide
  // pointer screens the sheet is a side panel (see style.css).
  const wide = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
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
