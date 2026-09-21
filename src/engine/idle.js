// @ts-check
// The idle sway: when nobody is at the controls, the camera turns gently from side to
// side about the point under the screen centre, like a model on a slow turntable.
// Any interaction stops it at once; it returns after a pause, and only while the
// country view is at rest (nothing selected, no tour, no flight). Frames are capped so
// a phone left on the table spends little on it.
import { clampCamera, groundAnchor, orbitAbout, paddedCentre } from './camera-math.js';
import { reducedMotion } from './tween.js';

export const IDLE = {
  delay: 4000,      // ms without interaction before the sway starts
  period: 28000,    // ms for one full side-to-side cycle
  yaw: 7,           // degrees either side of the resting yaw
  pitch: 2.5,       // degrees the view dips at the ends of the swing
  easeIn: 3000,     // ms over which the swing grows to full size
  fps: 30,          // frame cap while swaying
};

/**
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {{ allowed: () => boolean }} hooks  whether the sway may run right now
 */
export function createIdle(store, { allowed }) {
  let raf = 0;
  let timer = 0;
  let base = null;       // the camera at rest that the sway moves around
  let pivot = null;      // and the point it turns about: the middle of what can be seen
  let t0 = 0;
  let last = 0;
  let running = false;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    running = false;
    base = null;
    pivot = null;
  }

  /** Something happened: stop, and start the pause before the next sway. */
  function rest() {
    stop();
    clearTimeout(timer);
    if (reducedMotion()) return;
    timer = window.setTimeout(start, IDLE.delay);
  }

  function start() {
    if (running || !allowed()) return;
    base = { ...store.get('camera') };
    // Turn about the middle of what can be seen, not the middle of the canvas: with the
    // sheet up or a panel out those are 200 px apart, and swaying about the canvas
    // walked the country out from behind the sheet and back (PLAN.md F7).
    const vp = store.get('viewport');
    const [cx, cy] = paddedCentre(vp, store.get('padding'));
    pivot = groundAnchor(base, cx, cy, vp);
    t0 = performance.now();
    last = 0;
    running = true;
    raf = requestAnimationFrame(step);
  }

  function step(now) {
    if (!running) return;
    raf = requestAnimationFrame(step);
    if (now - last < 1000 / IDLE.fps) return;
    last = now;
    if (!allowed()) { stop(); return; }
    const t = now - t0;
    const e = Math.min(1, t / IDLE.easeIn);
    const amp = e * e * (3 - 2 * e);                       // smooth start
    const phase = (2 * Math.PI * t) / IDLE.period;
    const s = Math.sin(phase);
    const swayed = orbitAbout(base, base.yaw + amp * IDLE.yaw * s, base.pitch - amp * IDLE.pitch * s * s,
                              pivot, store.get('viewport'));
    store.set('camera', clampCamera(swayed), { source: 'idle' });
  }

  // Anyone else moving the camera (gestures, flights, fits, the URL) ends the sway.
  store.subscribe('camera', (_, __, meta) => { if (meta.source !== 'idle') rest(); });
  // Hands on the controls, taps, hovers and any change of what is shown too.
  for (const key of ['activity', 'tap', 'pointer', 'selection', 'item', 'level', 'tour', 'home', 'sheet']) {
    store.subscribe(key, () => rest());
  }
  return { rest, stop, get running() { return running; } };
}
