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
  const langBtn = $('.lang-toggle');
  const reliefChip = $('.chip-relief');
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
  const tooltip = $('.tooltip');
  const canvas = $('canvas.map');
  const topbar = $('.topbar');
  const controls = $('.controls');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  langBtn.addEventListener('click', () => store.set('lang', store.get('lang') === 'en' ? 'hi' : 'en'));
  reliefChip.addEventListener('click', () => store.set('relief', { on: !store.get('relief').on }, { animate: true }));
  slider.addEventListener('input', () => store.set('relief', { amount: Number(slider.value), on: true }));
  retry.addEventListener('click', () => location.reload());
  closeBtn.addEventListener('click', () => store.set('selection', null));

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

  /** The sheet head: the selected unit, or the country. */
  function renderSelection() {
    const r = store.get('regions');
    const id = store.get('selection');
    const u = id && r ? r.byId[id] : null;
    document.body.dataset.selection = u ? u.slug : '';
    closeBtn.hidden = !u;
    if (!u) {
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
  store.subscribe('hover', renderHover);
  store.subscribe('pointer', renderHover);
  store.subscribe('status', renderStatus, { immediate: true });
  store.subscribe('lang', () => {
    renderRelief(store.get('relief'));
    renderSelection();
    renderHover();
    renderStatus(store.get('status'));
  });

  // Camera padding: header on top; on phones the controls and the sheet peek at the
  // bottom; on wide pointer screens the sheet is a side panel (see style.css).
  const sheet = $('.sheet');
  const wide = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
  function updatePadding() {
    const peek = store.get('sheet')?.peek || 0;
    store.set('padding', wide.matches
      ? { top: topbar.offsetHeight + 16, right: sheet.offsetWidth + 40, bottom: controls.offsetHeight + 36, left: 24 }
      : { top: topbar.offsetHeight + 8, right: 8, bottom: peek + controls.offsetHeight + 8, left: 8 });
  }
  wide.addEventListener('change', updatePadding);
  const ro = new ResizeObserver(updatePadding);
  ro.observe(topbar);
  ro.observe(controls);
  store.subscribe('sheet', updatePadding);
  store.subscribe('viewport', updatePadding);
  updatePadding();
}
