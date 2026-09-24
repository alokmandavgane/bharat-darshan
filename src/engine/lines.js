// @ts-check
// The `lines` layer type (PLAN.md section 5): runs of coordinates laid on the terrain as
// ribbons widened in screen space, so a river is the same weight at every zoom. The
// engine knows the type and the fields a line item carries -- rank, category, geometry --
// and never a layer's id.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Mesh, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three';
import lineFrag from './shaders/line.frag.glsl?raw';
import lineVert from './shaders/line.vert.glsl?raw';

const RANK_PX = [1.5, 1.1, 0.8];         // half-width in CSS pixels, widest river first
const RANK_ZOOM = [0, 0, 2400];          // view height (km) below which a rank appears; 0 = always

/**
 * A run cut wherever it crosses an edge of the mesh it is drawn on: the lines between
 * grid rows and columns, and the diagonal each quad is split along. Between two such
 * cuts the run lies on one flat triangle, so the ribbon, straight between its points,
 * follows the drawn ground exactly. Uncut, a highway simplified to one chord across a
 * range passes under every ridge between its ends. Rivers got away with it by lying in
 * valleys, where a chord runs above the ground; a road over a pass, a railway up a ghat
 * and a district line along a watershed do not. Widths are carried along the cuts.
 * @param {{ cols: number, rows: number, rect?: number[] } | null} grid
 * @param {{ x: number, y: number }} sizeKm
 */
function cutToGrid(flat, widths, grid, sizeKm) {
  if (!grid) return { flat, widths };
  const r = grid.rect || [0, 0, 1, 1];
  const sx = grid.cols / ((r[2] - r[0]) * sizeKm.x), sz = grid.rows / ((r[3] - r[1]) * sizeKm.y);
  const ox = (0.5 - r[0]) * grid.cols / (r[2] - r[0]), oz = (0.5 - r[1]) * grid.rows / (r[3] - r[1]);
  const out = [flat[0], flat[1]];
  const w = widths ? [widths[0]] : null;
  const ts = [];
  /** Where f0 + (f1 - f0) t passes a whole number, for t strictly inside (0, 1). */
  const crossings = (f0, f1) => {
    if (f1 === f0) return;
    const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
    for (let k = Math.floor(lo) + 1; k < hi; k++) ts.push((k - f0) / (f1 - f0));
  };
  for (let i = 2; i + 1 < flat.length; i += 2) {
    const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
    const gx0 = ax * sx + ox, gz0 = az * sz + oz, gx1 = bx * sx + ox, gz1 = bz * sz + oz;
    ts.length = 0;
    crossings(gx0, gx1);
    crossings(gz0, gz1);
    crossings(gx0 + gz0, gx1 + gz1);
    ts.sort((p, q) => p - q);
    ts.push(1);
    let last = 0;
    for (const t of ts) {
      if (t - last < 1e-6 && t < 1) continue;
      last = t;
      out.push(ax + (bx - ax) * t, az + (bz - az) * t);
      if (w) w.push(widths[i / 2 - 1] + (widths[i / 2] - widths[i / 2 - 1]) * t);
    }
  }
  return { flat: out, widths: w };
}

/**
 * One ribbon geometry for a whole layer, and the records picking needs: every item with
 * its runs, its bounding box in scene km, and the index the shader highlights it by.
 * `grid` is the mesh the ribbon is drawn on (see cutToGrid); `bbox` ([x0, z0, x1, z1] in
 * scene km) keeps only the runs that reach it, for the lifted block's own copy.
 * @param {{ items: any[], categories?: any[] }} data
 * @param {{ grid?: any, sizeKm?: any, bbox?: number[] | null }} [opts]
 */
