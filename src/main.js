// @ts-check
// Bootstrap: language, store, URL, shell, engine. Everything meets in the store.
import './ui/style.css';
import { DEFAULT_CAMERA } from './engine/camera-math.js';
import { createEngine } from './engine/index.js';
import { detectLanguage, pick, setLanguage } from './i18n/index.js';
import { createStore } from './state/store.js';
import { DEFAULT_RELIEF, readUrl, syncUrl } from './state/url.js';
import { attachGestures } from './ui/gestures.js';
import { watchActivity } from './ui/activity.js';
import { createSheet } from './ui/sheet.js';
import { createShell } from './ui/shell.js';

const url = readUrl();
const lang = url.lang || detectLanguage();
const poster = new URLSearchParams(location.search).get('poster') === '1';   // share-image render, see tools/share-image.mjs
if (poster) document.body.dataset.poster = '1';

const store = createStore({
  lang,
  camera: { ...DEFAULT_CAMERA },
  relief: { on: url.relief !== 0, amount: url.relief && url.relief > 0 ? url.relief : DEFAULT_RELIEF },
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  viewport: { w: window.innerWidth, h: window.innerHeight },
  sheet: { snap: 'peek', peek: 0 },
  selection: null,
  hover: null,
  tap: null,
  pointer: null,
  flyTo: null,
  focus: null,
  // A deep link to an item is a stub, { layer, id }: the engine fills in the data once
  // that layer has arrived (see resolveItem).
  item: url.item ? { layer: url.item.layer, id: url.item.id } : null,
  // { active: [...] } once the manifest says which layers exist, or straight from the URL.
  // An item's own layer is switched on whatever else the link asked for: a card with
  // nothing drawn under it is not what the link meant.
  layers: url.layers
    ? { active: url.item && !url.layers.includes(url.item.layer) ? [...url.layers, url.item.layer] : url.layers }
    : null,
  catalog: [],
  level: { name: 'country', id: null },
  home: null,            // { t }: a request to clear everything and frame the country again
  tour: { playing: false, index: -1, total: 0 },
  activity: 0,           // performance.now() of the last touch, click, wheel or key anywhere
  poster,                // the share-image render: no idle sway
  surroundings: false,   // India alone on the page by default; the menu can show sea and neighbours
  // Content ships reviewed-only (D10). Drafts are on by default while the first
  // batch is being reviewed, so the demo shows the cards; flip to
  // `url.drafts || import.meta.env.DEV` once the owner has reviewed them.
  drafts: true,
  regions: null,
  status: 'loading',
});

setLanguage(lang);
store.subscribe('lang', (l) => setLanguage(l));
syncUrl(store);

createShell(document, store);
createSheet(/** @type {HTMLElement} */ (document.querySelector('.sheet')), store);
watchActivity(document, store);
if (poster) store.set('padding', { top: 40, right: 40, bottom: 40, left: 560 }, { source: 'poster' });

const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas.map'));
const supported = !!document.createElement('canvas').getContext('webgl2') && typeof DecompressionStream === 'function';

if (!supported) {
  /** @type {HTMLElement} */ (document.querySelector('.fallback')).hidden = false;
  store.set('status', 'fallback');
} else {
  const engine = createEngine({
    canvas, store,
    labelContainer: /** @type {HTMLElement} */ (document.querySelector('.labels')),
    markerContainer: /** @type {HTMLElement} */ (document.querySelector('.markers')),
    labelText: (unit, lang) => unit.name[lang] || unit.name.en,
  });
  attachGestures(canvas, store);
  if (url.item && !url.layers) {
    // The catalogue's defaults land first; add the linked item's layer to them once.
    const unsub = store.subscribe('layers', (l) => {
      if (!l) return;
      if (!l.active.includes(url.item.layer)) store.set('layers', { active: [...l.active, url.item.layer] });
      unsub();
    });
  }
  if (url.view || url.state) {
    // Restore /state/<slug> or ?state=<slug> once the units are known, before the first frame.
    const unsub = store.subscribe('regions', (r) => {
      if (!r) return;
      const view = r.units.find((x) => x.slug === url.view);
      const sel = view || r.units.find((x) => x.slug === url.state);
      if (sel) store.set('selection', sel.id);
      if (view) store.set('level', { name: 'state', id: view.id }, { source: 'init' });
      unsub();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (store.get('tour')?.playing) store.set('tour', { playing: false });
    else if (store.get('item')) store.set('item', null);
    else if (store.get('level')?.name === 'state') store.set('level', { name: 'country', id: null }, { source: 'ui' });
    else store.set('selection', null);
  });
  engine.start().then(() => {
    if (url.cam) store.set('camera', url.cam, { source: 'url' });
  }).catch((err) => {
    console.error(err);
    store.set('status', 'error');
  });
  // Handy while iterating on the look from the console.
  /** @type {any} */ (window).bd = { store, engine };
}
