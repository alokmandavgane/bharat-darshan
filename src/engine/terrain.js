// @ts-check
// The terrain: one grid mesh displaced by the heightmap in the vertex shader, shaded by
// the clay / paper fragment shader. Layer-agnostic: it knows textures, not layers.
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Mesh, ShaderMaterial, Sphere, Vector2, Vector3, Vector4,
} from 'three';
import { lightDirection } from './camera-math.js';
import frag from './shaders/terrain.frag.glsl?raw';
import vert from './shaders/terrain.vert.glsl?raw';
import { byteTexture, grainTexture, heightTexture, zeroTexture } from './textures.js';

/** Vertical curve y_km = exag * (h / hRef)^gamma * hRef / 1000. Keep in step with pipeline/02_dem.py. */
export const CURVE = { gamma: 0.65, hRef: 8000 };

/**
 * The shadow the model casts on the paper (PLAN.md section 3, "The missing wow" 1).
 * `offsetKm` is how far it is thrown: the light sits at about 44 degrees, so it is
 * roughly the model's height, and the model is as tall as its relief -- up to 96 km at
 * the default exaggeration -- rather than as tall as its 22 km walls. A shadow sized to
 * the walls alone came out about 5 px at the home view and read as an outline round the
 * coast rather than as a shadow under a thing. `softKm` is the penumbra, `strength` how
 * dark the paper goes. All four are knobs: turn them here and look.
 */
export const SHADOW = { offsetKm: 85, softKm: 34, strength: 0.42, tint: '#9c8a70' };