export function linesGeometry(data, { grid = null, sizeKm = null, bbox = null } = {}) {
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
    }
    const box = [x0, z0, x1, z1];
    if (bbox && (x1 < bbox[0] || x0 > bbox[2] || z1 < bbox[1] || z0 > bbox[3])) return { item, idx, runs: mine, bbox: box };
    mine.forEach((flat, r) => {
      // A flow carries a width profile with its geometry: 1 along the shaft, a swell and
      // then a point at the tip, which is what makes the arrowhead. Anything else is a
      // line of even weight.
      // An arc shapes its own head in the shader, so the shipped width profile is not used.
      const d = data.arc ? cutToGrid(densifyEnds(flat), null, grid, sizeKm)
        : cutToGrid(flat, (item.widths || [])[r] || null, grid, sizeKm);
      runs.push({ flat: d.flat, colour, rank: item.rank || 3, idx, widen: d.widths });
    });
    return { item, idx, runs: mine, bbox: box };
  }).filter((r) => r.runs.length);
  const points = runs.reduce((n, r) => n + r.flat.length / 2, 0);
  const pos = new Float32Array(points * 2 * 3);
  const dir = new Float32Array(points * 2 * 2);
  const side = new Float32Array(points * 2);
  const dist = new Float32Array(points * 2);        // km from the run's start, for the flow
  const rank = new Float32Array(points * 2);
  const widen = new Float32Array(points * 2);
  const colour = new Float32Array(points * 2 * 3);
  const itemIdx = new Float32Array(points * 2);
  const runKm = new Float32Array(points * 2);       // an arc's whole length ...
  const ends = new Float32Array(points * 2 * 4);    // ... and the ground it leaves and lands on
  const index = new Uint32Array(Math.max(0, (points - runs.length) * 6));
  let v = 0, q = 0;
  for (const run of runs) {
    const n = run.flat.length / 2;
    const first = v;
    let along = 0;
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(run.flat[i * 2] - run.flat[i * 2 - 2], run.flat[i * 2 + 1] - run.flat[i * 2 - 1]);
    const e = [run.flat[0], run.flat[1], run.flat[n * 2 - 2], run.flat[n * 2 - 1]];
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
        widen[v] = run.widen ? run.widen[i] : 1;
        itemIdx[v] = run.idx;
        runKm[v] = total;
        ends.set(e, v * 4);
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
  g.setAttribute('widen', new BufferAttribute(widen, 1));
  g.setAttribute('colour', new BufferAttribute(colour, 3));
  g.setAttribute('itemIdx', new BufferAttribute(itemIdx, 1));
  g.setAttribute('runKm', new BufferAttribute(runKm, 1));
  g.setAttribute('ends', new BufferAttribute(ends, 4));
  g.setIndex(new BufferAttribute(index, 1));
  return { geometry: g, records };
}

/**
 * Does this run pass through the region the test answers for? Asked of the run's own
 * points, not its bounding box: a highway from Kashmir to Kanyakumari has a box that
 * contains every state, so a box test would offer it in all of them.
 */
function reaches(rec, inside) {
  for (const flat of rec.runs) {
    for (let i = 0; i + 1 < flat.length; i += 2) if (inside(flat[i], flat[i + 1])) return true;
  }
  return false;
}

/**
 * An `arc` layer's runs are drawn in the air (line.vert.glsl): each leaves the ground at
 * its first point, rises to a crown of `rise` times its length (at least `minKm`) and
 * lands at its last. The relief is exaggerated to tens of km, so the floor keeps a short
 * hop from being lost in the hills it crosses.
 */
export const ARC = { rise: 0.1, minKm: 18, shaft: 1.7, headPx: 15, headWiden: 3.0, gapEndPx: 11, gapStartPx: 6 };

/**
 * An arc's width is drawn by the shader in screen pixels (a head of `headPx`, stopping
 * `gapEndPx` short of the pin it points at), so where along the run the head begins
 * depends on the zoom. The run needs vertices there at every zoom: points are added at
 * geometric distances from each end, a few metres apart at the tip and a few hundred km
 * apart at the far end, 1.2 times further each step.
 */
export function densifyEnds(flat) {
  const n = flat.length / 2;
  if (n < 2) return flat;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]));
  const total = cum[n - 1];
  if (total <= 0) return flat;
  const at = new Set(cum);
  for (let r = 0.25; r < total * 0.5; r *= 1.2) { at.add(total - r); at.add(r); }
  const ds = [...at].filter((d) => d >= 0 && d <= total).sort((a, b) => a - b);
  const out = [];
  let j = 0;
  for (const d of ds) {
    while (j < n - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 0 ? Math.min(1, Math.max(0, (d - cum[j]) / seg)) : 0;
    out.push(flat[j * 2] + (flat[j * 2 + 2] - flat[j * 2]) * f, flat[j * 2 + 1] + (flat[j * 2 + 3] - flat[j * 2 + 1]) * f);
  }
  return out;
}

