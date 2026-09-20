// @ts-check
// Reports that a person is at the controls: a pointer, wheel, touch or key anywhere in
// the app, throttled. The engine's idle sway listens for it (src/engine/idle.js).

const THROTTLE_MS = 250;

/**
 * @param {Document} root
 * @param {ReturnType<import('../state/store.js').createStore>} store
 */
export function watchActivity(root, store) {
  let last = 0;
  const mark = () => {
    const now = performance.now();
    if (now - last < THROTTLE_MS) return;
    last = now;
    store.set('activity', now);
  };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
    root.addEventListener(type, mark, { passive: true, capture: true });
  }
}
