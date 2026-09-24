// @ts-check
// State names as HTML labels (PLAN.md section 6): projected after every render, kept to
// the ones that fit, biggest first, no overlaps. The browser shapes every script with
// system fonts, and the labels stay real text for assistive tech.
const MARGIN = 4;
const MAX_LABELS = 40;
// A name may run a little past its state's edges: at the whole-country view on a phone
// the biggest states are 60-100 px across and their names are longer, and a name centred
// on a state that overhangs it by a quarter still reads as that state's. The overlap
// test below keeps names off each other regardless.
const FIT = 0.75;
// The names shrink as the view pulls out, the way the markers do (points.js): at the
// desktop's home fit they are full size, and at the zoom ceiling -- where a phone
// holds the whole country in a third of its height -- they are under three quarters
// of it, or the names covered the states they name. Measured once at full size; the
// scale is applied to the measurements and, through --lscale, to the type.
const SCALE_ZOOM = [4600, 9500];
const SCALE = [1, 0.7];
export function labelScale(zoom) {
  const t = Math.min(1, Math.max(0, (zoom - SCALE_ZOOM[0]) / (SCALE_ZOOM[1] - SCALE_ZOOM[0])));
  return SCALE[0] + (SCALE[1] - SCALE[0]) * t;
}

/**
 * Where a two-word name breaks when it has to stand on two lines: the space nearest the
 * middle, so "Andaman and Nicobar Islands" splits after "and" and not after "Andaman".
 * -1 when there is no space to break at.
 * @param {string} name
 */
export function breakAt(name) {
  let best = -1;
  for (let i = name.indexOf(' '); i >= 0; i = name.indexOf(' ', i + 1)) {
    if (best < 0 || Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2)) best = i;
  }
  return best;
}

/**
 * @param {HTMLElement | undefined} container  the engine's label container (may be absent in tests)
 * @param {((unit: any, lang: string) => string) | undefined} text
 */
export function createLabels(container, text) {
  /** @type {{ unit: any, el: HTMLSpanElement, w: number, h: number, w2: number, h2: number, one: string, two: string, stacked: boolean, lang: string | null }[]} */
  let items = [];
  let lastScale = 0;

  function setUnits(units) {
    if (!container) return;
    container.replaceChildren();
    items = [...units].sort((a, b) => b.area_km2 - a.area_km2).map((unit, i) => {
      const el = document.createElement('span');
      el.className = 'label ' + (i < 8 ? 'label-l' : i < 22 ? 'label-m' : 'label-s');
      el.hidden = true;
      container.appendChild(el);
      return { unit, el, w: 0, h: 0, w2: 0, h2: 0, one: '', two: '', stacked: false, lang: null };
    });
  }

  function invalidateText() {
    for (const it of items) it.lang = null;
  }

  /** Measure the name on one line and, when it has a space to break at, on two. */
  function measure(it, lang) {
    it.one = text ? text(it.unit, lang) : it.unit.name?.en || '';
    it.el.lang = lang;
    it.el.hidden = false;
    it.el.classList.remove('label-stack');
    it.el.textContent = it.one;
    it.w = it.el.offsetWidth;
    it.h = it.el.offsetHeight;
    const at = breakAt(it.one);
    it.two = at > 0 ? `${it.one.slice(0, at)}\n${it.one.slice(at + 1)}` : '';
    if (it.two) {
      it.el.classList.add('label-stack');
      it.el.textContent = it.two;
      it.w2 = it.el.offsetWidth;
      it.h2 = it.el.offsetHeight;
      it.el.classList.remove('label-stack');
      it.el.textContent = it.one;
    } else { it.w2 = 0; it.h2 = 0; }
    it.stacked = false;
    it.lang = lang;
  }

  /**
   * Reposition every label for the frame just drawn; `avoid` holds rects already taken
   * (markers). Returns the rects the labels took, for whatever is placed after them.
   */
  function update({ project, level, viewport, camera, regions, selection, hover, lang, avoid = [] }) {
    const mine = [];
    if (!container || !items.length || !regions) return mine;
    const hideAll = level.name !== 'country';
    const kmPerPx = camera.zoom / viewport.h;
    const scale = labelScale(camera.zoom);
    if (scale !== lastScale) { container.style.setProperty('--lscale', scale.toFixed(3)); lastScale = scale; }
    const placed = [...avoid];
    let shown = 0;
    for (const it of items) {
      const u = it.unit;
      if (hideAll) { it.el.hidden = true; continue; }
      if (it.lang !== lang) measure(it, lang);
      const p = project(u.anchor[0], u.anchor[1]);
      if (!p) { it.el.hidden = true; continue; }
      const cx = viewport.w / 2 + p[0], cy = viewport.h / 2 - p[1];
      // A name runs across its state, so it is the width that has to hold it; the
      // height only ever mattered to a label that is a line or two tall.
      const extentPx = (u.bbox[2] - u.bbox[0]) / kmPerPx;
      const wanted = u.id === selection || u.id === hover;
      const fitsOne = extentPx >= it.w * scale * FIT && extentPx >= 26;
      // "Madhya Pradesh" on one line is longer than the state is wide at the whole-
      // country view on a phone; on two lines it is not.
      const stacked = !fitsOne && it.w2 > 0 && extentPx >= it.w2 * scale * FIT && extentPx >= 26;
      const fits = fitsOne || stacked;
      const w = (stacked ? it.w2 : it.w) * scale, h = (stacked ? it.h2 : it.h) * scale;
      const onScreen = cx > -w && cx < viewport.w + w && cy > -h && cy < viewport.h + h;
      const rect = [cx - w / 2 - MARGIN, cy - h / 2 - MARGIN, cx + w / 2 + MARGIN, cy + h / 2 + MARGIN];
      const clear = !placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]);
      const show = onScreen && (wanted || fits) && (clear || wanted) && shown < MAX_LABELS;
      it.el.hidden = !show;
      if (!show) continue;
      if (stacked !== it.stacked) {
        it.stacked = stacked;
        it.el.classList.toggle('label-stack', stacked);
        it.el.textContent = stacked ? it.two : it.one;
      }
      // Sub-pixel, so a label does not jitter against the canvas during a flight.
      it.el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) translate(-50%, -50%)`;
      it.el.classList.toggle('label-active', wanted);
      placed.push(rect);
      mine.push(rect);
      shown++;
    }
    return mine;
  }

  return { setUnits, update, invalidateText };
}