/** Height (scene km) of an arc at fraction t of a run `L` km long, between its ends' ground heights. */
export function arcY(t, ga, gb, L) {
  const rise = Math.max(ARC.minKm, ARC.rise * L);
  return ga + (gb - ga) * t + rise * 4 * t * (1 - t);
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
/**
 * @param {boolean} float_  a line the model never hides: a parallel, a meridian, a
 *   monsoon arrow. It still follows the relief, so it stays where it belongs on the
 *   ground -- laying it flat would slide it off the places it marks on a tilted view --
 *   but the depth test is off, so a hill in front of it does not cut it. Raising it
 *   instead was the first try and does not hold: something taller always comes along,
 *   and the arrows over the Western Ghats were sawn into fragments.
 */
function lineMaterial(surface, onBlock, flow, float_ = false, grid = { cols: 1024, rows: 1024 }, arc = false) {
  const rect = grid.rect || [0, 0, 1, 1];
  return new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: lineVert, fragmentShader: lineFrag,
    transparent: true, depthWrite: false, depthTest: !float_, side: DoubleSide, premultipliedAlpha: true,
    uniforms: {
      uHeight: surface.uHeight, uIds: surface.uIds, uSizeKm: surface.uSizeKm,
      uExag: surface.uExag, uGamma: surface.uGamma, uHRef: surface.uHRef,
      uLocalRect: surface.uLocalRect, uLift: onBlock ? surface.uLift : { value: 0 },
      uDim: surface.uDim,
      uResolution: { value: new Vector2(1, 1) },
      uRankPx: { value: new Vector3(...RANK_PX) },
      uRankZoom: { value: new Vector3(...RANK_ZOOM) },
      uZoom: { value: 3000 },
      uGrid: { value: new Vector2(grid.cols, grid.rows) },
      uGridRect: { value: new Vector4(...rect) },
      uSelectedIdx: { value: -1 },
      uLiftedId: { value: -1 },
      uOnBlock: { value: onBlock ? 1 : 0 },
      uFlow: { value: flow ? 1 : 0 },
      uTime: { value: 0 },
      uArc: { value: arc ? 1 : 0 },
      uArcRise: { value: new Vector2(ARC.rise, ARC.minKm) },
      uArcHead: { value: new Vector4(ARC.headPx, ARC.headWiden, ARC.gapEndPx, ARC.gapStartPx) },
      uArcShaft: { value: ARC.shaft },
    },
  });
}

/**
 * Every `lines` layer on screen. One geometry per layer, drawn once on the country plate
 * and once more on the lifted block when there is one, so each surface shows the part of
 * a run that belongs to it.
 */
