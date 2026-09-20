// @ts-check
// State names as HTML labels (PLAN.md section 6): projected after every render, kept to
// the ones that fit, biggest first, no overlaps. The browser shapes every script with
// system fonts, and the labels stay real text for assistive tech.
const MARGIN = 4;
const MAX_LABELS = 40;

/**
 * @param {HTMLElement | undefined} container  the engine's label container (may be absent in tests)
 * @param {((unit: any, lang: string) => string) | undefined} text
 */
export function createLabels(container, text) {
  /** @type {{ unit: any, el: HTMLSpanElement, w: number, h: number, lang: string | null }[]} */
  let items = [];

  function setUnits(units) {
    if (!container) return;
    container.replaceChildren();
    items = [...units].sort((a, b) => b.area_km2 - a.area_km2).map((unit, i) => {
      const el = document.createElement('span');
      el.className = 'label ' + (i < 8 ? 'label-l' : i < 22 ? 'label-m' : 'label-s');
      el.hidden = true;
      container.appendChild(el);
      return { unit, el, w: 0, h: 0, lang: null };
    });
  }

  function invalidateText() {
    for (const it of items) it.lang = null;
  }

  function measure(it, lang) {
    it.el.textContent = text ? text(it.unit, lang) : it.unit.name?.en || '';
    it.el.lang = lang;
    it.el.hidden = false;
    it.w = it.el.offsetWidth;
    it.h = it.el.offsetHeight;
    it.lang = lang;
  }

  /** Reposition every label for the frame just drawn. */
  function update({ project, level, viewport, camera, regions, selection, hover, lang }) {
    if (!container || !items.length || !regions) return;
    const hideAll = level.name !== 'country';
    const kmPerPx = camera.zoom / viewport.h;
    const placed = [];
    for (const it of items) {
      const u = it.unit;
      if (hideAll) { it.el.hidden = true; continue; }
      if (it.lang !== lang) measure(it, lang);
      const p = project(u.anchor);
      if (!p) { it.el.hidden = true; continue; }
      const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
      const extentPx = Math.min(u.bbox[2] - u.bbox[0], (u.bbox[3] - u.bbox[1]) * 0.8) / kmPerPx;
      const wanted = u.id === selection || u.id === hover;
      const fits = extentPx >= it.w * 0.85 && extentPx >= 26;
      const onScreen = cx > -it.w && cx < viewport.w + it.w && cy > -it.h && cy < viewport.h + it.h;
      const rect = [cx - it.w / 2 - MARGIN, cy - it.h / 2 - MARGIN, cx + it.w / 2 + MARGIN, cy + it.h / 2 + MARGIN];
      const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      const show = onScreen && (wanted || fits) && (clear || wanted) && placed.length < MAX_LABELS;
      it.el.hidden = !show;
      if (!show) continue;
      it.el.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px) translate(-50%, -50%)`;
      it.el.classList.toggle('label-active', wanted);
      placed.push(rect);
    }
  }

  return { setUnits, update, invalidateText };
}