/** Warm, desaturated clay palette (sRGB hex; three.js converts to linear for the shader). */
export const PALETTE = {
  table: '#efe6d6',
  ocean: '#bccbd0',
  bands: ['#a6b98a', '#bec394', '#d1c08f', '#caa77e', '#ad8f76', '#a59b93', '#efece7'],
  tops: [80, 250, 600, 1200, 2500, 5400, 9000],
  // The `plain` base style (PLAN.md section 5, "Base styles"): one warm clay for a
  // thematic page, whose own colours would otherwise fight the hypsometric bands. The
  // relief is still all there -- the light and the baked occlusion carry it alone, which
  // is what a clay model looks like before anyone paints heights onto it.
  clay: '#e8cb9c',
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
    // The lifted unit's own signed edge, from its package: the block antialiases its rim
    // with it and the plate cuts the socket with it, so both land on the walls' curve.
    uStateEdge: { value: null },
    uStateRect: { value: new Vector4(0, 0, 1, 1) },
    uStateEdgeRangeKm: { value: 1 },
    uHasStateEdge: { value: 0 },
    uBorderRangeKm: { value: 1 },
    uBorderTexelKm: { value: 1 },
    uGrain: { value: grainTexture() },
    uSizeKm: { value: new Vector2(sizeKm.w, sizeKm.h) },
    uExag: { value: 12 },
    uGamma: { value: CURVE.gamma },
    uHRef: { value: CURVE.hRef },
    uKmPerPx: { value: 4 },
    // The key light's ground direction. It belongs to the viewer's room rather than to
    // the model, so setLightYaw turns it with the camera and the lit side of a hill
    // stays the side nearest the top-left of the screen however far the model is turned.
    uLightDir: { value: new Vector2(-1, -1) },      // north-west at yaw 0; see setLightYaw
    uShadow: { value: new Vector3(SHADOW.offsetKm, SHADOW.softKm, SHADOW.strength) },
    uShadowTint: { value: new Color(SHADOW.tint) },
    // How far the state view's block stands above the plate, so the plate can draw the
    // shadow it throws. Not uLift, which the vertex shader raises geometry by: the
    // plate's own must stay 0 or the plate would rise with the block.
    uBlockLift: { value: 0 },
    uSelected: { value: -1 },
    uHover: { value: -1 },
    uRegion: { value: -1 },
    uHole: { value: -1 },
    uDim: { value: 0 },
    uLift: { value: 0 },
    uOnlyIndia: { value: 1 },
    // 1 only on the backdrop, which ends as a round pool instead of at its rect.
    uPool: { value: 0 },
    // The choropleth layer on show, if any: a lookup by region id and its band colours.
    // A `prisms` layer: per-region height, read in the vertex shader.
    uPrismLut: { value: zeroTexture() },
    uPrismKm: { value: 0 },
    uChoroLut: { value: zeroTexture() },
    // An `areas` layer's own id raster, when one is the fill on show; otherwise the
    // fill is indexed by the state ids the terrain already has.
    uChoroIds: { value: zeroTexture() },
    uChoroOwnIds: { value: 0 },
    uChoroColors: { value: Array.from({ length: 8 }, () => new Color('#000000')) },
    uChoroMix: { value: 0 },
    uTable: { value: new Color(PALETTE.table) },
    uClay: { value: new Color(PALETTE.clay) },
    uPlain: { value: 0 },          // 0 hypsometric bands, 1 flat clay; tweened between

    uOcean: { value: new Color(PALETTE.ocean) },
    uBands: { value: PALETTE.bands.map((c) => new Color(c)) },
    uBandTops: { value: Float32Array.from(PALETTE.tops) },
  };
  // Premultiplied and blended, so a sheet composites over whatever is behind it rather
  // than overwriting it. On its own that changes nothing -- the canvas is premultiplied
  // over a transparent clear -- but it is what lets the backdrop show through the rim the
  // plate fades out over, instead of the page showing through both. Every sibling gets it
  // too: an opaque block would punch its own soft rim, alpha and all, through the plate
  // underneath it.
  const BLEND = { transparent: true, premultipliedAlpha: true, depthWrite: true };
  const material = new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms, side: DoubleSide, ...BLEND,
  });

  /**
   * A second material with the same shaders and textures but its own scalar uniforms,
   * for the lifted block. Textures are shared by reference, never re-uploaded.
   * `independent` keeps it out of the tier swap, for a mesh that brings its own rasters.
   */
  function siblingMaterial({ independent = false } = {}) {
    const u = {};
    for (const [k, { value }] of Object.entries(uniforms)) {
      u[k] = { value: value && typeof value === 'object' && !value.isTexture && typeof value.clone === 'function' ? value.clone()
        : value instanceof Float32Array ? Float32Array.from(value)
        : Array.isArray(value) ? value.map((c) => c.clone()) : value };
    }
    const m = new ShaderMaterial({
      glslVersion: GLSL3, vertexShader: vert, fragmentShader: frag, uniforms: u, side: DoubleSide, ...BLEND,
    });
    if (independent) return m;        // the backdrop binds its own rasters; a tier swap must not reach it
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

  /** Apply to the plate and to every sibling that shares its rasters (the lifted block). */
  const blank = uniforms.uChoroLut.value;   // read as "no region has a value"
  function broadcast(fn) {
    fn(uniforms);
    siblings.forEach((m) => fn(m.uniforms));
  }

  return {
    mesh, material, uniforms, setTier, siblingMaterial, grid: { cols, rows: grid },
    /**
     * Turn the key light with the camera, so it keeps its place over the viewer's left
     * shoulder however far the model is turned (PLAN.md F4). At yaw 0 this is the
     * north-west the look was designed around; the horizontal part always has length
     * sqrt(2), so the light's height above the ground never changes with the turn.
     */
    setLightYaw(yawDeg) {
      const [x, z] = lightDirection(yawDeg);
      broadcast((u) => u.uLightDir.value.set(x, z));
      return uniforms.uLightDir.value;
    },
    /** Bind a choropleth's lookup, or null to unbind it. */
    setChoropleth(look) {
      broadcast((u) => {
        u.uChoroLut.value = look ? look.texture : blank;
        if (look) look.colors.forEach((c, i) => u.uChoroColors.value[i].copy(c));
      });
    },
    /**
     * Where the fill's ids come from: an `areas` layer's own raster, or null for the
     * state ids the terrain already has bound. A country raster either way, so the
     * shader reads it in country uv and a lifted block reads the same one.
     */
    setChoroIds(texture) {
      broadcast((u) => {
        u.uChoroIds.value = texture || blank;
        u.uChoroOwnIds.value = texture ? 1 : 0;
      });
    },
    /**
     * A `prisms` layer, or null: the lookup of per-region heights and how far the top of
     * its range stands up, in km. Colour and height are separate channels, so a prisms
     * layer and a fill can be on together.
     */
    setPrisms(look, km) {
      broadcast((u) => {
        u.uPrismLut.value = look ? look.texture : blank;
        u.uPrismKm.value = look ? km : 0;
      });
    },
    /** How far it has faded in, 0..1. */
    setChoroMix(v) {
      broadcast((u) => { u.uChoroMix.value = v; });
    },
    /** The base style, 0 (hypsometric bands) to 1 (flat clay). Fractions are the crossfade. */
    setPlain(v) {
      broadcast((u) => { u.uPlain.value = v; });
    },
    dispose() {
      textures.forEach((t) => t.dispose());
      uniforms.uGrain.value.dispose();
      blank.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
