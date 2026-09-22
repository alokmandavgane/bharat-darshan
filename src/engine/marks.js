// @ts-check
// Markers drawn by the GPU (PLAN.md section 5): the `dot` marker, a clay bead the size
// of a pinhead, and the `model` marker, a figurine built from a recipe. Both are
// instanced -- one draw call per kind of thing, however many of them -- and both stand
// on the terrain by reading the heightmap in the vertex shader, so nothing is placed
// per frame on the CPU. A soft shadow disc under each is a second instanced draw that
// shares the instance buffers. HTML carries only the names (points.js); picking is
// done here by projecting the anchors, since a bead has no element to click.
// The engine knows the marker kinds, never a layer's id.
import { CircleGeometry, Color, DynamicDrawUsage, GLSL3, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial } from 'three';
import { beadGeometry, buildModel } from './models.js';
import { symbolSizer } from './points.js';
import markFrag from './shaders/mark.frag.glsl?raw';
import markVert from './shaders/mark.vert.glsl?raw';

const DOT_PX = 2.4;              // a bead's radius when the layer sizes none
const MODEL_PX = 1.5;            // screen px per model unit at the base scale: a figurine stands about 30 px
const ORDER = 5;                 // after the terrain and the lines
const BEAD = 'bead';

/**
 * @param {import('three').Scene} scene
 * @param {Record<string, { value: any }>} tu  the terrain's uniforms, shared so a marker rides what the terrain does
 * @param {{ loadRecipe: (name: string) => Promise<any> }} opts
 */
