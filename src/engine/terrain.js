// @ts-check
// The terrain: one grid mesh displaced by the heightmap in the vertex shader, shaded by
// the clay / paper fragment shader. Layer-agnostic: it knows textures, not layers.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Group, Mesh, MeshBasicMaterial,
  ShaderMaterial, Sphere, Vector2, Vector3,
} from 'three';
import frag from './shaders/terrain.frag.glsl?raw';
import vert from './shaders/terrain.vert.glsl?raw';
import { byteTexture, grainTexture, heightTexture } from './textures.js';

/** Vertical curve y_km = exag * (h / hRef)^gamma * hRef / 1000. Keep in step with pipeline/02_dem.py. */
export const CURVE = { gamma: 0.65, hRef: 8000 };

/** Warm, desaturated clay palette (sRGB hex; three.js converts to linear for the shader). */
export const PALETTE = {
  table: '#efe9dc',
  ocean: '#bccbd0',
  board: { lit: '#e4dccb', shade: '#cdc4b1' },
  bands: ['#a6b98a', '#bec394', '#d1c08f', '#caa77e', '#ad8f76', '#a59b93', '#efece7'],
  tops: [80, 250, 600, 1200, 2500, 5400, 9000],
};

/** A (cols x rows)-quad grid with only a uv attribute; positions come from the heightmap. */
export function gridGeometry(cols, rows) {
  const nx = cols + 1, nz = rows + 1;
  const uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 2;
      uv[k] = i / cols;
      uv[k + 1] = j / rows;
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
    uShade: { value: null },
    uIds: { value: null },
    uBorders: { value: null },
    uBorderRangeKm: { value: 1 },
    uGrain: { value: grainTexture() },
    uSizeKm: { value: new Vector2(sizeKm.w, sizeKm.h) },
    uExag: { value: 12 },
    uGamma: { value: CURVE.gamma },
    uHRef: { value: CURVE.hRef },
    uKmPerPx: { value: 4 },
    uSelected: { value: -1 },
    uHover: { value: -1 },
    uTable: { value: new Color(PALETTE.table) },
    uOcean: { value: new Color(PALETTE.ocean) },
    uBands: { value: PALETTE.bands.map((c) => new Color(c)) },
    uBandTops: { value: Float32Array.from(PALETTE.tops) },
  };
  const material = new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms, side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  // The board: a slab whose sides show below the model's edge. Faces in the order
  // three.js builds a box: +x east, -x west, +y top, -y bottom, +z south, -z north.
  // The light comes from the north-west, so the south and east sides sit in shade.
  const BOARD_KM = 50;
  const lit = new MeshBasicMaterial({ color: PALETTE.board.lit });
  const shade = new MeshBasicMaterial({ color: PALETTE.board.shade });
  const board = new Mesh(new BoxGeometry(sizeKm.w, BOARD_KM, sizeKm.h), [shade, lit, lit, lit, shade, lit]);
  board.position.y = -BOARD_KM / 2 - 0.5;
  board.frustumCulled = false;
  const group = new Group();
  group.add(board, mesh);

  let textures = [];
  /** Swap in another tier's rasters (e.g. 2048 after the 1024 first view). */
  function setTier(data) {
    const next = {
      uHeight: heightTexture(data.heights),
      uShade: byteTexture(data.shade),
      uIds: byteTexture(data.ids, { nearest: true }),
      uBorders: byteTexture(data.borders),
    };
    for (const [k, tex] of Object.entries(next)) uniforms[k].value = tex;
    uniforms.uHeightTexel.value.set(1 / data.heights.width, 1 / data.heights.height);
    uniforms.uBorderRangeKm.value = data.borders.header.range_px * data.borders.header.km_per_px;
    textures.forEach((t) => t.dispose());
    textures = Object.values(next);
  }
  setTier(tierData);

  return {
    mesh: group, material, uniforms, setTier, grid: { cols, rows: grid },
    dispose() {
      textures.forEach((t) => t.dispose());
      uniforms.uGrain.value.dispose();
      geometry.dispose();
      material.dispose();
      board.geometry.dispose();
      lit.dispose();
      shade.dispose();
    },
  };
}
