// @ts-check
// Region picking on the CPU: the pointer ray meets the displaced heightfield, then the
// ID raster says which state is there (PLAN.md section 6). Pure maths, no three.js.
import { basis, groundPoint, project as projectPoint } from './camera-math.js';

/**
 * Wrap a tier's decoded packs for sampling in scene km.
 *
 * Heights are taken from the same surface the GPU draws: the heightmap sampled at the
 * mesh's vertices (bilinear, like the vertex shader) and interpolated between them.
 * Picking against the finer raster would hit peaks the coarse mesh never renders and
 * land the selection somewhere the user did not touch.
 * @param {{ heights: any, ids: any }} tier
 * @param {{ w: number, h: number }} sizeKm
 * @param {{ cols: number, rows: number }} mesh  quad counts of the terrain grid
 */
export function createHeightfield(tier, sizeKm, mesh) {
  const { width: hw, height: hh, data: hd } = tier.heights;
  const { width: iw, height: ih, data: idd } = tier.ids;
  const nx = mesh.cols + 1, nz = mesh.rows + 1;
  const texelKm = Math.min(sizeKm.w / mesh.cols, sizeKm.h / mesh.rows);

  /** Bilinear read of the raw heightmap at texture coordinates (u, v in 0..1), as the GPU does. */
  function rasterM(u, v) {
    const x = Math.min(Math.max(u * hw - 0.5, 0), hw - 1), y = Math.min(Math.max(v * hh - 0.5, 0), hh - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, hw - 1), y1 = Math.min(y0 + 1, hh - 1);
    const fx = x - x0, fy = y - y0;
    return (hd[y0 * hw + x0] * (1 - fx) + hd[y0 * hw + x1] * fx) * (1 - fy)
      + (hd[y1 * hw + x0] * (1 - fx) + hd[y1 * hw + x1] * fx) * fy;
  }

  const verts = new Float32Array(nx * nz);
  let maxM = -Infinity;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h = rasterM(i / mesh.cols, j / mesh.rows);
      verts[j * nx + i] = h;
      if (h > maxM) maxM = h;
    }
  }

  /** Height in metres of the rendered surface at a scene position; 0 outside the grid. */
  function heightM(x, z) {
    const u = (x / sizeKm.w + 0.5) * mesh.cols;
    const v = (z / sizeKm.h + 0.5) * mesh.rows;
    if (!(u >= 0 && v >= 0 && u <= mesh.cols && v <= mesh.rows)) return 0;
    const x0 = Math.min(Math.floor(u), mesh.cols - 1), y0 = Math.min(Math.floor(v), mesh.rows - 1);
    const fx = u - x0, fy = v - y0;
    const a = verts[y0 * nx + x0], b = verts[y0 * nx + x0 + 1], c = verts[(y0 + 1) * nx + x0], d = verts[(y0 + 1) * nx + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** Region id under a scene position, sampled exactly like the shader (nearest texel). */
  function idAt(x, z) {
    const col = Math.floor((x / sizeKm.w + 0.5) * iw);
    const row = Math.floor((z / sizeKm.h + 0.5) * ih);
    if (col < 0 || row < 0 || col >= iw || row >= ih) return 0;
    return idd[row * iw + col];
  }

  return { heightM, idAt, texelKm, maxM: Math.max(maxM, 0) };
}

/**
 * Where does the ray through a screen point (px from the viewport centre, y up) hit
 * the terrain? Marches down the ray from above the highest peak, then bisects.
 * @param {(hM: number) => number} liftKm  the vertical curve currently rendered
 * @param {{ id: number, km: number } | null} [raised]  a state drawn as a block lifted by km
 * @returns {{ x: number, y: number, z: number, id: number }}
 */
export function pickTerrain(cam, viewport, sx, sy, field, liftKm, raised = null) {
  const { toCam } = basis(cam.yaw, cam.pitch);
  const [gx, gz] = groundPoint(cam, sx, sy, viewport);
  const sinP = Math.max(toCam[1], 1e-3);
  const cosP = Math.max(Math.hypot(toCam[0], toCam[2]), 1e-3);
  const top = liftKm(field.maxM) + 1 + (raised ? raised.km : 0);
  const sMax = top / sinP;
  // half a texel sideways, or 2 km vertically, whichever is the smaller step
  const ds = Math.max(0.05, Math.min((0.5 * field.texelKm) / cosP, 2 / sinP));
  const at = (s) => [gx + toCam[0] * s, toCam[1] * s, gz + toCam[2] * s];
  const surface = (x, z) => liftKm(field.heightM(x, z)) + (raised && field.idAt(x, z) === raised.id ? raised.km : 0);
  const below = (p) => p[1] <= surface(p[0], p[2]);
  let sAbove = sMax;
  for (let s = sMax - ds; s >= 0; s -= ds) {
    if (below(at(s))) {
      let lo = s, hi = sAbove;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) / 2;
        if (below(at(m))) lo = m; else hi = m;
      }
      const p = at(hi);
      return { x: p[0], y: p[1], z: p[2], id: field.idAt(p[0], p[2]) };
    }
    sAbove = s;
  }
  return { x: gx, y: 0, z: gz, id: field.idAt(gx, gz) };
}

/** Screen position (px from the viewport centre, y up) of a ground location, on top of the terrain. */
export function projectGround(cam, viewport, x, z, field, liftKm, raised = null) {
  const y = liftKm(field.heightM(x, z)) + (raised && field.idAt(x, z) === raised.id ? raised.km : 0);
  return projectPoint(cam, [x, y, z], viewport);
}

/** Units below this size are hard to hit on a phone and win ties within the bias radius. */
export const SMALL_UNIT_KM2 = 12000;
export const BIAS_RADIUS_PX = 24;
export const BIAS_STEP_PX = 6;

/**
 * Touch picking bias (PLAN.md section 3): if the finger landed on a big region or the
 * sea but a small unit lies within about 24 px, take the smallest such unit. Samples a
 * 6 px grid inside the radius (about 50 picks, well under a frame) so that a state a
 * few pixels wide cannot slip between samples.
 * @param {(sx: number, sy: number) => number} idAtScreen
 * @param {(id: number) => number} areaOf  km² of a unit, Infinity when unknown
 */
export function biasedPick(sx, sy, idAtScreen, areaOf) {
  const centre = idAtScreen(sx, sy);
  const small = (id) => id > 0 && areaOf(id) < SMALL_UNIT_KM2;
  if (small(centre)) return centre;
  let best = 0, bestKey = Infinity;
  for (let dy = -BIAS_RADIUS_PX; dy <= BIAS_RADIUS_PX; dy += BIAS_STEP_PX) {
    for (let dx = -BIAS_RADIUS_PX; dx <= BIAS_RADIUS_PX; dx += BIAS_STEP_PX) {
      const d2 = dx * dx + dy * dy;
      if (d2 > BIAS_RADIUS_PX * BIAS_RADIUS_PX) continue;
      const id = idAtScreen(sx + dx, sy + dy);
      if (!small(id)) continue;
      const key = areaOf(id) * 1e6 + d2;          // smallest unit first, then nearest
      if (key < bestKey) { best = id; bestKey = key; }
    }
  }
  return best || centre;
}
