// @ts-check
// Header, layer chips, relief slider, status toast and the sheet's content. Plain DOM,
// bound to the store; every string comes from i18n.
import { currentLanguage, formatNumber, pick, t } from '../i18n/index.js';

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
  const exploreBtn = $('.sheet-explore');
  const facts = $('.facts');
  const listWrap = $('.unit-list-wrap');
  const list = $('.unit-list');
  const search = /** @type {HTMLInputElement} */ ($('.search'));
  const chips = $('.layer-chips');
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
  closeBtn.addEventListener('click', () => {
    if (store.get('item')) store.set('item', null);
    else if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    else store.set('selection', null);
  });
  chips.addEventListener('click', (e) => {
    const chip = /** @type {HTMLElement} */ (e.target).closest('button[data-layer]');
    if (!chip) return;
    const id = chip.dataset.layer;
    const active = new Set(store.get('layers')?.active || []);
    if (active.has(id)) active.delete(id); else active.add(id);
    store.set('layers', { active: [...active] });
  });

  /** One chip per layer in the catalogue (data, never ids), after the Relief chip. */
  function renderChips() {
    chips.querySelectorAll('button[data-layer]').forEach((b) => b.remove());
    const active = new Set(store.get('layers')?.active || []);
    for (const layer of store.get('catalog') || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.layer = layer.id;
      b.setAttribute('aria-pressed', String(active.has(layer.id)));
      b.textContent = pick(layer.title);
      chips.appendChild(b);
    }
  }


  exploreBtn.addEventListener('click', () => {
    const id = store.get('selection');
    if (id) store.set('level', { name: 'state', id }, { source: 'ui' });
  });
  search.addEventListener('input', () => renderList());
  list.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-id]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    store.set('selection', id);
    store.set('focus', { id, t: performance.now() });
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

  /** Sorted, filtered list of every unit so each one is reachable without hitting it. */
  function renderList() {
    const r = store.get('regions');
    if (!r) return;
    const lang = currentLanguage();
    const q = search.value.trim().toLowerCase();
    const match = (u) => !q || Object.values(u.name).some((n) => n && n.toLowerCase().includes(q));
    const units = r.units.filter(match).sort((a, b) => pick(a.name).localeCompare(pick(b.name), lang));
    list.replaceChildren(...units.map((u) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = String(u.id);
      const main = document.createElement('span');
      main.className = 'unit-list-name';
      main.textContent = pick(u.name);
      const alt = document.createElement('span');
      alt.className = 'unit-list-alt';
      alt.textContent = otherNames(u);
      b.append(main, alt);
      li.appendChild(b);
      return li;
    }));
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
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
      return;
    }
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
    if (f.status !== 'reviewed') {
      const p = document.createElement('p');
      p.className = 'facts-draft';
      p.textContent = t('facts.draft');
      facts.appendChild(p);
    }
  }

  /** The sheet head and body: an item, the selected unit (peek card or state view), or the country with its list. */
  function renderSelection() {
    const r = store.get('regions');
    const sel = store.get('item');
    if (sel?.data && r) {
      const it = sel.data;
      const layer = (store.get('catalog') || []).find((l) => l.id === sel.layer);
      const cat = (sel.categories || []).find((c) => c.id === it.category);
      document.body.dataset.selection = it.id;
      closeBtn.hidden = false;
      closeBtn.setAttribute('aria-label', t('sheet.close'));
      closeBtn.textContent = '×';
      exploreBtn.hidden = true;
      listWrap.hidden = true;
      title.textContent = pick(it.name);
      const others = otherNames({ name: it.name });
      alt.textContent = others;
      alt.hidden = !others;
      const region = r.byId[it.region];
      subtitle.textContent = [cat ? pick(cat.title) : pick(layer?.title), region ? pick(region.name) : ''].filter(Boolean).join(' · ');
      facts.hidden = false;
      facts.replaceChildren();
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
      if (it.status !== 'reviewed') {
        const pd = document.createElement('p');
        pd.className = 'facts-draft';
        pd.textContent = t('facts.draft');
        facts.appendChild(pd);
      }
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
    exploreBtn.hidden = !u || inState;
    facts.hidden = !u;
    listWrap.hidden = !!u;
    if (!u) {
      renderList();
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
    renderFacts(u);
  }

  /** Hover: a pointer cursor over a state and, on fine pointers, a tooltip with its name. */
  function renderHover() {
    const r = store.get('regions');
    const id = store.get('hover');
    const p = store.get('pointer');
    const u = id && r ? r.byId[id] : null;
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
  store.subscribe('item', renderSelection);
  store.subscribe('catalog', renderChips, { immediate: true });
  store.subscribe('layers', renderChips);
  store.subscribe('hover', renderHover);
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
  });

  // Camera padding: header on top; on phones the sheet peek at the bottom; on wide
  // pointer screens the sheet is a side panel (see style.css).
  const sheet = $('.sheet');
  const wide = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
  function updatePadding() {
    if (root.body.dataset.poster) return;          // the share-image render sets its own framing
    const peek = store.get('sheet')?.peek || 0;
    store.set('padding', wide.matches
      ? { top: topbar.offsetHeight + 16, right: sheet.offsetWidth + 40, bottom: 36, left: 24 }
      : { top: topbar.offsetHeight + 8, right: 8, bottom: peek + 12, left: 8 });
  }
  wide.addEventListener('change', updatePadding);
  const ro = new ResizeObserver(updatePadding);
  ro.observe(topbar);
  store.subscribe('sheet', updatePadding);
  store.subscribe('viewport', updatePadding);
  updatePadding();
}