export function createMarks(scene, tu, { loadRecipe }) {
  /** @type {Map<string, any>} */
  const layers = new Map();
  /** @type {Map<string, Promise<{ geometry: any, footprint: number, height: number }>>} */
  const models = new Map();
  const shadowGeom = new CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  const uScale = { value: 1 };
  let sig = '';

  function material(footprint) {
    return new ShaderMaterial({
      glslVersion: GLSL3, vertexShader: markVert, fragmentShader: markFrag,
      transparent: footprint > 0, depthWrite: footprint <= 0, premultipliedAlpha: true,
      uniforms: {
        uHeight: tu.uHeight, uSizeKm: tu.uSizeKm, uExag: tu.uExag, uGamma: tu.uGamma, uHRef: tu.uHRef,
        uIds: tu.uIds, uHole: tu.uHole, uBlockLift: tu.uBlockLift, uPrismLut: tu.uPrismLut, uPrismKm: tu.uPrismKm,
        uKmPerPx: tu.uKmPerPx, uLightDir: tu.uLightDir,
        uScale, uFootprint: { value: footprint },
      },
    });
  }

  function getModel(name) {
    if (!models.has(name)) {
      models.set(name, name === BEAD ? Promise.resolve(beadGeometry()) : loadRecipe(name).then(buildModel));
    }
    return /** @type {Promise<any>} */ (models.get(name));
  }

  /** An instanced copy of a base geometry, with the per-instance attributes attached. */
  function instanced(base, attrs, n) {
    const g = new InstancedBufferGeometry();
    for (const k of ['position', 'normal', 'color', 'tint']) if (base.getAttribute(k)) g.setAttribute(k, base.getAttribute(k));
    if (base.index) g.setIndex(base.index);
    for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
    g.instanceCount = n;
    return g;
  }

  /** One kind of thing in one layer: its instances, their shadow, and the buffers both read. */
  function makeGroup(base, recs) {
    const n = recs.length;
    const anchor = new Float32Array(n * 2), size = new Float32Array(n), tint = new Float32Array(n * 3);
    recs.forEach((r, i) => { anchor[i * 2] = r.item.x; anchor[i * 2 + 1] = r.item.z; size[i] = r.size; tint.set(r.tint, i * 3); });
    const attrs = {
      iAnchor: new InstancedBufferAttribute(anchor, 2), iSize: new InstancedBufferAttribute(size, 1),
      iTint: new InstancedBufferAttribute(tint, 3),
      iShow: new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage),
      iSel: new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage),
    };
    const mesh = new Mesh(instanced(base.geometry, attrs, n), material(0));
    const shadow = new Mesh(instanced(shadowGeom, attrs, n), material(base.footprint));
    for (const m of [shadow, mesh]) { m.frustumCulled = false; m.visible = false; }
    shadow.renderOrder = ORDER - 1;
    mesh.renderOrder = ORDER;
    scene.add(shadow, mesh);
    return { recs, attrs, mesh, shadow, height: base.height, footprint: base.footprint };
  }

  /**
   * Add or replace a loaded layer. Resolves once its figurines are built, which is when
   * the caller should draw; a bead layer is ready at once.
   */
  async function setLayer(layer) {
    remove(layer.id);
    const kind = layer.marker;
    const cats = Object.fromEntries((layer.categories || []).map((c) => [c.id, c]));
    const sizeOf = symbolSizer(layer.size);
    const entry = { layer, kind, records: [], groups: [] };
    layers.set(layer.id, entry);
    const byModel = new Map();
    for (const item of layer.items) {
      const cat = cats[item.category] || {};
      const c = new Color(item.color || cat.color || '#b4552e');
      const rec = {
        item, index: -1, group: null, tint: [c.r, c.g, c.b],
        size: kind === 'dot' ? (layer.size ? sizeOf(item) : DOT_PX) : MODEL_PX,
        model: kind === 'dot' ? BEAD : item.model,
      };
      entry.records.push(rec);
      if (!byModel.has(rec.model)) byModel.set(rec.model, []);
      byModel.get(rec.model).push(rec);
    }
    for (const [name, recs] of byModel) {
      let base;
      try { base = await getModel(name); } catch (err) { console.warn(`model ${name} skipped:`, err); continue; }
      if (layers.get(layer.id) !== entry) return;        // replaced or removed meanwhile
      const group = makeGroup(base, recs);
      recs.forEach((r, i) => { r.index = i; r.group = group; });
      entry.groups.push(group);
    }
    sig = '';
  }

  function remove(id) {
    const entry = layers.get(id);
    if (!entry) return;
    for (const g of entry.groups) {
      scene.remove(g.mesh, g.shadow);
      g.mesh.geometry.dispose(); g.shadow.geometry.dispose();
      g.mesh.material.dispose(); g.shadow.material.dispose();
    }
    layers.delete(id);
    sig = '';
  }

  /**
   * What shows this frame. Only the instance flags change, and only when something they
   * depend on has: the buffers are rewritten on a change of layers, level, month, zoom
   * band or selection, and left alone while the camera merely moves.
   */
  function setView({ active, level, drafts, month, maxPriority, selected, scale }) {
    uScale.value = scale;
    const key = [[...active].join(','), level.name, level.id, drafts, month, maxPriority,
      selected ? `${selected.layer}:${selected.id}` : ''].join('|');
    if (key === sig) return;
    sig = key;
    for (const [id, entry] of layers) {
      const on = active.has(id);
      for (const g of entry.groups) { g.mesh.visible = on; g.shadow.visible = on; }
      if (!on) continue;
      for (const rec of entry.records) {
        if (!rec.group) continue;
        const it = rec.item;
        const isSel = !!selected && selected.layer === id && selected.id === it.id;
        let show = drafts || it.status === 'reviewed';
        // The scrubber: an item with a month of its own goes with its month.
        if (show && month && it.month && it.month !== month) show = false;
        // Beads thin with the zoom the way tokens do; a figurine is the point of its page.
        if (show && entry.kind === 'dot' && it.priority > maxPriority && !isSel) show = false;
        rec.group.attrs.iShow.array[rec.index] = show ? 1 : 0;
        rec.group.attrs.iSel.array[rec.index] = isSel ? 1 : 0;
      }
      for (const g of entry.groups) { g.attrs.iShow.needsUpdate = true; g.attrs.iSel.needsUpdate = true; }
    }
  }

  /**
   * The marker nearest a screen point (px from the viewport centre, y up), within
   * `maxPx` of the thing itself: a bead is a small target, so the radius never goes
   * under a finger's worth; a figurine is hit anywhere along its height.
   */
  function nearest(project, sx, sy, maxPx, active) {
    let best = null;
    for (const [id, entry] of layers) {
      if (!active.has(id)) continue;
      for (const rec of entry.records) {
        if (!rec.group || rec.group.attrs.iShow.array[rec.index] < 1) continue;
        const p = project([rec.item.x, rec.item.z]);
        if (!p) continue;
        const px = rec.size * uScale.value;                       // screen px per model unit
        const h = entry.kind === 'dot' ? px * 2 : rec.group.height * px;
        const r = Math.max(maxPx, (entry.kind === 'dot' ? 1.5 : rec.group.footprint) * px);
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
    models.forEach((p) => p.then((m) => m.geometry.dispose()).catch(() => {}));
    models.clear();
  }

  return { setLayer, remove, setView, nearest, dispose, has: (id) => layers.has(id) };
}
