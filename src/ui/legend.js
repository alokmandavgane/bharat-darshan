// @ts-check
// A layer's key, in the sizes the shell needs it: the mark (a tile that says what kind
// of drawing the layer is, in the layer's own colours), and the key proper (its
// categories, bands, sizes or heights). Everything here is read off the layer's declared
// type and colours; no layer id appears (PLAN.md D5, D12).
import { CATEGORICAL } from '../engine/choropleth.js';
import { symbolSizer } from '../engine/points.js';
import { formatNumber, pick } from '../i18n/index.js';
import { GLYPHS } from '../glyphs.js';

const INK = '#8a6f57';
const PAPER = '#fff8ec';

/** A colour from a data file goes into markup, so it is checked before it does. */
function safe(c) {
  return typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : INK;
}

/** The colours a layer draws with, in the order it declares them. */
export function layerColours(layer) {
  if (Array.isArray(layer.scale)) return layer.scale.map((b) => safe(b.color));
  return (layer.categories || []).map((c) => safe(c.color));
}

export function firstColour(layer) {
  return layerColours(layer)[0] || INK;
}

/**
 * What kind of drawing a layer is, which is all the mark and the key need to know:
 * token | symbol | label | lines | ramp | mosaic | prisms | regional.
 */
export function kindOf(layer) {
  switch (layer.type) {
    case 'points': return ['symbol', 'label', 'dot', 'model'].includes(layer.marker) ? layer.marker : 'token';
    case 'lines': return 'lines';
    case 'choropleth': return Array.isArray(layer.scale) ? 'ramp' : 'mosaic';
    case 'areas': return 'mosaic';
    case 'prisms': return 'prisms';
    case 'regional': return 'regional';
    default: return 'token';
  }
}

let clipSeq = 0;

/** A glyph from the set, placed and scaled, stroked in the given ink. */
function glyph(name, x, y, s, ink, w = 2.2) {
  const body = GLYPHS[name] || GLYPHS.pin;
  return `<g fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${x} ${y}) scale(${s})">${body}</g>`;
}

/** A mosaic of colours, clipped to a rounded square. */
function mosaic(cs, id) {
  const n = Math.min(cs.length, 6);
  const cols = n <= 4 ? 2 : 3;
  const rows = n <= 2 ? 1 : 2;
  const w = 28 / cols, h = 28 / rows;
  let cells = '';
  for (let i = 0; i < cols * rows; i++) {
    const c = cs[i % n];
    cells += `<rect x="${6 + (i % cols) * w}" y="${6 + Math.floor(i / cols) * h}" width="${w + 0.5}" height="${h + 0.5}" fill="${c}"/>`;
  }
  return `<clipPath id="${id}"><rect x="6" y="6" width="28" height="28" rx="7"/></clipPath><g clip-path="url(#${id})">${cells}</g>`;
}

/**
 * The tile beside a layer's name: a miniature of how the layer draws, from its type and
 * its own colours, so the row says what the switch does before it is flicked.
 * @returns {string} static SVG markup
 */
