// @ts-check
// The bottom sheet: three snap points (peek, half, full), dragged by its grip, animated
// with a CSS transition. It reports its heights as camera padding so the map keeps
// the selection centred above it (PLAN.md section 3).
import { reducedMotion } from '../engine/tween.js';

const SNAPS = ['peek', 'half', 'full'];

/**
 * @param {HTMLElement} el  the .sheet element
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function createSheet(el, store) {
  const grip = /** @type {HTMLElement} */ (el.querySelector('.sheet-grip'));
  const head = /** @type {HTMLElement} */ (el.querySelector('.sheet-head'));
  const body = /** @type {HTMLElement} */ (el.querySelector('.sheet-body'));
  let snap = store.get('sheet')?.snap || 'peek';
  let drag = null;

  const heights = () => {
    const vh = window.innerHeight;
    const peek = grip.offsetHeight + head.offsetHeight;
    return { peek, half: Math.round(vh * 0.5), full: Math.round(vh * 0.9) };
  };

  function visibleFor(name) {
    return heights()[name];
  }

  function place(visible, animate) {
    el.style.transition = animate && !reducedMotion() ? 'transform 260ms cubic-bezier(.2,.8,.2,1)' : 'none';
    el.style.transform = `translateY(calc(100% - ${Math.round(visible)}px))`;
  }

  function setSnap(name, animate = true) {
    snap = name;
    el.dataset.snap = name;
    document.body.dataset.sheet = name;
    const h = heights();
    // The body ends exactly at the bottom of the screen, so it scrolls to its last line
    // whenever the sheet is open; at peek only the head shows and nothing scrolls.
    body.style.height = `${Math.max(0, h[name] - h.peek)}px`;
    body.style.overflowY = name === 'peek' ? 'hidden' : 'auto';
    if (name === 'peek') body.scrollTop = 0;
    document.body.style.setProperty('--sheet-peek', `${h.peek}px`);
    place(h[name], animate);
    store.set('sheet', { snap: name, peek: h.peek, half: h.half, visible: h[name] });
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { y0: e.clientY, start: visibleFor(snap), last: e.clientY, t: performance.now(), v: 0 };
    grip.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    const now = performance.now();
    drag.v = (e.clientY - drag.last) / Math.max(1, now - drag.t);   // px per ms, + = down
    drag.last = e.clientY; drag.t = now;
    const h = heights();
    const visible = Math.min(h.full + 40, Math.max(h.peek - 20, drag.start - (e.clientY - drag.y0)));
    place(visible, false);
  }

  function onUp(e) {
    if (!drag) return;
    const h = heights();
    const visible = drag.start - (e.clientY - drag.y0);
    let best = SNAPS.reduce((a, b) => (Math.abs(h[b] - visible) < Math.abs(h[a] - visible) ? b : a), 'peek');
    // A flick moves one step in its direction.
    if (Math.abs(drag.v) > 0.6) {
      const i = SNAPS.indexOf(snap);
      best = SNAPS[Math.max(0, Math.min(SNAPS.length - 1, i + (drag.v < 0 ? 1 : -1)))];
    }
    drag = null;
    setSnap(best);
  }

  grip.addEventListener('pointerdown', onDown);
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onUp);
  // A tap on the head opens or closes the sheet; its buttons keep their own meaning.
  head.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button, a')) return;
    setSnap(snap === 'peek' ? 'half' : 'peek');
  });
  grip.addEventListener('keydown', (e) => {
    const i = SNAPS.indexOf(snap);
    if (e.key === 'ArrowUp') setSnap(SNAPS[Math.min(2, i + 1)]);
    else if (e.key === 'ArrowDown' || e.key === 'Escape') setSnap(SNAPS[Math.max(0, i - 1)]);
  });
  window.addEventListener('resize', () => setSnap(snap, false));
  store.subscribe('sheetSnap', (req) => { if (req && SNAPS.includes(req.name)) setSnap(req.name); });
  new ResizeObserver(() => setSnap(snap, false)).observe(head);

  // First layout after fonts settle so the peek height is measured right.
  setSnap(snap, false);
  requestAnimationFrame(() => setSnap(snap, false));
  return { setSnap, get snap() { return snap; } };
}
