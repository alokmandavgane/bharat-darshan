// @ts-check
// Markers drawn by the GPU (PLAN.md section 5): the clay `token` -- a peg with a tinted
// head and the category's glyph on it -- the `dot`, a bead the size of a pinhead, the
// `symbol`, a counter whose face carries a value, and the `model`, a figurine built from
// a recipe. All are instanced: one draw call per kind of thing, however many of them. All stand on the terrain by reading the
// heightmap in the vertex shader, so nothing is placed per frame on the CPU. A soft
// shadow disc under each, and the glyph decal on a peg's head, are further instanced
// draws sharing the same buffers. HTML carries only the names (points.js); picking is
// done here by projecting the anchors, since a bead has no element to click.
// The engine knows the marker kinds, never a layer's id.
import { CircleGeometry, Color, DynamicDrawUsage, GLSL3, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { loadGlyphAtlas } from './glyph-atlas.js';
import { beadGeometry, buildModel, coinGeometry, PEG, pegGeometry } from './models.js';
import { symbolSizer } from './points.js';
import markFrag from './shaders/mark.frag.glsl?raw';
import markVert from './shaders/mark.vert.glsl?raw';

const DOT_PX = 2.4;              // a bead's radius when the layer sizes none
const MODEL_PX = 1.5;            // screen px per model unit at the base scale: a figurine stands about 30 px
const TOKEN_PX = { 1: 2.6, 2: 2.2, 3: 1.9 };   // px per unit by priority: a head 26, 22 or 19 px across, close up
const ORDER = 5;                 // after the terrain and the lines
const POP_S = 0.42;              // how long a marker takes to spring up
const STAGGER_S = 0.026;         // between one marker appearing and the next
const STAGGER_MAX_S = 0.9;
const BEAD = 'bead';
const PEG_MODEL = 'peg';
const COIN = 'coin';
// A counter lies on the ground, so a tilted view foreshortens it -- every one of them by
// the same amount, which is what keeps them comparable, and which is what happens to a
// printed proportional circle when the map it is on is tilted.
const KINDS = ['dot', 'model', 'symbol'];

/**
 * @param {import('three').Scene} scene
 * @param {Record<string, { value: any }>} tu  the terrain's uniforms, shared so a marker rides what the terrain does
 * @param {{ loadRecipe: (name: string) => Promise<any> }} opts
 */
export function createMarks(scene, tu, { loadRecipe, grid }) {
  /** @type {Map<string, any>} */
  const layers = new Map();
  /** @type {Map<string, Promise<{ geometry: any, footprint: number, height: number }>>} */
  const models = new Map();
  const shadowGeom = new CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  const decalGeom = new PlaneGeometry(2, 2);
  const uScale = { value: 1 };
  const uTime = { value: 0 };
  const uAtlas = { value: null };
  const uAtlasCols = { value: 4 };
  // The terrain mesh's quad counts: a marker stands on the surface that mesh draws.
  const uGrid = { value: new Vector2(grid.cols, grid.rows) };
  let sig = '';
  let until = 0;                 // ms until which something is still springing up

  /** One material per role: the thing itself, its shadow, or the decal on its head. */
  function material({ footprint = 0, decal = false } = {}) {
    return new ShaderMaterial({
      glslVersion: GLSL3, vertexShader: markVert, fragmentShader: markFrag,
      transparent: footprint > 0 || decal, depthWrite: !(footprint > 0 || decal), premultipliedAlpha: true,
      uniforms: {
        uHeight: tu.uHeight, uSizeKm: tu.uSizeKm, uExag: tu.uExag, uGamma: tu.uGamma, uHRef: tu.uHRef,
        uIds: tu.uIds, uHole: tu.uHole, uBlockLift: tu.uBlockLift, uPrismLut: tu.uPrismLut, uPrismKm: tu.uPrismKm,
        uKmPerPx: tu.uKmPerPx, uLightDir: tu.uLightDir,
        uScale, uTime, uAtlas, uAtlasCols, uGrid, uFootprint: { value: footprint }, uDecal: { value: decal ? 1 : 0 },
        uHeadY: { value: PEG.headY }, uHeadR: { value: PEG.headR },
      },
    });
  }

  function getModel(name) {
    if (!models.has(name)) {
      const own = { [BEAD]: beadGeometry, [PEG_MODEL]: pegGeometry, [COIN]: coinGeometry }[name];
      models.set(name, own ? Promise.resolve(own()) : loadRecipe(name).then(buildModel));
    }
    return /** @type {Promise<any>} */ (models.get(name));
  }

  /** An instanced copy of a base geometry, with the per-instance attributes attached. */
  function instanced(base, attrs, n) {
    const g = new InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'uv', 'color', 'tint']) if (base.getAttribute(k)) g.setAttribute(k, base.getAttribute(k));
    if (base.index) g.setIndex(base.index);
    for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
    g.instanceCount = n;
    return g;
  }

  /** One kind of thing in one layer: its instances, their shadow, their decal, and the buffers all read. */
  function makeGroup(base, recs, withDecal) {
    const n = recs.length;
    const anchor = new Float32Array(n * 2), size = new Float32Array(n), tint = new Float32Array(n * 3), glyph = new Float32Array(n);
    recs.forEach((r, i) => { anchor[i * 2] = r.item.x; anchor[i * 2 + 1] = r.item.z; size[i] = r.size; tint.set(r.tint, i * 3); glyph[i] = r.glyph; });
    const dyn = (arr) => new InstancedBufferAttribute(arr, 1).setUsage(DynamicDrawUsage);
    const attrs = {
      iAnchor: new InstancedBufferAttribute(anchor, 2), iSize: new InstancedBufferAttribute(size, 1),
      iTint: new InstancedBufferAttribute(tint, 3), iGlyph: new InstancedBufferAttribute(glyph, 1),
      iShow: dyn(new Float32Array(n)), iSel: dyn(new Float32Array(n)), iBorn: dyn(new Float32Array(n).fill(-1)),
    };
    const mesh = new Mesh(instanced(base.geometry, attrs, n), material());
    const shadow = new Mesh(instanced(shadowGeom, attrs, n), material({ footprint: base.footprint }));
    const decal = withDecal ? new Mesh(instanced(decalGeom, attrs, n), material({ decal: true })) : null;
    const meshes = [shadow, mesh, ...(decal ? [decal] : [])];
    meshes.forEach((m, i) => { m.frustumCulled = false; m.visible = false; m.renderOrder = ORDER - 1 + i; });
    scene.add(...meshes);
    return { recs, attrs, meshes, height: base.height, footprint: base.footprint, shown: new Uint8Array(n) };
  }

  /**
   * Add or replace a loaded layer. Resolves once its pieces are built, which is when the
   * caller should draw; a bead layer is ready at once, a peg layer once the glyph atlas is.
   */
  async function setLayer(layer) {
    remove(layer.id);
    const kind = KINDS.includes(layer.marker) ? layer.marker : 'token';
    const cats = Object.fromEntries((layer.categories || []).map((c) => [c.id, c]));
    const sizeOf = symbolSizer(layer.size);
    const entry = { layer, kind, records: [], groups: [] };
    layers.set(layer.id, entry);
    let atlas = null;
    if (kind === 'token') {
      atlas = await loadGlyphAtlas();
      if (layers.get(layer.id) !== entry) return;
      uAtlas.value = atlas.texture;
      uAtlasCols.value = atlas.cols;
    }
    const byModel = new Map();
    for (const item of layer.items) {
      const cat = cats[item.category] || {};
      const c = new Color(item.color || cat.color || '#b4552e');
      const glyphName = cat.icon || layer.icon;
      // `iSize` is px per model unit, and a bead and a counter are both radius 1, so a
      // layer's declared diameter is halved on the way in.
      const rec = {
        item, index: -1, group: null, tint: [c.r, c.g, c.b],
        size: kind === 'dot' ? (layer.size ? sizeOf(item) : DOT_PX)
          : kind === 'symbol' ? sizeOf(item) / 2
            : kind === 'model' ? MODEL_PX : (TOKEN_PX[item.priority] || TOKEN_PX[3]),
        model: { dot: BEAD, symbol: COIN, model: item.model }[kind] || PEG_MODEL,
        glyph: atlas ? (atlas.index.get(glyphName) ?? atlas.index.get('pin') ?? 0) : 0,
      };
      entry.records.push(rec);
      if (!byModel.has(rec.model)) byModel.set(rec.model, []);
      byModel.get(rec.model).push(rec);
    }
    for (const [name, recs] of byModel) {
      let base;
      try { base = await getModel(name); } catch (err) { console.warn(`model ${name} skipped:`, err); continue; }
      if (layers.get(layer.id) !== entry) return;        // replaced or removed meanwhile
      const group = makeGroup(base, recs, kind === 'token');
      recs.forEach((r, i) => { r.index = i; r.group = group; });
      entry.groups.push(group);
    }
    sig = '';
  }

  function remove(id) {
    const entry = layers.get(id);
    if (!entry) return;
    for (const g of entry.groups) {
      scene.remove(...g.meshes);
      for (const m of g.meshes) { m.geometry.dispose(); m.material.dispose(); }
    }
    layers.delete(id);
    sig = '';
  }

  /**
   * What shows this frame. Only the instance flags change, and only when something they
   * depend on has: the buffers are rewritten on a change of layers, level, month, zoom
   * band or selection, and left alone while the camera merely moves. Returns the time
   * (ms) until which markers are still springing up, so the caller keeps drawing.
   */
  function setView({ active, level, drafts, month, maxPriority, selected, scale, now }) {
    uScale.value = scale;
    uTime.value = now / 1000;
    const key = [[...active].join(','), level.name, level.id, drafts, month, maxPriority,
      selected ? `${selected.layer}:${selected.id}` : ''].join('|');
    if (key === sig) return until;
    sig = key;
    let popped = 0;
    for (const [id, entry] of layers) {
      const on = active.has(id);
      for (const g of entry.groups) for (const m of g.meshes) m.visible = on;
      if (!on) {
        for (const g of entry.groups) g.shown.fill(0);
        continue;
      }
      for (const rec of entry.records) {
        if (!rec.group) continue;
        const it = rec.item;
        const isSel = !!selected && selected.layer === id && selected.id === it.id;
        let show = drafts || it.status === 'reviewed';
        // The scrubber: an item with a month of its own goes with its month.
        if (show && month && it.month && it.month !== month) show = false;
        // Inside a state view every marker belongs to that state: the rest of the country
        // has stepped back, and its markers would be standing on a stage they left.
        if (show && level.name === 'state') show = it.region === level.id;
        // Tokens and beads thin with the zoom. A figurine is the point of its page, and a
        // counter's whole job is the comparison with the next one, so neither is thinned:
        // the reader switched that layer on to see the set.
        if (show && !['model', 'symbol'].includes(entry.kind) && it.priority > maxPriority && !isSel) show = false;
        const g = rec.group;
        if (show && !g.shown[rec.index]) {
          // Just arrived: it springs up after the ones before it, none of them too late.
          const born = now / 1000 + Math.min(STAGGER_MAX_S, popped * STAGGER_S);
          g.attrs.iBorn.array[rec.index] = born;
          until = Math.max(until, (born + POP_S) * 1000);
          popped++;
        }
        g.shown[rec.index] = show ? 1 : 0;
        g.attrs.iShow.array[rec.index] = show ? 1 : 0;
        g.attrs.iSel.array[rec.index] = isSel ? 1 : 0;
      }
      for (const g of entry.groups) for (const a of [g.attrs.iShow, g.attrs.iSel, g.attrs.iBorn]) a.needsUpdate = true;
    }
    return until;
  }

  /**
   * The marker nearest a screen point (px from the viewport centre, y up), within
   * `maxPx` of the thing itself: a bead is a small target, so the radius never goes
   * under a finger's worth; a peg or a figurine is hit anywhere along its height.
   */
  function nearest(project, sx, sy, maxPx, active) {
    let best = null;
    for (const [id, entry] of layers) {
      if (!active.has(id)) continue;
      for (const rec of entry.records) {
        if (!rec.group || !rec.group.shown[rec.index]) continue;
        const p = project([rec.item.x, rec.item.z]);
        if (!p) continue;
        const px = rec.size * uScale.value;                       // screen px per model unit
        const h = entry.kind === 'dot' ? px * 2 : rec.group.height * px;
        const r = Math.max(maxPx, (entry.kind === 'dot' ? 1.5 : rec.group.footprint) * px);
        // A counter is wide and flat: it is hit anywhere on its face, not just at its centre.
        const dx = sx - p[0];
        const dy = sy - p[1];
        const t = Math.max(0, Math.min(h, dy));
        const d2 = dx * dx + (dy - t) * (dy - t);
        if (d2 <= r * r && (!best || d2 < best.d2)) {
          best = { layer: id, item: rec.item, categories: entry.layer.categories, fields: entry.layer.fields, d2 };
        }
      }
    }
    return best;
  }

  function dispose() {
    for (const id of [...layers.keys()]) remove(id);
    shadowGeom.dispose();
    decalGeom.dispose();
    models.forEach((p) => p.then((m) => m.geometry.dispose()).catch(() => {}));
    models.clear();
  }

  return { setLayer, remove, setView, nearest, dispose, has: (id) => layers.has(id) };
}