export function layerMark(layer) {
  const cs = layerColours(layer);
  const c = (i) => cs[Math.min(i, cs.length - 1)] || INK;
  const id = `mk${++clipSeq}`;
  let body = '';
  switch (kindOf(layer)) {
    case 'token':
      body = (cs.length > 1 ? `<circle cx="31" cy="12" r="5" fill="${c(1)}"/>` : '')
        + (cs.length > 2 ? `<circle cx="32" cy="27" r="4" fill="${c(2)}"/>` : '')
        + `<ellipse cx="17" cy="33" rx="9" ry="2.5" fill="rgba(60,45,30,.25)"/>`
        + `<circle cx="17" cy="20" r="11" fill="${c(0)}"/>`
        + glyph(layer.icon, 9.5, 12.5, 0.62, PAPER, 2.4);
      break;
    case 'dot':
      body = `<ellipse cx="14" cy="27" rx="8" ry="2.2" fill="rgba(60,45,30,.22)"/><circle cx="14" cy="21" r="6.5" fill="${c(0)}"/>`
        + `<ellipse cx="27" cy="18" rx="5" ry="1.5" fill="rgba(60,45,30,.2)"/><circle cx="27" cy="14" r="4" fill="${c(1)}"/>`
        + `<circle cx="28" cy="28" r="2.6" fill="${c(2)}"/><circle cx="12" cy="18.5" r="1.8" fill="rgba(255,255,255,.55)"/>`;
      break;
    case 'model':
      body = `<ellipse cx="20" cy="33" rx="12" ry="3" fill="rgba(60,45,30,.22)"/>`
        + `<rect x="9" y="22" width="22" height="10" rx="2.5" fill="${c(1)}"/>`
        + `<circle cx="20" cy="15" r="8" fill="${c(0)}"/><circle cx="17" cy="12" r="2.2" fill="rgba(255,255,255,.5)"/>`;
      break;
    case 'symbol':
      body = `<circle cx="16" cy="23" r="12" fill="${c(0)}" opacity=".85"/>`
        + `<circle cx="29" cy="14" r="7.5" fill="${c(1)}" opacity=".9"/>`
        + `<circle cx="31" cy="30" r="4.5" fill="${c(2)}"/>`;
      break;
    case 'label':
      body = `<text x="20" y="25" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="2" fill="${c(0)}">ABC</text>`;
      break;
    case 'lines':
      body = `<path d="M4 11c10-6 18 8 32-1" fill="none" stroke="${c(0)}" stroke-width="3" stroke-linecap="round"/>`
        + `<path d="M4 22c8 8 20-8 32 4" fill="none" stroke="${c(1)}" stroke-width="2.4" stroke-linecap="round"/>`
        + `<path d="M4 32c10-6 22 8 32-1" fill="none" stroke="${c(2)}" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case 'ramp': {
      const n = cs.length;
      let bands = '';
      cs.forEach((col, i) => { bands += `<rect x="${6 + (i * 28) / n}" y="6" width="${28 / n + 0.5}" height="28" fill="${col}"/>`; });
      body = `<clipPath id="${id}"><rect x="6" y="6" width="28" height="28" rx="7"/></clipPath><g clip-path="url(#${id})">${bands}</g>`;
      break;
    }
    case 'mosaic':
      body = mosaic(cs.length ? cs : [INK], id);
      break;
    case 'prisms':
      body = `<rect x="7" y="22" width="7" height="12" rx="1.5" fill="${INK}" opacity=".45"/>`
        + `<rect x="16.5" y="14" width="7" height="20" rx="1.5" fill="${INK}" opacity=".65"/>`
        + `<rect x="26" y="5" width="7" height="29" rx="1.5" fill="${INK}" opacity=".85"/>`
        + `<path d="M4 34.5h32" stroke="${INK}" stroke-width="1.2" opacity=".5"/>`;
      break;
    case 'regional':
      body = `<path d="M9 6h17l6 6v22H9z" fill="${PAPER}" stroke="${c(0)}" stroke-width="1.6" stroke-linejoin="round"/>`
        + `<path d="M26 6v6h6" fill="none" stroke="${c(0)}" stroke-width="1.6" stroke-linejoin="round"/>`
        + glyph(layer.icon, 12.5, 14, 0.6, c(0), 2.2);
      break;
  }
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${body}</svg>`;
}

function note(text, cls = 'legend-note') {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

/** A choropleth's own key: its bands, their ranges, the unit, and any caveat. */
function scaleKey(layer, compact) {
  const scale = layer.scale || [];
  if (scale.length < 2) return null;
  const out = document.createDocumentFragment();
  const unit = pick(layer.unit || {}).replace('{n}', '').trim();
  if (compact) {
    // One stripe and its ends: the row has one line to say it in.
    const ramp = document.createElement('span');
    ramp.className = 'legend-ramp';
    for (const b of scale) {
      const s = document.createElement('span');
      s.style.setProperty('--c', safe(b.color));
      ramp.appendChild(s);
    }
    const lo = document.createElement('span');
    lo.textContent = formatNumber(scale[0].from);
    const hi = document.createElement('span');
    hi.textContent = `${formatNumber(scale[scale.length - 1].from)}+${unit ? ' ' + unit : ''}`;
    const row = document.createElement('span');
    row.className = 'legend legend-compact';
    row.append(lo, ramp, hi);
    out.appendChild(row);
    return out;
  }
  const ul = document.createElement('ul');
  ul.className = 'legend';
  ul.dataset.kind = 'choropleth';
  scale.forEach((band, i) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.setProperty('--c', safe(band.color));
    const next = scale[i + 1];
    li.append(sw, document.createTextNode(next
      ? `${formatNumber(band.from)}–${formatNumber(next.from)}`
      : `${formatNumber(band.from)}+`));
    ul.appendChild(li);
  });
  out.appendChild(ul);
  if (unit) out.appendChild(note(unit, 'legend-unit'));
  if (layer.note) out.appendChild(note(pick(layer.note)));
  return out;
}

/**
 * A `prisms` layer's key: what the columns' heights mean. Each bar is drawn at the
 * fraction of the range its value sits at, which is the same linear map the vertex
 * shader raises the ground by.
 */
function heightKey(layer, compact) {
  if (!layer.height?.legend?.length) return null;
  const [lo, hi] = layer.height.domain || [0, 1];
  const out = document.createDocumentFragment();
  const ul = document.createElement('ul');
  ul.className = 'legend legend-heights';
  const unit = pick(layer.unit || {});
  for (const v of layer.height.legend) {
    const li = document.createElement('li');
    const bar = document.createElement('span');
    bar.className = 'legend-bar';
    bar.style.setProperty('--h', `${(Math.min(1, Math.max(0, (v - lo) / ((hi - lo) || 1))) * 30 + 2).toFixed(1)}px`);
    li.append(bar, document.createTextNode(unit ? unit.replace('{n}', formatNumber(v)) : formatNumber(v)));
    ul.appendChild(li);
  }
  out.append(ul);
  if (layer.note && !compact) out.append(note(pick(layer.note)));
  return out;
}

/**
 * A `symbols` layer's other key: what the circles' sizes mean. The values it shows are
 * the layer's own (`size.legend`), and the circle beside each is drawn at exactly the
 * diameter the map would draw it at, by the same sizer the engine uses.
 */
function sizeKey(layer) {
  if (!['symbol', 'dot'].includes(layer.marker) || !layer.size?.legend?.length) return null;
  const sizer = symbolSizer(layer.size);
  const across = layer.marker === 'dot' ? 2 : 1;      // a bead's size is its radius; the key shows the bead
  const ul = document.createElement('ul');
  ul.className = 'legend legend-sizes';
  const unit = pick((layer.fields || {})[layer.size.field]?.unit || {});
  for (const v of layer.size.legend) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'legend-size';
    sw.style.setProperty('--d', `${(sizer({ [layer.size.field]: v }) * across).toFixed(1)}px`);
    li.append(sw, document.createTextNode(unit ? unit.replace('{n}', formatNumber(v)) : formatNumber(v)));
    ul.appendChild(li);
  }
  return ul;
}

