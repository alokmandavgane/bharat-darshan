// @ts-check
// The terrain: one grid mesh displaced by the heightmap in the vertex shader, shaded by
// the clay / paper fragment shader. Layer-agnostic: it knows textures, not layers.
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Mesh, ShaderMaterial, Sphere, Vector2, Vector3, Vector4,
} from 'three';
import frag from './shaders/terrain.frag.glsl?raw';
import vert from './shaders/terrain.vert.glsl?raw';
import { byteTexture, grainTexture, heightTexture } from './textures.js';

/** Vertical curve y_km = exag * (h / hRef)^gamma * hRef / 1000. Keep in step with pipeline/02_dem.py. */
export const CURVE = { gamma: 0.65, hRef: 8000 };

/** Warm, desaturated clay palette (sRGB hex; three.js converts to linear for the shader). */
export const PALETTE = {
  table: '#efe6d6',
  ocean: '#bccbd0',
  bands: ['#a6b98a', '#bec394', '#d1c08f', '#caa77e', '#ad8f76', '#a59b93', '#efece7'],
  tops: [80, 250, 600, 1200, 2500, 5400, 9000],
};

/**
 * A (cols x rows)-quad grid with only a uv attribute; positions come from the heightmap.
 * `rect` = [u0, v0, u1, v1] covers part of the texture (the lifted block); default all of it.
 */
export function gridGeometry(cols, rows, rect = [0, 0, 1, 1]) {
  const nx = cols + 1, nz = rows + 1;
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 2;
      uv[k] = rect[0] + (i / cols) * (rect[2] - rect[0]);
      uv[k + 1] = rect[1] + (j / rows) * (rect[3] - rect[1]);
    }
  }
  const index = new Uint32Array(cols * rows * 6);
  let q = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      index[q++] = a; index[q++] = c; index[q++] = b;
      index[q++] = b; index[q++] = c; index[q++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/**
 * @param {{ tierData: any, grid: number, sizeKm: { w: number, h: number } }} opts
 */
export function createTerrain({ tierData, grid, sizeKm }) {
  const cols = Math.max(16, Math.round((grid * sizeKm.w) / sizeKm.h));
  const geometry = gridGeometry(cols, grid);
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), Math.hypot(sizeKm.w, sizeKm.h) / 2 + 400);

  const uniforms = {
    uHeight: { value: null },
    uHeightTexel: { value: new Vector2(1, 1) },
    // Which slice of country uv the bound rasters cover: identity for the country tiers,
    // the unit's padded bbox once a state package is swapped in (see setLocal in block.js).
    uLocalRect: { value: new Vector4(0, 0, 1, 1) },
    uShade: { value: null },
    uIds: { value: null },
    uBorders: { value: null },
    // India's own outline as a signed field: the cut-out's silhouette comes from this,
    // not from the ID raster, so it matches the walls standing on it.
    uIndiaEdge: { value: null },
    uEdgeRangeKm: { value: 1 },
    uBorderRangeKm: { value: 1 },
    uBorderTexelKm: { value: 1 },
    uGrain: { value: grainTexture() },
    uSizeKm: { value: new Vector2(sizeKm.w, sizeKm.h) },
    uExag: { value: 12 },
    uGamma: { value: CURVE.gamma },
    uHRef: { value: CURVE.hRef },
    uKmPerPx: { value: 4 },
    uSelected: { value: -1 },
    uHover: { value: -1 },
    uRegion: { value: -1 },
    uHole: { value: -1 },
    uDim: { value: 0 },
    uLift: { value: 0 },
    uOnlyIndia: { value: 1 },
    uTable: { value: new Color(PALETTE.table) },
    uOcean: { value: new Color(PALETTE.ocean) },
    uBands: { value: PALETTE.bands.map((c) => new Color(c)) },
    uBandTops: { value: Float32Array.from(PALETTE.tops) },
  };
  const material = new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms, side: DoubleSide,
  });

  /**
   * A second material with the same shaders and textures but its own scalar uniforms,
   * for the lifted block. Textures are shared by reference, never re-uploaded.
   */
  function siblingMaterial() {
    const u = {};
    for (const [k, { value }] of Object.entries(uniforms)) {
      u[k] = { value: value && typeof value === 'object' && !value.isTexture && typeof value.clone === 'function' ? value.clone()
        : value instanceof Float32Array ? Float32Array.from(value)
        : Array.isArray(value) ? value.map((c) => c.clone()) : value };
    }
    const m = new ShaderMaterial({ glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: u, side: DoubleSide });
    siblings.add(m);
    const dispose = m.dispose.bind(m);
    m.dispose = () => { siblings.delete(m); dispose(); };
    return m;
  }
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  let textures = [];
  const siblings = new Set();
  /** Swap in another tier's rasters (e.g. 2048 after the 1024 first view). */
  function setTier(data) {
    const next = {
      uHeight: heightTexture(data.heights),
      uShade: byteTexture(data.shade),
      uIds: byteTexture(data.ids, { nearest: true }),
      uBorders: byteTexture(data.borders),
    };
    if (data.edge) next.uIndiaEdge = byteTexture(data.edge);
    const old = new Set(textures);
    const apply = (u) => {
      for (const [k, tex] of Object.entries(next)) if (!u[k].value || old.has(u[k].value)) u[k].value = tex;
      u.uHeightTexel.value.set(1 / data.heights.width, 1 / data.heights.height);
      u.uBorderRangeKm.value = data.borders.header.range_px * data.borders.header.km_per_px;
      u.uBorderTexelKm.value = data.borders.header.km_per_px;
      if (data.edge) u.uEdgeRangeKm.value = data.edge.header.range_px * data.edge.header.km_per_px;
    };
    apply(uniforms);
    siblings.forEach((m) => apply(m.uniforms));
    textures.forEach((t) => t.dispose());
    textures = Object.values(next);
  }
  setTier(tierData);

  return {
    mesh, material, uniforms, setTier, siblingMaterial, grid: { cols, rows: grid },
    dispose() {
      textures.forEach((t) => t.dispose());
      uniforms.uGrain.value.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
