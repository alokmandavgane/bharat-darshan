// @ts-check
// The `points` layer type (PLAN.md section 5) as HTML markers: sticker-like pins that
// ride the terrain (and the lifted block) through the same projection as the labels.
// A layer whose `marker` is "label" gets its name alone and no token, for things that
// are a stretch of country rather than a spot on it: mountain ranges, plateaus, deserts.
// The engine knows this type, never a layer's id. Instanced WebGL sprites can replace
// the DOM later without touching the data.
import { glyphSvg } from '../glyphs.js';

const TOKEN = { 1: 32, 2: 27, 3: 24 };   // token diameter by priority, px, close up
const GAP = 2;
const NAME_ZOOM = 1800;                  // below this view height, the most famous places show their names
// Tokens shrink as the camera pulls back (PLAN.md "The missing wow" 4). A marker is a
// sticker on the model, and a sticker does not stay the same size on screen while the
// thing it is stuck to gets smaller: at the home view full-size tokens are most of what
// anyone sees, and the relief they are standing on is not.
const SIZE_ZOOM = [1200, 4600];          // view height over which they shrink
const SIZE_SCALE = [1, 0.7];             // ...from this to this
const POP_STAGGER_MS = 26;               // between one token appearing and the next


/**
 * A `symbols` layer's diameter for one item (PLAN.md section 5). The eye reads a circle
 * by its area, so the radius goes as the square root of the value: a plant twice the
 * size of another is twice the ink, not four times it. Everything is declared --
 * `{ field, domain: [lo, hi], range: [smallest, largest] }` -- so the engine knows the
 * layer's shape and never its subject.
 * @param {{ field: string, domain: number[], range: number[] } | undefined} spec
 */
export function symbolSizer(spec) {
  if (!spec?.field) return () => 0;
  const [lo, hi] = spec.domain || [0, 1];
  const [small, large] = spec.range || [10, 40];
  const span = Math.sqrt(Math.max(hi, lo + 1e-9)) - Math.sqrt(Math.max(lo, 0));
  return (item) => {
    const v = Number(item?.[spec.field]);
    if (!Number.isFinite(v)) return small;
    const t = (Math.sqrt(Math.min(Math.max(v, lo), hi)) - Math.sqrt(Math.max(lo, 0))) / span;
    return small + (large - small) * t;
  };
}

/**
 * @param {HTMLElement | undefined} container
 * @param {{ text: (field: any, lang: string) => string, onSelect: (layerId: string, itemId: string) => void }} opts
 */