/**
 * The key to a layer: a swatch and a name per category (a dot for points, a stroke for
 * lines, a square for a fill), or the bands, sizes and heights of the layers that have
 * those. `compact` is the one-line form a row in a list has room for; the full form
 * carries the unit and the caveat as well. Null when there is nothing to say.
 * @returns {DocumentFragment | HTMLElement | null}
 */
export function layerKey(layer, { compact = false } = {}) {
  const kind = kindOf(layer);
  if (kind === 'prisms') return heightKey(layer, compact);
  if (kind === 'ramp') return scaleKey(layer, compact);
  const cats = layer.categories || [];
  if (cats.length < 2) return null;
  const ul = document.createElement('ul');
  ul.className = 'legend';
  ul.dataset.kind = layer.scale === CATEGORICAL || kind === 'mosaic' ? 'fill' : kind === 'lines' ? 'lines' : 'points';
  for (const c of cats) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.setProperty('--c', safe(c.color));
    li.append(sw, document.createTextNode(pick(c.title)));
    ul.appendChild(li);
  }
  const size = compact ? null : sizeKey(layer);
  if (compact || (!layer.note && !size)) return ul;
  const out = document.createDocumentFragment();
  out.append(ul);
  if (size) out.append(size);
  if (layer.note) out.append(note(pick(layer.note)));
  return out;
}
