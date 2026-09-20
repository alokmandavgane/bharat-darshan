// @ts-check
// Header, layer chips, relief slider, status toast and the sheet's content. Plain DOM,
// bound to the store; every string comes from i18n.
import { formatNumber, t } from '../i18n/index.js';

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
  const topbar = $('.topbar');
  const controls = $('.controls');

  langBtn.addEventListener('click', () => store.set('lang', store.get('lang') === 'en' ? 'hi' : 'en'));
  reliefChip.addEventListener('click', () => store.set('relief', { on: !store.get('relief').on }, { animate: true }));
  slider.addEventListener('input', () => store.set('relief', { amount: Number(slider.value), on: true }));
  retry.addEventListener('click', () => location.reload());

  function renderRelief(r) {
    reliefChip.setAttribute('aria-pressed', String(r.on));
    reliefRow.hidden = !r.on;
    slider.value = String(r.amount);
    sliderValue.textContent = t('relief.value', { n: formatNumber(r.amount) });
  }

  function renderRegions(r) {
    if (!r) return;
    const states = r.units.filter((u) => u.type === 'state').length;
    subtitle.textContent = t('sheet.subtitle', { states: formatNumber(states), uts: formatNumber(r.units.length - states) });
  }

  function renderStatus(s) {
    root.body.dataset.status = s;
    status.hidden = s === 'ready' || s === 'fallback';
    const key = { loading: 'status.loading', error: 'status.error', 'context-lost': 'status.loading' }[s] || 'status.loading';
    statusText.textContent = t(key);
    retry.hidden = s !== 'error';
  }

  store.subscribe('relief', renderRelief, { immediate: true });
  store.subscribe('regions', renderRegions, { immediate: true });
  store.subscribe('status', renderStatus, { immediate: true });
  store.subscribe('lang', () => {
    renderRelief(store.get('relief'));
    renderRegions(store.get('regions'));
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
