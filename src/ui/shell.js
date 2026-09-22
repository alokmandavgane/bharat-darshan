// @ts-check
// Header, menu, the key on the map, status toast and the sheet's content. Plain DOM,
// bound to the store; every string comes from i18n.
import { DEFAULT_CAMERA, kmPerPixel, wrapYaw } from '../engine/camera-math.js';
import { FILL_TYPES } from '../engine/choropleth.js';
import { currentLanguage, formatNumber, pick, t } from '../i18n/index.js';
import { DEFAULT_RELIEF } from '../state/url.js';
import { citeLabel, creditList, hostOf, sourceList } from './credits.js';
import { firstColour, kindOf, layerKey, layerMark } from './legend.js';
import { scaleBar } from './scale.js';

// Static icons for the rows the shell builds; the layer marks come from legend.js.
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

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
  const graticuleChip = $('.chip-graticule');
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
  const finder = $('.finder');
  const list = $('.unit-list');
  const search = /** @type {HTMLInputElement} */ ($('.search'));
  const units = /** @type {HTMLDetailsElement} */ ($('.units'));
  const unitsCount = $('.units-count');
  const unitGrid = $('.unit-grid');
  const contents = $('.contents');
  const layerList = $('.layer-list');
  const menuSearch = /** @type {HTMLInputElement} */ ($('.menu-search'));
  const menuNone = $('.menu-none');
  const sheet = $('.sheet');
  const sheetBody = $('.sheet-body');
  const infoBtn = $('.sheet-info');
  const about = $('.about');
  const aboutDraft = $('.about-draft');
  const credits = $('.credits');
  const kicker = $('.wordmark .kicker');
  const cartouche = $('.cartouche');
  const cartoucheSection = $('.cartouche-section');
  const cartoucheTitle = $('.cartouche-title');
  const corner = $('.corner');
  const key = $('.key');
  const keyHead = $('.key-head');
  const keyMarks = $('.key-marks');
  const keyRows = $('.key-rows');
  const scale = $('.scale');
  const scaleBarEl = $('.scale-bar');
  const scaleLabel = $('.scale-label');
  const posterTitle = $('.wordmark .title');
  const posterOther = $('.wordmark .title-other');
  const posterTagline = $('.wordmark .tagline');
  const tourBtn = $('.tour-button');
  const resetBtn = $('.reset-button');
  const tooltip = $('.tooltip');
  const canvas = $('canvas.map');
  const topbar = $('.topbar');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  // On wide pointer screens the sheet is a side panel and the key has room to stay open;
  // on a phone the key starts folded and opens itself when a page is turned to.
  const wide = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');

  /** The plate on show, as the file describes it, or null. */
  const openPlate = () => {
    const id = store.get('plate');
    return id ? (store.get('plates')?.plates || []).find((p) => p.id === id) || null : null;
  };

  // --- the menu: the view and every layer, behind one button
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

  /**
   * The menu's own search: typing narrows the layers and the view's switches to those
   * whose names, keys or group headings match, in whichever language is showing.
   */
  function filterMenu() {
    const q = menuSearch.value.trim().toLowerCase();
    menu.dataset.finding = q ? '1' : '';
    let shown = 0;
    for (const group of menu.querySelectorAll('.layer-group')) {
      const heading = group.querySelector('h4')?.textContent?.toLowerCase() || '';
      let any = false;
      for (const row of group.querySelectorAll('.layer-row')) {
        const hit = !q || heading.includes(q) || (row.textContent || '').toLowerCase().includes(q);
        /** @type {HTMLElement} */ (row).hidden = !hit;
        any = any || hit;
      }
      /** @type {HTMLElement} */ (group).hidden = !any;
      if (any) shown++;
    }
    let toggles = 0;
    for (const b of menu.querySelectorAll('.toggle')) {
      const hit = !q || (b.textContent || '').toLowerCase().includes(q);
      /** @type {HTMLElement} */ (b).hidden = !hit;
      if (hit) toggles++;
    }
    const view = /** @type {HTMLElement} */ (menu.querySelector('.menu-view'));
    view.dataset.empty = toggles ? '' : '1';
    menuNone.hidden = !q || !!(shown + toggles);
  }
  menuSearch.addEventListener('input', filterMenu);
  menuSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuSearch.value) { menuSearch.value = ''; filterMenu(); e.stopPropagation(); }
  });
  menuBtn.addEventListener('click', () => {
    // A field that takes focus on a phone brings the keyboard up over the list; on a
    // fine pointer it is where the hand goes next.
    if (!menu.hidden && fine.matches) menuSearch.focus({ preventScroll: true });
  });
  langOptions.forEach((b) => b.addEventListener('click', () => store.set('lang', b.dataset.lang)));
  function renderLang() {
    const lang = store.get('lang');
    langOptions.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }
  reliefChip.addEventListener('click', () => store.set('relief', { on: !store.get('relief').on }, { animate: true }));
  surroundingsChip.addEventListener('click', () => store.set('surroundings', !store.get('surroundings')));
  store.subscribe('surroundings', (on) => surroundingsChip.setAttribute('aria-pressed', String(!!on)), { immediate: true });
  graticuleChip.addEventListener('click', () => store.set('graticule', !store.get('graticule')));
  store.subscribe('graticule', (on) => graticuleChip.setAttribute('aria-pressed', String(!!on)), { immediate: true });
  slider.addEventListener('input', () => store.set('relief', { amount: Number(slider.value), on: true }));
  retry.addEventListener('click', () => location.reload());
  // The card's own steps walk the tour's route by hand: a card is opened by name alone
  // and the engine fills in the rest, the same way a link does.
  stepPrev.addEventListener('click', () => step(-1));
  stepNext.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', () => {
    if (store.get('item')) store.set('item', null);
    else if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    else if (store.get('selection')) store.set('selection', null);
    else if (store.get('plate')) closePlate();
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
  /** A row's switch, a page's row and a key's eye all say the same thing to the store. */
  const onLayerClick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]:not([data-item])');
    if (b) toggleLayer(b.dataset.layer);
  };
  layerList.addEventListener('click', onLayerClick);
  keyRows.addEventListener('click', onLayerClick);

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
   * same row serves the menu and an open page, and everything on it is read off the
   * layer's declared type and colours (PLAN.md D5).
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
   * The menu's layer list, grouped as the catalogue groups them: the group is a field
   * on the layer and its heading a string keyed by that field. No layer id appears here.
   */
  function renderLayerList() {
    layerList.replaceChildren();
    const active = new Set(store.get('layers')?.active || []);
    const byGroup = new Map();
    for (const layer of store.get('catalog') || []) {
      const g = layer.group || 'other';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(layer);
    }
    for (const [group, layers] of byGroup) {
      const section = document.createElement('div');
      section.className = 'layer-group';
      if (byGroup.size > 1) {
        const h = document.createElement('h4');
        h.textContent = t(`layer.group.${group}`, {}, group);
        section.appendChild(h);
      }
      for (const layer of layers) section.appendChild(layerRow(layer, active.has(layer.id)));
      layerList.appendChild(section);
    }
    if (menuSearch.value) filterMenu();
  }

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

  // --- the key on the map: what is drawn, layer by layer, with the scale bar as its foot
  //
  // Rows are the open page's layers and whatever else is on, in catalogue order; a page's
  // own layer stays listed when hidden so its eye can bring it back. The key is where a
  // reader looks up a colour, so it stays on the map rather than behind the menu.

  function setKey(open) {
    const was = key.dataset.open;
    key.dataset.open = open ? '1' : '';
    keyHead.setAttribute('aria-expanded', String(open));
    const label = t(open ? 'legend.hide' : 'legend.show');
    keyHead.setAttribute('aria-label', label);
    keyHead.title = label;
    if (was !== key.dataset.open) updatePadding(true);
  }
  keyHead.addEventListener('click', () => setKey(key.dataset.open !== '1'));
  setKey(wide.matches);
  store.subscribe('plate', (id, prev) => { if (id && id !== prev) setKey(true); });

  function renderKey() {
    const catalog = store.get('catalog') || [];
    const active = new Set(store.get('layers')?.active || []);
    const own = new Set(openPlate()?.layers || []);
    const rows = catalog.filter((l) => active.has(l.id) || own.has(l.id));
    keyRows.replaceChildren();
    keyMarks.replaceChildren();
    keyHead.hidden = !rows.length;
    const wasEmpty = key.dataset.empty;
    key.dataset.empty = rows.length ? '' : '1';
    setKey(key.dataset.open === '1');
    if (wasEmpty !== key.dataset.empty) updatePadding(true);
    for (const layer of rows) {
      const on = active.has(layer.id);
      const row = document.createElement('div');
      row.className = 'key-layer';
      row.dataset.off = on ? '' : '1';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'key-layer-head';
      head.dataset.layer = layer.id;
      head.setAttribute('aria-pressed', String(on));
      const label = t(on ? 'layer.hide' : 'layer.show', { name: pick(layer.title) });
      head.setAttribute('aria-label', label);
      head.title = label;
      const mark = document.createElement('span');
      mark.className = 'key-layer-mark';
      mark.innerHTML = layerMark(layer);
      const name = document.createElement('span');
      name.className = 'key-layer-name';
      name.textContent = pick(layer.title);
      const eye = document.createElement('span');
      eye.className = 'key-eye';
      eye.innerHTML = EYE;
      head.append(mark, name, eye);
      row.appendChild(head);
      if (on) {
        const body = document.createElement('div');
        body.className = 'key-layer-body';
        const k = keyFor(layer, {});
        if (k) body.appendChild(k);
        else {
          const hint = keyHint(layer);
          if (hint) {
            const p = document.createElement('p');
            p.className = 'legend-note';
            p.textContent = hint;
            body.appendChild(p);
          }
        }
        // A layer with no key still owes the reader its source, so the line goes on
        // whatever is drawn -- a legend is a nicety, a citation is not (PLAN.md 5).
        const src = sourceNote(layer.sources, LEGEND_SOURCES);
        if (src) body.appendChild(src);
        if (body.hasChildNodes()) row.appendChild(body);
        const m = document.createElement('span');
        m.innerHTML = layerMark(layer);
        keyMarks.appendChild(m);
      }
      keyRows.appendChild(row);
    }
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
    renderScale(c);
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
    store.set('layers', { active: [...plate.layers] });
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

  /** The open page's own words, its sources, and its layers as rows with switches. */
  function renderPage(plate) {
    // The way back, said in words above the page's own. The arrow in the head does the
    // same thing, but an arrow on its own does not say where it goes, and a reader who
    // has turned to a page should not have to guess how to get back to the contents.
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'contents-back';
    back.textContent = t('atlas.back');
    back.addEventListener('click', () => { closePlate(); sheetBody.scrollTop = 0; });
    contents.appendChild(back);
    const p = document.createElement('p');
    p.className = 'contents-blurb';
    p.textContent = pick(plate.blurb);
    contents.appendChild(p);
    // A page cannot show a map without saying whose it is: the build unions its layers'
    // sources into the plate, so this line is never the page's own promise (PLAN.md D11).
    const src = sourceNote(plate.sources);
    if (src) contents.appendChild(src);
    const catalog = store.get('catalog') || [];
    const active = new Set(store.get('layers')?.active || []);
    const layers = (plate.layers || []).map((id) => catalog.find((l) => l.id === id)).filter(Boolean);
    if (!layers.length) return;
    const h = document.createElement('h4');
    h.className = 'contents-section';
    h.textContent = t('sheet.page.layers');
    const rows = document.createElement('div');
    rows.className = 'layer-list page-layers';
    for (const layer of layers) rows.appendChild(layerRow(layer, active.has(layer.id)));
    contents.append(h, rows);
  }

  contents.addEventListener('click', (e) => {
    const el = /** @type {HTMLElement} */ (e.target);
    const page = el.closest('button[data-plate]');
    if (page) { openPlateById(page.dataset.plate || ''); return; }
    onLayerClick(e);
  });

  // --- atlas furniture: the page's title on the map, and how big the map is
  //
  // Both are what a printed plate carries in its corners. The cartouche says which page
  // is open when the sheet is down, and is the way back to the contents from the map
  // itself; the scale bar says what the model's size means.

  function renderCartouche() {
    const plate = openPlate();
    // Inside a state the sheet belongs to that state, and the page's title would be
    // claiming more than it covers.
    const show = !!plate && store.get('level')?.name !== 'state';
    cartouche.hidden = !show;
    if (!show) return;
    cartoucheSection.textContent = t(`atlas.section.${plate.section}`, {}, plate.section);
    cartoucheTitle.textContent = pick(plate.title);
    const label = t('cartouche.aria', { name: pick(plate.title) });
    cartouche.setAttribute('aria-label', label);
    cartouche.title = label;
  }
  cartouche.addEventListener('click', () => {
    closePlate();
    store.set('sheetSnap', { name: 'half', t: performance.now() });
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

  /** The prev / next row, shown only while the open card is one of several stops. */
  function renderSteps() {
    const stops = store.get('tour')?.stops || [];
    const at = stepIndex();
    steps.hidden = at < 0 || stops.length < 2 || !!store.get('tour')?.playing;
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
      // A year is a number but not a quantity: 1866, not 1,866. A month names itself.
      const shown = spec.type === 'month' ? t(`month.${v}`)
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
   * The sheet is the subject: an item's card, the selected unit (peek card or state
   * view), the open page, or the atlas's contents. One place decides what the head says
   * and which blocks of the body show, so the body is never two answers at once.
   */
  let subject = '';
  function renderSheet() {
    const r = store.get('regions');
    const sel = store.get('item');
    const id = store.get('selection');
    const u = id && r ? r.byId[id] : null;
    const inState = store.get('level')?.name === 'state';
    const plate = openPlate();
    // A new subject starts with a clear field: results typed for the last one would
    // otherwise stand in front of this one's card.
    const now = [sel?.id || '', id || '', plate?.id || '', inState].join('|');
    if (now !== subject && search.value) { search.value = ''; renderList(); }
    subject = now;
    document.body.dataset.level = inState ? 'state' : 'country';
    sheet.dataset.view = sel?.data ? 'item' : u ? 'unit' : plate ? 'page' : 'contents';
    const show = (el, on) => { el.hidden = !on; };

    if (sel?.data && r) {
      renderItem(sel, r);
      closeBtn.hidden = false;
      closeBtn.setAttribute('aria-label', t('sheet.close'));
      closeBtn.textContent = '×';
      show(facts, true);
      show(finder, false);
      show(contents, false);
      show(units, false);
      return;
    }

    document.body.dataset.selection = u ? u.slug : '';
    show(facts, !!u);
    show(finder, true);
    show(contents, false);
    show(units, !u);
    if (u) {
      title.textContent = pick(u.name);
      const others = otherNames(u);
      alt.textContent = others;
      alt.hidden = !others;
      subtitle.textContent = t(u.type === 'ut' ? 'unit.ut' : 'unit.state');
      closeBtn.hidden = false;
      closeBtn.setAttribute('aria-label', t(inState ? 'sheet.back' : 'sheet.close'));
      closeBtn.textContent = inState ? '←' : '×';
      if (!u.facts) setDraft(false);
      renderFacts(u);
      return;
    }

    setDraft(false);
    contents.replaceChildren();
    const data = store.get('plates');
    alt.hidden = true;
    if (plate && !inState) {
      // The head is the page's: its title, where it sits, and the way back to the contents.
      title.textContent = pick(plate.title);
      const n = (plate.layers || []).length;
      subtitle.textContent = [t(`atlas.section.${plate.section}`, {}, plate.section),
        n === 1 ? t('layer.count.one') : t('layer.count', { n: formatNumber(n) })].join(' · ');
      closeBtn.hidden = false;
      closeBtn.setAttribute('aria-label', t('atlas.back'));
      closeBtn.textContent = '←';
      renderPage(plate);
      show(contents, true);
      return;
    }
    title.textContent = t('sheet.title');
    closeBtn.hidden = true;
    if (r) {
      const states = r.units.filter((x) => x.type === 'state').length;
      subtitle.textContent = t('sheet.subtitle', { states: formatNumber(states), uts: formatNumber(r.units.length - states) });
    }
    if (data && !inState) {
      renderContentsList(data);
      show(contents, true);
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

  /** Everything that reads the layers on show: the menu, the key, and an open page's rows. */
  function renderLayers() {
    renderLayerList();
    renderKey();
    if (sheet.dataset.view === 'page') renderSheet();
  }

  store.subscribe('relief', renderRelief, { immediate: true });
  store.subscribe('regions', () => { renderUnits(); renderSheet(); renderList(); }, { immediate: true });
  for (const k of ['selection', 'level', 'drafts', 'plates', 'plate', 'regional', 'month']) store.subscribe(k, renderSheet);
  store.subscribe('item', () => { renderSheet(); renderSteps(); });
  store.subscribe('index', renderList);
  store.subscribe('plate', renderKey);
  // The atlas's own pages, fetched once. They are small and they are the way in.
  fetch('/data/plates.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    store.set('plates', d);
    const wanted = store.get('plate');
    // A link to a page arrives with the page already set, so the key opens here, not
    // from the subscription that catches a page being turned to.
    if (wanted && d.plates.some((p) => p.id === wanted)) { openPlateById(wanted); setKey(true); }
    else if (wanted) store.set('plate', null);
  }).catch(() => {});
  store.subscribe('plates', () => { renderPoster(); renderCartouche(); renderKey(); });
  store.subscribe('plate', () => { renderPoster(); renderCartouche(); });
  store.subscribe('level', renderCartouche);
  store.subscribe('viewport', () => renderScale(store.get('camera')));
  store.subscribe('sources', () => { renderLayers(); renderSheet(); renderCredits(); });
  // The source registry: every dataset once, which the legends, the pages and the credits
  // all resolve their ids through (PLAN.md section 5, "Source registry").
  fetch('/data/sources.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d) store.set('sources', d);
  }).catch(() => {});
  store.subscribe('tour', renderSteps);
  for (const k of ['selection', 'level', 'item']) store.subscribe(k, () => setAbout(false));
  store.subscribe('catalog', renderLayers, { immediate: true });
  store.subscribe('layers', renderLayers);
  store.subscribe('hover', renderHover);
  store.subscribe('hoverLine', renderHover);
  store.subscribe('pointer', renderHover);
  store.subscribe('status', renderStatus, { immediate: true });
  renderLang();
  store.subscribe('lang', () => {
    renderLang();
    renderRelief(store.get('relief'));
    renderLayers();
    renderUnits();
    renderList();
    renderSheet();
    renderHover();
    renderStatus(store.get('status'));
    renderTour();
    renderCredits();
    renderCartouche();
    renderScale(store.get('camera'));
  });

  // Camera padding: header on top; on phones the sheet peek at the bottom; on wide
  // pointer screens the sheet is a side panel and the key, while open, a column on the
  // left (see style.css): India is portrait-shaped, and the panels take the dead space
  // either side of it rather than covering it (PLAN.md section 3, "Layout").
  function updatePadding(animate = false) {
    if (root.body.dataset.poster) return;          // the share-image render sets its own framing
    const s = store.get('sheet') || {};
    // The sheet's visible height, up to half: an open sheet keeps the map framed above it.
    const covered = Math.min(s.visible || s.peek || 0, s.half || Infinity);
    const keyOpen = key.dataset.open === '1' && key.dataset.empty !== '1';
    store.set('padding', wide.matches
      ? { top: topbar.offsetHeight + 16, right: sheet.offsetWidth + 40, bottom: 36, left: keyOpen ? corner.offsetWidth + 40 : 24 }
      : { top: topbar.offsetHeight + 8, right: 8, bottom: covered + 12, left: 8 }, { animate });
  }
  wide.addEventListener('change', () => updatePadding());
  const ro = new ResizeObserver(() => updatePadding());
  ro.observe(topbar);
  store.subscribe('sheet', () => updatePadding(true));
  store.subscribe('viewport', () => updatePadding());
  updatePadding();
}