export function createLines(scene, terrainUniforms, terrainGrid) {
  /** @type {Map<string, { geometry: any, records: any[], plate: any, block: any }>} */
  const layers = new Map();
  let active = new Set();
  let blockUniforms = null;
  let blockGrid = null;
  let liftedId = -1;
  const sizeKm = terrainUniforms.uSizeKm.value;
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
      const pick = (recs) => (selected && selected.layer === id
        ? recs.find((r) => r.item.id === selected.id)?.idx ?? -1 : -1);
      l.plate.material.uniforms.uSelectedIdx.value = pick(l.records);
      // The detail copy numbers its own items, so the block is told its own index.
      if (l.block) l.block.material.uniforms.uSelectedIdx.value = pick(l.detail?.records || l.records);
    }
  }

  function setBlockMesh(entry) {
    if (entry.block) {
      scene.remove(entry.block); entry.block.material.dispose(); entry.block.geometry.dispose(); entry.block = null;
    }
    if (!blockUniforms) return;
    // A layer may ship a finer copy of itself per state (PLAN.md D3). The plate keeps the
    // country's own weight; the lifted block, which is where a coarse line shows, draws
    // that state's sharper geometry instead as soon as it has arrived. Either way the
    // block gets a copy of its own, only the runs that reach it, cut to its finer grid.
    const rect = blockGrid?.rect || [0, 0, 1, 1];
    const bbox = [(rect[0] - 0.5) * sizeKm.x, (rect[1] - 0.5) * sizeKm.y, (rect[2] - 0.5) * sizeKm.x, (rect[3] - 0.5) * sizeKm.y];
    const src = entry.detailData ? { ...entry.detailData, categories: entry.categories, arc: entry.arc } : entry.data;
    const { geometry } = linesGeometry(src, { grid: blockGrid, sizeKm, bbox });
    const mesh = new Mesh(geometry, lineMaterial(blockUniforms, true, entry.flow, entry.float, blockGrid, entry.arc));
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
      const { geometry, records } = linesGeometry(data, { grid: terrainGrid, sizeKm });
      const flow = !!data.flow;
      const plate = new Mesh(geometry, lineMaterial(terrainUniforms, false, flow, !!data.float, terrainGrid, !!data.arc));
      plate.frustumCulled = false;
      plate.renderOrder = 3;
      plate.visible = active.has(data.id);
      const entry = { data, detailData: null, geometry, records, categories: data.categories || [], fields: data.fields || {}, flow, float: !!data.float, arc: !!data.arc, plate, block: null, detail: null, detailPaths: data.detail || null };
      layers.set(data.id, entry);
      scene.add(plate);
      setBlockMesh(entry);
      applyView();
    },
    has(id) { return layers.has(id); },
    /** Where a layer's finer geometry for one state lives, if it has any. */
    detailPath(id, slug) { return layers.get(id)?.detailPaths?.[slug] || null; },
    /**
     * Give a layer the finer geometry of the state now lifted, or `null` to drop it.
     * Only the block's copy changes: the plate is the whole country and keeps its own.
     */
    setDetail(id, data) {
      const l = layers.get(id);
      if (!l) return;
      // The detail file carries geometry and nothing else: the colours are the layer's,
      // and a copy without them would draw the whole state in the fallback blue. The
      // records are for picking; the block cuts its own geometry from the data.
      l.detailData = data;
      l.detail = null;
      if (data) {
        const { geometry, records } = linesGeometry({ ...data, categories: l.categories });
        geometry.dispose();
        l.detail = { records };
      }
      setBlockMesh(l);
      applyView();
    },
    /** Which layers the visitor has switched on. */
    setActive(ids) {
      active = new Set(ids);
      for (const [id, l] of layers) {
        l.plate.visible = active.has(id);
        if (l.block) l.block.visible = l.plate.visible;
      }
    },
    /** The lifted block's surface, or null back at country level. */
    setBlock(uniforms, id, grid = null) {
      blockGrid = grid;
      blockUniforms = uniforms;
      liftedId = uniforms ? id : -1;
      for (const entry of layers.values()) setBlockMesh(entry);
      applyView();
    },
    /**
     * The item nearest a point on the ground, within `maxKm`, across the layers on show.
     * Ranks break ties, so a great river wins over the tributary beside it. `named`
     * leaves out a network item, the unnamed mesh under the named courses.
     */
    nearest(x, z, maxKm, { named = false } = {}) {
      let best = null;
      const max2 = maxKm * maxKm;
      for (const [id, l] of layers) {
        if (!active.has(id) || l.arc) continue;   // an arc is in the air: see nearestArc
        for (const rec of l.records) {
          if (named && rec.item.network) continue;
          const [x0, z0, x1, z1] = rec.bbox;
          if (x < x0 - maxKm || x > x1 + maxKm || z < z0 - maxKm || z > z1 + maxKm) continue;
          for (const flat of rec.runs) {
            for (let i = 0; i + 3 < flat.length; i += 2) {
              const d2 = segDist2(x, z, flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
              if (d2 > max2) continue;
              const score = d2 + (rec.item.rank || 3) * 0.02 * max2;
              if (!best || score < best.score) best = { layer: id, item: rec.item, categories: l.categories, fields: l.fields, score };
            }
          }
        }
      }
      return best;
    },
    /**
     * The arc nearest a screen point, within `maxPx`. An arc is not on the ground, so the
     * point under the pointer says nothing about it: each run is lifted as the shader
     * lifts it and measured on the screen. `project(x, y, z, out)` gives px from the
     * viewport centre, y up; `groundKm(x, z)` the drawn surface's height at a point.
     */
    nearestArc(sx, sy, maxPx, project, groundKm) {
      let best = null;
      const a = [0, 0], b = [0, 0];
      for (const [id, l] of layers) {
        if (!active.has(id) || !l.arc) continue;
        for (const rec of l.records) {
          for (const flat of rec.runs) {
            const n = flat.length / 2;
            if (n < 2) continue;
            let L = 0;
            for (let i = 1; i < n; i++) L += Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
            const ga = groundKm(flat[0], flat[1]), gb = groundKm(flat[n * 2 - 2], flat[n * 2 - 1]);
            let along = 0;
            project(flat[0], arcY(0, ga, gb, L), flat[1], a);
            for (let i = 1; i < n; i++) {
              along += Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
              project(flat[i * 2], arcY(along / L, ga, gb, L), flat[i * 2 + 1], b);
              const d2 = segDist2(sx, sy, a[0], a[1], b[0], b[1]);
              const score = d2 + (rec.item.rank || 3) * 0.02 * maxPx * maxPx;
              if (d2 <= maxPx * maxPx && (!best || score < best.score)) {
                best = { layer: id, item: rec.item, categories: l.categories, fields: l.fields, score };
              }
              a[0] = b[0]; a[1] = b[1];
            }
          }
        }
      }
      return best;
    },
    /**
     * Every item of the layers on show, for the search index. With a test (is this point
     * in the lifted unit?), only the runs that pass through it: a search inside Kerala
     * should not answer with a highway that never comes near it.
     */
    list(active, inside = null) {
      const out = [];
      for (const [id, l] of layers) {
        if (!active.has(id)) continue;
        for (const rec of l.records) {
          if (inside && !reaches(rec, inside)) continue;
          out.push({ layer: id, item: rec.item });
        }
      }
      return out;
    },
    /** A line item by id, for the card and the camera, with what the card needs about it. */
    find(layerId, itemId) {
      const l = layers.get(layerId);
      const rec = l?.records.find((r) => r.item.id === itemId);
      return rec ? { ...rec, categories: l.categories, fields: l.fields } : null;
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
      if (l.block) { scene.remove(l.block); l.block.material.dispose(); l.block.geometry.dispose(); }
      l.geometry.dispose();
      layers.delete(id);
    },
    dispose() { for (const id of [...layers.keys()]) this.remove(id); },
  };
}
