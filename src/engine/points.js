// @ts-check
// The `points` layer type (PLAN.md section 5) as HTML markers: sticker-like pins that
// ride the terrain (and the lifted block) through the same projection as the labels.
// The engine knows this type, never a layer's id. Instanced WebGL sprites can replace
// the DOM later without touching the data.
const MARKER_W = 32, MARKER_H = 36, GAP = 2;

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
    const items = layer.items.map((item) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'marker';
      el.dataset.layer = layer.id;
      el.dataset.item = item.id;
      el.hidden = true;
      const body = document.createElement('span');
      body.className = 'marker-body';
      const icon = document.createElement('span');
      icon.className = 'marker-icon';
      icon.textContent = cats[item.category]?.icon || '📍';
      body.appendChild(icon);
      el.appendChild(body);
      container.appendChild(el);
      return { item, el };
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
    const maxPriority = camera.zoom > 7500 ? 1 : camera.zoom > 3800 ? 2 : 3;
    for (const [id, { layer, items }] of layers) {
      const on = active.has(id);
      for (const { item, el } of items) {
        const isSel = selected && selected.layer === id && selected.id === item.id;
        let show = on && (drafts || item.status === 'reviewed');
        if (show && level.name === 'state') show = item.region === level.id;
        else if (show) show = item.priority <= maxPriority || isSel;
        if (!show) { el.hidden = true; continue; }
        const p = project([item.x, item.z]);
        if (!p) { el.hidden = true; continue; }
        const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
        const onScreen = cx > -MARKER_W && cx < viewport.w + MARKER_W && cy > -MARKER_H && cy < viewport.h + MARKER_H;
        const rect = [cx - MARKER_W / 2 - GAP, cy - MARKER_H - GAP, cx + MARKER_W / 2 + GAP, cy + GAP];
        const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
        // the most famous places always show, even overlapping a little; the rest keep clear
        if (!onScreen || (!clear && !isSel && item.priority > 1)) { el.hidden = true; continue; }
        el.hidden = false;
        el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
        el.classList.toggle('marker-active', !!isSel);
        el.setAttribute('aria-label', text(item.name, lang));
        el.title = text(item.name, lang);
        placed.push(rect);
      }
    }
    return placed;
  }

  function find(layerId, itemId) {
    return layers.get(layerId)?.items.find((x) => x.item.id === itemId)?.item || null;
  }

  function categories(layerId) {
    return layers.get(layerId)?.layer.categories || [];
  }

  return { setLayer, remove, update, find, categories, get loaded() { return [...layers.keys()]; } };
}