export function createPoints(container, { text, onSelect }) {
  /** @type {Map<string, { layer: any, items: { item: any, el: HTMLButtonElement }[] }>} */
  const layers = new Map();
  let lastScale = 0;       // the token scale the container carries, so it is written once a change

  if (container) {
    container.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-item]');
      if (btn) onSelect(btn.dataset.layer || '', btn.dataset.item || '');
    });
  }

  /** Add or replace a loaded layer's items. */
  function setLayer(layer) {
    if (!container) return;
    remove(layer.id);
    const cats = Object.fromEntries((layer.categories || []).map((c) => [c.id, c]));
    const asLabel = layer.marker === 'label';
    const asSymbol = layer.marker === 'symbol';
    const sizeOf = symbolSizer(layer.size);
    const items = layer.items.map((item) => {
      const cat = cats[item.category] || {};
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `marker marker-p${item.priority} marker-new`
        + (asLabel ? ' marker-as-label' : '') + (asSymbol ? ' marker-as-symbol' : '');
      el.dataset.layer = layer.id;
      el.dataset.item = item.id;
      el.hidden = true;
      el.style.setProperty('--c', cat.color || '#b4552e');
      // A symbol's size is its value, so it is written once here rather than per frame;
      // what changes per frame is the container's --mscale, which multiplies it.
      const base = asSymbol ? sizeOf(item) : 0;
      if (asSymbol) el.style.setProperty('--base', `${base.toFixed(1)}px`);
      const name = document.createElement('span');
      name.className = 'marker-name';
      if (asLabel) {
        el.append(name);
      } else {
        const token = document.createElement('span');
        token.className = 'marker-token';
        // A proportional circle is read by its area; a glyph inside one that may be ten
        // pixels across is not read at all, so a symbol is the disc alone.
        if (!asSymbol) token.innerHTML = glyphSvg(cat.icon);   // static markup from the glyph set only
        el.append(token, name);
      }
      container.appendChild(el);
      // Label width is estimated from the text, never measured: reading offsetWidth in
      // the per-frame loop would force a layout on every marker, every frame.
      return { item, el, name, asLabel, base, w: Math.round((item.name?.en || '').length * 8.2) + 10, h: 16 };
    });
    layers.set(layer.id, { layer, items });
  }

  function remove(id) {
    const L = layers.get(id);
    if (!L) return;
    L.items.forEach(({ el }) => el.remove());
    layers.delete(id);
  }

  /** Reposition markers for the frame just drawn; returns the screen rects they occupy. */
  function update({ project, level, viewport, camera, active, selected, lang, drafts }) {
    const placed = [];
    if (!container) return placed;
    // The famous few at country zoom, the rest as the camera comes in. The home view is
    // 4,200 km of view height and used to be a priority-2 view, which put about forty
    // tokens over a country 3,000 km across: the markers were what you saw and the model
    // was what they were on. Sixteen leaves the relief to be looked at, and the rest
    // arrive as soon as anyone goes in for them.
    const maxPriority = camera.zoom > 3200 ? 1 : camera.zoom > 1800 ? 2 : 3;
    // One custom property on the container rather than one per marker: fifty style
    // writes a frame would be fifty invalidations, and this is read in the per-frame loop.
    const t = Math.min(1, Math.max(0, (camera.zoom - SIZE_ZOOM[0]) / (SIZE_ZOOM[1] - SIZE_ZOOM[0])));
    const mscale = SIZE_SCALE[0] + (SIZE_SCALE[1] - SIZE_SCALE[0]) * t;
    if (mscale !== lastScale) {
      container.style.setProperty('--mscale', mscale.toFixed(3));
      lastScale = mscale;
    }
    let popped = 0;
    // Tokens claim their space first whatever order the layers arrived in, so a range
    // label yields to a place rather than being drawn under one.
    const order = [...layers].sort((a, b) => (a[1].layer.marker === 'label' ? 1 : 0) - (b[1].layer.marker === 'label' ? 1 : 0));
    for (const [id, { layer, items }] of order) {
      const on = active.has(id);
      for (const rec of items) {
        const { item, el, name, asLabel } = rec;
        const isSel = selected && selected.layer === id && selected.id === item.id;
        const size = (rec.base || TOKEN[item.priority] || TOKEN[3]) * mscale;
        let show = on && (drafts || item.status === 'reviewed');
        // A range crosses states, so a state view keeps showing the ones around it.
        if (show && level.name === 'state' && !asLabel) show = item.region === level.id;
        // A symbol's whole point is the comparison between its value and the next one's,
        // so a symbols layer is not thinned by zoom the way place tokens are: the reader
        // switched it on to see the set. Collision still thins it, biggest first, which
        // is the order the build writes them in.
        else if (show && !rec.base) show = item.priority <= maxPriority || isSel;
        if (!show) { el.hidden = true; continue; }
        const p = project([item.x, item.z]);
        if (!p) { el.hidden = true; continue; }
        const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
        const onScreen = cx > -size && cx < viewport.w + size && cy > -size && cy < viewport.h + size;
        const half = (asLabel ? rec.w : size) / 2 + GAP;
        // A token is a pin: it stands above the point it marks. A symbol is a
        // proportional circle and sits centred on it, so it claims a different rectangle.
        const rect = asLabel
          ? [cx - half, cy - rec.h / 2 - GAP, cx + half, cy + rec.h / 2 + GAP]
          : rec.base
            ? [cx - half, cy - half, cx + half, cy + half]
            : [cx - half, cy - size * 0.85 - GAP, cx + half, cy + GAP];
        const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
        // the most famous places always show, even overlapping a little; the rest keep clear
        if (!onScreen || (!clear && !isSel && item.priority > 1)) { el.hidden = true; rec.up = false; continue; }
        // Coming into view: the tokens spring up one after another rather than all at
        // once, which reads as a handful of pieces being set down on the model. The
        // delay is set while the element is still hidden, and a hidden marker is
        // display: none, so unhiding it starts the animation afresh on its own -- no
        // class juggling and, more to the point, no offsetWidth read to force a reflow,
        // which during a zoom-in would be one layout per token arriving.
        if (!rec.up) {
          rec.up = true;
          el.style.setProperty('--pop-delay', `${popped * POP_STAGGER_MS}ms`);
          popped += 1;
        }
        el.hidden = false;
        // Sub-pixel: rounding to whole pixels makes markers jitter against a canvas
        // that moves smoothly under them during a flight.
        el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
        el.classList.toggle('marker-active', !!isSel);
        el.classList.toggle('marker-named', item.priority === 1 && camera.zoom < NAME_ZOOM);
        const label = text(item.name, lang);
        if (name.textContent !== label) {
          name.textContent = label;
          el.setAttribute('aria-label', label);
          rec.w = Math.round(label.length * (lang === 'hi' ? 8.5 : 8.2)) + 10;
        }
        placed.push(rect);
      }
    }
    return placed;
  }

  /** Everything on show at a level (the tour's stops), before the zoom thinning. */
  function list({ active, drafts, level }) {
    const out = [];
    for (const [id, { items }] of layers) {
      if (!active.has(id)) continue;
      for (const { item } of items) {
        if (!drafts && item.status !== 'reviewed') continue;
        if (level.name === 'state' && item.region !== level.id) continue;
        out.push({ layer: id, item });
      }
    }
    return out;
  }

  function find(layerId, itemId) {
    return layers.get(layerId)?.items.find((x) => x.item.id === itemId)?.item || null;
  }

  /** The structured columns a layer declares on top of the base item schema. */
  function fields(layerId) {
    return layers.get(layerId)?.layer.fields || null;
  }

  function categories(layerId) {
    return layers.get(layerId)?.layer.categories || [];
  }

  return { setLayer, remove, update, list, find, categories, fields, get loaded() { return [...layers.keys()]; } };
}
