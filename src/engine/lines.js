// @ts-check
// The `lines` layer type (PLAN.md section 5): runs of coordinates laid on the terrain as
// ribbons widened in screen space, so a river is the same weight at every zoom. The
// engine knows the type and the fields a line item carries -- rank, category, geometry --
// and never a layer's id.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import lineFrag from './shaders/line.frag.glsl?raw';
import lineVert from './shaders/line.vert.glsl?raw';

const RANK_PX = [1.5, 1.1, 0.8];         // half-width in CSS pixels, widest river first
const RANK_ZOOM = [0, 0, 2400];          // view height (km) below which a rank appears; 0 = always

/**
 * One ribbon geometry for a whole layer, and the records picking needs: every item with
 * its runs, its bounding box in scene km, and the index the shader highlights it by.
 * @param {{ items: any[], categories?: any[] }} data
 */
export function linesGeometry(data) {
  const colours = new Map((data.categories || []).map((c) => [c.id, new Color(c.color || '#5a7f97')]));
  const runs = [];
  const records = (data.items || []).map((item, idx) => {
    const colour = colours.get(item.category) || new Color('#5a7f97');
    const mine = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const flat of item.lines || []) {
      if (flat.length < 4) continue;
      for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] < x0) x0 = flat[i];
        if (flat[i] > x1) x1 = flat[i];
        if (flat[i + 1] < z0) z0 = flat[i + 1];
        if (flat[i + 1] > z1) z1 = flat[i + 1];
      }
      mine.push(flat);
      runs.push({ flat, colour, rank: item.rank || 3, idx });
    }
    return { item, idx, runs: mine, bbox: [x0, z0, x1, z1] };
  }).filter((r) => r.runs.length);
  const points = runs.reduce((n, r) => n + r.flat.length / 2, 0);
  const pos = new Float32Array(points * 2 * 3);
  const dir = new Float32Array(points * 2 * 2);
  const side = new Float32Array(points * 2);
  const dist = new Float32Array(points * 2);        // km from the run's start, for the flow
  const rank = new Float32Array(points * 2);
  const colour = new Float32Array(points * 2 * 3);
  const itemIdx = new Float32Array(points * 2);
  const index = new Uint32Array(Math.max(0, (points - runs.length) * 6));
  let v = 0, q = 0;
  for (const run of runs) {
    const n = run.flat.length / 2;
    const first = v;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const x = run.flat[i * 2], z = run.flat[i * 2 + 1];
      if (i > 0) along += Math.hypot(x - run.flat[(i - 1) * 2], z - run.flat[(i - 1) * 2 + 1]);
      // tangent: forward at the start, backward at the end, the mean of the two between
      const px = i > 0 ? run.flat[(i - 1) * 2] : x, pz = i > 0 ? run.flat[(i - 1) * 2 + 1] : z;
      const nx = i < n - 1 ? run.flat[(i + 1) * 2] : x, nz = i < n - 1 ? run.flat[(i + 1) * 2 + 1] : z;
      let tx = nx - px, tz = nz - pz;
      const len = Math.hypot(tx, tz) || 1;
      tx /= len; tz /= len;
      for (const s of [-1, 1]) {
        pos[v * 3] = x; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = z;
        dir[v * 2] = tx; dir[v * 2 + 1] = tz;
        side[v] = s;
        dist[v] = along;
        rank[v] = run.rank;
        itemIdx[v] = run.idx;
        colour[v * 3] = run.colour.r; colour[v * 3 + 1] = run.colour.g; colour[v * 3 + 2] = run.colour.b;
        v++;
      }
      if (i < n - 1) {
        const a = first + i * 2;
        index[q++] = a; index[q++] = a + 1; index[q++] = a + 2;
        index[q++] = a + 2; index[q++] = a + 1; index[q++] = a + 3;
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('dir', new BufferAttribute(dir, 2));
  g.setAttribute('side', new BufferAttribute(side, 1));
  g.setAttribute('dist', new BufferAttribute(dist, 1));
  g.setAttribute('rank', new BufferAttribute(rank, 1));
  g.setAttribute('colour', new BufferAttribute(colour, 3));
  g.setAttribute('itemIdx', new BufferAttribute(itemIdx, 1));
  g.setIndex(new BufferAttribute(index, 1));
  return { geometry: g, records };
}

/** Square of the distance from (x, z) to the segment a-b, in scene km. */
function segDist2(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)) : 0;
  const dx = x - (ax + t * vx), dz = z - (az + t * vz);
  return dx * dx + dz * dz;
}

/**
 * A material sharing a surface's height, ids and vertical curve.
 * @param {any} surface uniforms of the terrain or of a lifted block
 * @param {boolean} onBlock true for the copy drawn on the lifted block
 */
function lineMaterial(surface, onBlock, flow) {
  return new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: lineVert, fragmentShader: lineFrag,
    transparent: true, depthWrite: false, side: DoubleSide, premultipliedAlpha: true,
    uniforms: {
      uHeight: surface.uHeight, uIds: surface.uIds, uSizeKm: surface.uSizeKm,
      uExag: surface.uExag, uGamma: surface.uGamma, uHRef: surface.uHRef,
      uLocalRect: surface.uLocalRect, uLift: onBlock ? surface.uLift : { value: 0 },
      uDim: surface.uDim,
      uResolution: { value: new Vector2(1, 1) },
      uRankPx: { value: new Vector3(...RANK_PX) },
      uRankZoom: { value: new Vector3(...RANK_ZOOM) },
      uZoom: { value: 3000 },
      uSelectedIdx: { value: -1 },
      uLiftedId: { value: -1 },
      uOnBlock: { value: onBlock ? 1 : 0 },
      uFlow: { value: flow ? 1 : 0 },
      uTime: { value: 0 },
    },
  });
}

