// @ts-check
// The tour: the camera visits every place on show, one after another, each with its
// card, along a short path from the north (nearest neighbour, so no zig-zag across the
// country). The play button pauses and resumes; any gesture, tap or card change hands
// control back. Layers reach it through the engine's callbacks: it knows no layer ids.
import { clamp, DEFAULT_CAMERA } from './camera-math.js';

const FLY_MS = 1600;               // a flight between stops
const DWELL_BASE_MS = 3000;        // time on a stop, plus a little per word of its text
const DWELL_PER_WORD_MS = 90;
const DWELL_MS = [4000, 7500];
const SWAY_DEG = 6;                // the view turns gently from side to side between stops

/**
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {{ stops: () => { layer: string, item: any }[],
 *           visit: (stop: { layer: string, item: any }, opts: { ms: number, yaw: number }) => number,
 *           home: () => void }} hooks
 *   `stops` lists what is on show; `visit` shows a stop and returns its flight time in
 *   ms; `home` is called when the tour has run its course.
 */
export function createTour(store, { stops, visit, home }) {
  let route = [];
  let at = -1;                     // index of the stop on show, -1 before the first
  let timer = 0;
  let playing = false;

  const d2 = (a, b) => (a.item.x - b.item.x) ** 2 + (a.item.z - b.item.z) ** 2;

  /** Nearest-neighbour path from the northernmost stop. */
  function order(list) {
    const rest = [...list];
    const out = [];
    let cur = rest.length ? rest.reduce((a, b) => (b.item.z < a.item.z ? b : a)) : null;
    while (cur) {
      rest.splice(rest.indexOf(cur), 1);
      out.push(cur);
      const from = cur;
      cur = rest.reduce((a, b) => (!a || d2(b, from) < d2(a, from) ? b : a), null);
    }
    return out;
  }

  function publish() {
    store.set('tour', { playing, index: at, total: route.length });
  }

  /** Recount what is on show (layers, drafts or the level changed); a tour under way keeps its route. */
  function refresh() {
    if (playing) return;
    route = order(stops());
    at = -1;
    publish();
  }

  function next() {
    at += 1;
    if (at >= route.length) {        // the end: back to the whole country
      at = -1;
      stop();
      home();
      return;
    }
    const stop_ = route[at];
    const yaw = DEFAULT_CAMERA.yaw + (at % 2 ? SWAY_DEG : -SWAY_DEG);
    const words = String(stop_.item.blurb?.en || '').split(/\s+/).filter(Boolean).length;
    const dwell = clamp(DWELL_BASE_MS + words * DWELL_PER_WORD_MS, DWELL_MS[0], DWELL_MS[1]);
    const ms = visit(stop_, { ms: FLY_MS, yaw });
    publish();
    timer = window.setTimeout(next, ms + dwell);
  }

  function start() {
    if (playing) return;
    if (at < 0 || at >= route.length - 1) { route = order(stops()); at = -1; }   // afresh, or from the top again
    if (!route.length) { publish(); return; }
    playing = true;
    publish();
    next();
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
    if (!playing) return;
    playing = false;
    publish();
  }

  store.subscribe('tour', (tr) => {
    if (tr?.playing && !playing) start();
    else if (tr && !tr.playing && playing) stop();
  });
  // Whatever the visitor does hands control back to them.
  store.subscribe('camera', (_, __, meta) => { if (meta.source === 'gesture') stop(); });
  store.subscribe('tap', () => stop());
  store.subscribe('item', (_, __, meta) => { if (meta.source !== 'tour') stop(); });
  store.subscribe('selection', () => stop());
  store.subscribe('home', () => stop());
  store.subscribe('level', () => { stop(); refresh(); });
  store.subscribe('layers', () => refresh());
  store.subscribe('drafts', () => refresh());
  return { refresh, stop };
}
