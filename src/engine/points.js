// @ts-check
// The `points` layer type (PLAN.md section 5) as HTML markers: sticker-like pins that
// ride the terrain (and the lifted block) through the same projection as the labels.
// The engine knows this type, never a layer's id. Instanced WebGL sprites can replace
// the DOM later without touching the data.
const TOKEN = { 1: 32, 2: 27, 3: 24 };   // token diameter by priority, px
const GAP = 2;
const NAME_ZOOM = 1800;                  // below this view height, the most famous places show their names

/** Line-art glyphs a layer can name for its categories (24x24, stroked in the token's ink). */
const GLYPHS = {
  monument: '<path d="M4 21h16M6 21V11M10 21V11M14 21V11M18 21V11M3 11l9-6 9 6z"/>',
  temple: '<path d="M12 2v2M8 9l4-5 4 5M6 9h12M7 9v12h10V9M12 21v-5M10 16h4"/>',
  leaf: '<path d="M4 20c0-8 6-14 16-16-2 10-8 16-16 16zM4 20l9-9"/>',
  wave: '<path d="M3 19c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M12 4a7 7 0 0 1 7 7H5a7 7 0 0 1 7-7zM12 11v4"/>',
  mountain: '<path d="M3 20l6-11 4 6 3-4 5 9zM9 9l1.5 2.5L12 9"/>',
  paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5.5 2.6-5.5 5.2 0 1.4.9 1.8 1.8 1.8 1.6 0 2.2-.9 3.7-.9s2.1.9 3.7.9c.9 0 1.8-.4 1.8-1.8C17.5 14.6 15 12 12 12z"/>',
  city: '<path d="M3 21h18M5 21V9h5v12M10 21V4h6v17M16 21v-8h4v8M7 12h1M7 15h1M12 8h2M12 12h2M12 16h2"/>',
  pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
};

function glyphSvg(name) {
  const body = GLYPHS[name] || GLYPHS.pin;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

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
      const cat = cats[item.category] || {};
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `marker marker-p${item.priority} marker-new`;
      el.dataset.layer = layer.id;
      el.dataset.item = item.id;
      el.hidden = true;
      el.style.setProperty('--c', cat.color || '#b4552e');
      const token = document.createElement('span');
      token.className = 'marker-token';
      token.innerHTML = glyphSvg(cat.icon);          // static markup from the glyph set only
      const name = document.createElement('span');
      name.className = 'marker-name';
      el.append(token, name);
      container.appendChild(el);
      return { item, el, name };
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
    for (const [id, { layer, items }] of layers) {
      const on = active.has(id);
      for (const { item, el, name } of items) {
        const isSel = selected && selected.layer === id && selected.id === item.id;
        const size = TOKEN[item.priority] || TOKEN[3];
        let show = on && (drafts || item.status === 'reviewed');
        if (show && level.name === 'state') show = item.region === level.id;
        else if (show) show = item.priority <= maxPriority || isSel;
        if (!show) { el.hidden = true; continue; }
        const p = project([item.x, item.z]);
        if (!p) { el.hidden = true; continue; }
        const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
        const onScreen = cx > -size && cx < viewport.w + size && cy > -size && cy < viewport.h + size;
        const half = size / 2 + GAP;
        const rect = [cx - half, cy - size * 0.85 - GAP, cx + half, cy + GAP];
        const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
        // the most famous places always show, even overlapping a little; the rest keep clear
        if (!onScreen || (!clear && !isSel && item.priority > 1)) { el.hidden = true; continue; }
        el.hidden = false;
        el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
        el.classList.toggle('marker-active', !!isSel);
        el.classList.toggle('marker-named', item.priority === 1 && camera.zoom < NAME_ZOOM);
        const label = text(item.name, lang);
        if (name.textContent !== label) { name.textContent = label; el.setAttribute('aria-label', label); }
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

  function categories(layerId) {
    return layers.get(layerId)?.layer.categories || [];
  }

  return { setLayer, remove, update, list, find, categories, get loaded() { return [...layers.keys()]; } };
}