/**
 * Every `lines` layer on screen. One geometry per layer, drawn once on the country plate
 * and once more on the lifted block when there is one, so each surface shows the part of
 * a run that belongs to it.
 */
export function createLines(scene, terrainUniforms) {
  /** @type {Map<string, { geometry: any, records: any[], plate: any, block: any }>} */
  const layers = new Map();
  let active = new Set();
  let blockUniforms = null;
  let liftedId = -1;
  let selected = null;
  const view = { w: 1, h: 1, zoom: 3000 };

  function eachMaterial(fn) {
    for (const l of layers.values()) { fn(l.plate.material); if (l.block) fn(l.block.material); }
  }

  function applyView() {
    eachMaterial((m) => {
      m.uniforms.uResolution.value.set(view.w, view.h);
      m.uniforms.uZoom.value = view.zoom;
      m.uniforms.uLiftedId.value = liftedId;
    });
    for (const [id, l] of layers) {
      const idx = selected && selected.layer === id ? l.records.find((r) => r.item.id === selected.id)?.idx ?? -1 : -1;
      l.plate.material.uniforms.uSelectedIdx.value = idx;
      if (l.block) l.block.material.uniforms.uSelectedIdx.value = idx;
    }
  }

  function setBlockMesh(entry) {
    if (entry.block) { scene.remove(entry.block); entry.block.material.dispose(); entry.block = null; }
    if (!blockUniforms) return;
    const mesh = new Mesh(entry.geometry, lineMaterial(blockUniforms, true, entry.flow));
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = entry.plate.visible;
    entry.block = mesh;
    scene.add(mesh);
  }

  return {
    /** Add (or replace) a layer's geometry. `data` is public/data/layers/<id>.json. */
    setLayer(data) {
      this.remove(data.id);
      const { geometry, records } = linesGeometry(data);
      const flow = !!data.flow;
      const plate = new Mesh(geometry, lineMaterial(terrainUniforms, false, flow));
      plate.frustumCulled = false;
      plate.renderOrder = 3;
      plate.visible = active.has(data.id);
      const entry = { geometry, records, categories: data.categories || [], flow, plate, block: null };
      layers.set(data.id, entry);
      scene.add(plate);
      setBlockMesh(entry);
      applyView();
    },
    has(id) { return layers.has(id); },
    /** Which layers the visitor has switched on. */
    setActive(ids) {
      active = new Set(ids);
      for (const [id, l] of layers) {
        l.plate.visible = active.has(id);
        if (l.block) l.block.visible = l.plate.visible;
      }
    },
    /** The lifted block's surface, or null back at country level. */
    setBlock(uniforms, id) {
      blockUniforms = uniforms;
      liftedId = uniforms ? id : -1;
      for (const entry of layers.values()) setBlockMesh(entry);
      applyView();
    },
    /**
     * The item nearest a point on the ground, within `maxKm`, across the layers on show.
     * Ranks break ties, so a great river wins over the tributary beside it.
     */
    nearest(x, z, maxKm) {
      let best = null;
      const max2 = maxKm * maxKm;
      for (const [id, l] of layers) {
        if (!active.has(id)) continue;
        for (const rec of l.records) {
          const [x0, z0, x1, z1] = rec.bbox;
          if (x < x0 - maxKm || x > x1 + maxKm || z < z0 - maxKm || z > z1 + maxKm) continue;
          for (const flat of rec.runs) {
            for (let i = 0; i + 3 < flat.length; i += 2) {
              const d2 = segDist2(x, z, flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
              if (d2 > max2) continue;
              const score = d2 + (rec.item.rank || 3) * 0.02 * max2;
              if (!best || score < best.score) best = { layer: id, item: rec.item, categories: l.categories, score };
            }
          }
        }
      }
      return best;
    },
    /** A line item by id, for the card and the camera. */
    find(layerId, itemId) {
      return layers.get(layerId)?.records.find((r) => r.item.id === itemId) || null;
    },
    /** Highlight one item, or nothing. */
    setSelected(sel) {
      selected = sel;
      applyView();
    },
    /** True while a layer whose runs move is on screen: the engine's cue to keep drawing. */
    get flowing() {
      for (const l of layers.values()) if (l.flow && l.plate.visible) return true;
      return false;
    },
    /** Advance the flow. Seconds; the engine only calls this while it means to animate. */
    setTime(t) {
      eachMaterial((m) => { m.uniforms.uTime.value = t; });
    },
    setView(w, h, zoom) {
      view.w = w; view.h = h; view.zoom = zoom;
      applyView();
    },
    remove(id) {
      const l = layers.get(id);
      if (!l) return;
      scene.remove(l.plate);
      l.plate.material.dispose();
      if (l.block) { scene.remove(l.block); l.block.material.dispose(); }
      l.geometry.dispose();
      layers.delete(id);
    },
    dispose() { for (const id of [...layers.keys()]) this.remove(id); },
  };
}
