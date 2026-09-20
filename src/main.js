// @ts-check
// Bootstrap: language, store, URL, shell, engine. Everything meets in the store.
import './ui/style.css';
import { createEngine } from './engine/index.js';
import { detectLanguage, setLanguage } from './i18n/index.js';
import { createStore } from './state/store.js';
import { DEFAULT_RELIEF, readUrl, syncUrl } from './state/url.js';
import { attachGestures } from './ui/gestures.js';
import { createSheet } from './ui/sheet.js';
import { createShell } from './ui/shell.js';

const url = readUrl();
const lang = url.lang || detectLanguage();

const store = createStore({
  lang,
  camera: { x: 0, z: 0, zoom: 4200, yaw: -12, pitch: 56 },
  relief: { on: url.relief !== 0, amount: url.relief && url.relief > 0 ? url.relief : DEFAULT_RELIEF },
  layers: ['relief'],
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  viewport: { w: window.innerWidth, h: window.innerHeight },
  sheet: { snap: 'peek', peek: 0 },
  selection: null,
  hover: null,
  tap: null,
  pointer: null,
  flyTo: null,
  regions: null,
  status: 'loading',
});

setLanguage(lang);
store.subscribe('lang', (l) => setLanguage(l));
syncUrl(store);

createShell(document, store);
createSheet(/** @type {HTMLElement} */ (document.querySelector('.sheet')), store);

const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas.map'));
const supported = !!document.createElement('canvas').getContext('webgl2') && typeof DecompressionStream === 'function';

if (!supported) {
  /** @type {HTMLElement} */ (document.querySelector('.fallback')).hidden = false;
  store.set('status', 'fallback');
} else {
  const engine = createEngine({ canvas, store });
  attachGestures(canvas, store);
  if (url.state) {
    // Restore ?state=<slug> once the units are known.
    const unsub = store.subscribe('regions', (r) => {
      if (!r) return;
      const u = r.units.find((x) => x.slug === url.state);
      if (u) store.set('selection', u.id);
      unsub();
    });
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') store.set('selection', null); });
  engine.start().catch((err) => {
    console.error(err);
    store.set('status', 'error');
  });
  // Handy while iterating on the look from the console.
  /** @type {any} */ (window).bd = { store, engine };
}
