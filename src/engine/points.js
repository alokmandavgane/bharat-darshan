// @ts-check
// The `points` layer type (PLAN.md section 5) as HTML markers: sticker-like pins that
// ride the terrain (and the lifted block) through the same projection as the labels.
// A layer whose `marker` is "label" gets its name alone and no token, for things that
// are a stretch of country rather than a spot on it: mountain ranges, plateaus, deserts.
// The engine knows this type, never a layer's id. Instanced WebGL sprites can replace
// the DOM later without touching the data.
import { glyphSvg } from '../glyphs.js';

const TOKEN = { 1: 32, 2: 27, 3: 24 };   // token diameter by priority, px
const GAP = 2;
const NAME_ZOOM = 1800;                  // below this view height, the most famous places show their names


/**
 * @param {HTMLElement | undefined} container
 * @param {{ text: (field: any, lang: string) => string, onSelect: (layerId: string, itemId: string) => void }} opts
 */
export function createPoints(container, { text, onSelect }) {
  /** @type {Map<string, { layer: any, items: { item: any, el: HTMLButtonElement }[] }>} */
  const layers = new Map();

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
    const items = layer.items.map((item) => {
      const cat = cats[item.category] || {};
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `marker marker-p${item.priority} marker-new${asLabel ? ' marker-as-label' : ''}`;
      el.dataset.layer = layer.id;
      el.dataset.item = item.id;
      el.hidden = true;
      el.style.setProperty('--c', cat.color || '#b4552e');
      const name = document.createElement('span');
      name.className = 'marker-name';
      if (asLabel) {
        el.append(name);
      } else {
        const token = document.createElement('span');
        token.className = 'marker-token';
        token.innerHTML = glyphSvg(cat.icon);        // static markup from the glyph set only
        el.append(token, name);
      }
      container.appendChild(el);
      // Label width is estimated from the text, never measured: reading offsetWidth in
      // the per-frame loop would force a layout on every marker, every frame.
      return { item, el, name, asLabel, w: Math.round((item.name?.en || '').length * 8.2) + 10, h: 16 };
    });
    // the pop-in plays once, when a token first appears
    setTimeout(() => items.forEach(({ el }) => el.classList.remove('marker-new')), 1500);
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
    // the famous few at country zoom, the rest one step in; with 139 places, priority 3
    // at the whole-country view crowded out the state labels
    const maxPriority = camera.zoom > 6000 ? 1 : camera.zoom > 2400 ? 2 : 3;
    // Tokens claim their space first whatever order the layers arrived in, so a range
    // label yields to a place rather than being drawn under one.
    const order = [...layers].sort((a, b) => (a[1].layer.marker === 'label' ? 1 : 0) - (b[1].layer.marker === 'label' ? 1 : 0));
    for (const [id, { layer, items }] of order) {
      const on = active.has(id);
      for (const rec of items) {
        const { item, el, name, asLabel } = rec;
        const isSel = selected && selected.layer === id && selected.id === item.id;
        const size = TOKEN[item.priority] || TOKEN[3];
        let show = on && (drafts || item.status === 'reviewed');
        // A range crosses states, so a state view keeps showing the ones around it.
        if (show && level.name === 'state' && !asLabel) show = item.region === level.id;
        else if (show) show = item.priority <= maxPriority || isSel;
        if (!show) { el.hidden = true; continue; }
        const p = project([item.x, item.z]);
        if (!p) { el.hidden = true; continue; }
        const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
        const onScreen = cx > -size && cx < viewport.w + size && cy > -size && cy < viewport.h + size;
        const half = (asLabel ? rec.w : size) / 2 + GAP;
        const rect = asLabel
          ? [cx - half, cy - rec.h / 2 - GAP, cx + half, cy + rec.h / 2 + GAP]
          : [cx - half, cy - size * 0.85 - GAP, cx + half, cy + GAP];
        const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
        // the most famous places always show, even overlapping a little; the rest keep clear
        if (!onScreen || (!clear && !isSel && item.priority > 1)) { el.hidden = true; continue; }
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
