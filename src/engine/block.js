// @ts-check
// The state view's lifted block (PLAN.md section 6): a dense grid over the state's
// bounding box drawn with the terrain material restricted to that state, plus walls
// along its traced outline so it reads as a slab lifted out of the country.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, GLSL3, Group, Mesh, ShaderMaterial } from 'three';
import { gridGeometry } from './terrain.js';
import { byteTexture, heightTexture } from './textures.js';
import wallFrag from './shaders/wall.frag.glsl?raw';
import wallVert from './shaders/wall.vert.glsl?raw';

export const WALL_COLOUR = '#e7ddc9';
const BLOCK_SEGMENTS = 192;
export const COUNTRY_WALL_KM = 22;

/** Wall geometry along outline loops ([x, z] in scene km): a quad per segment, top flag in y. */
export function wallGeometry(loops) {
  const segs = loops.reduce((n, l) => n + l.length, 0);
  const pos = new Float32Array(segs * 4 * 3);
  const side = new Float32Array(segs * 4 * 2);
  const index = new Uint32Array(segs * 6);
  let v = 0, q = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const [ax, az] = loop[i], [bx, bz] = loop[(i + 1) % loop.length];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const nx = dz / len, nz = -dx / len;                 // outward, loops run clockwise on screen
      const base = v;
      for (const [x, z, t] of [[ax, az, 1], [ax, az, 0], [bx, bz, 1], [bx, bz, 0]]) {
        pos[v * 3] = x; pos[v * 3 + 1] = t; pos[v * 3 + 2] = z;
        side[v * 2] = nx; side[v * 2 + 1] = nz;
        v++;
      }
      index[q++] = base; index[q++] = base + 1; index[q++] = base + 2;
      index[q++] = base + 2; index[q++] = base + 1; index[q++] = base + 3;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('side', new BufferAttribute(side, 2));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/** A wall material sharing the terrain's height texture and vertical curve. */
export function wallMaterial(terrainUniforms, depthKm, liftUniform) {
  return new ShaderMaterial({
    glslVersion: GLSL3, vertexShader: wallVert, fragmentShader: wallFrag, side: DoubleSide,
    uniforms: {
      uHeight: terrainUniforms.uHeight, uSizeKm: terrainUniforms.uSizeKm, uExag: terrainUniforms.uExag,
      uGamma: terrainUniforms.uGamma, uHRef: terrainUniforms.uHRef, uLift: liftUniform || { value: 0 },
      uLocalRect: terrainUniforms.uLocalRect,
      // Shared, not copied, so the walls turn with the light the terrain is lit by (F4).
      uLightDir: terrainUniforms.uLightDir,
      uDepth: { value: depthKm }, uWall: { value: new Color(WALL_COLOUR) },
    },
  });
}

/** The whole country's sides: walls along the traced outline of India, standing on the page. */
export function createCountryWalls(loops, terrainUniforms) {
  const mesh = new Mesh(wallGeometry(loops), wallMaterial(terrainUniforms, COUNTRY_WALL_KM));
  mesh.frustumCulled = false;
  return mesh;
}

/** Lift and slab thickness in km for a unit, from its size. */
export function blockDimensions(unit) {
  const [x0, z0, x1, z1] = unit.bbox;
  const size = Math.max(x1 - x0, z1 - z0);
  const lift = Math.min(40, Math.max(6, size * 0.08));
  return { lift, depth: lift * 0.6 };
}

/**
 * @param {{ unit: any, material: any, sizeKm: { w: number, h: number }, idsTexture: any, idsTexel: [number, number] }} opts
 *   material: a sibling of the terrain material (own uniforms, shared textures)
 */
export function createBlock({ unit, material, sizeKm, idsTexture, idsTexel }) {
  const [x0, z0, x1, z1] = unit.bbox;
  // uv rectangle of the bbox, padded by two id texels so the discard edge is never clipped
  const pad = [idsTexel[0] * 2, idsTexel[1] * 2];
  const rect = [
    Math.max(0, x0 / sizeKm.w + 0.5 - pad[0]), Math.max(0, z0 / sizeKm.h + 0.5 - pad[1]),
    Math.min(1, x1 / sizeKm.w + 0.5 + pad[0]), Math.min(1, z1 / sizeKm.h + 0.5 + pad[1]),
  ];
  const wKm = (rect[2] - rect[0]) * sizeKm.w, hKm = (rect[3] - rect[1]) * sizeKm.h;
  const cols = Math.max(8, Math.round(BLOCK_SEGMENTS * Math.min(1, wKm / hKm)));
  const rows = Math.max(8, Math.round(BLOCK_SEGMENTS * Math.min(1, hKm / wKm)));
  const geometry = gridGeometry(cols, rows, rect);
  material.uniforms.uRegion.value = unit.id;
  material.uniforms.uSelected.value = -1;
  material.uniforms.uHover.value = -1;
  material.uniforms.uDim.value = 0;
  material.uniforms.uHole.value = -1;
  if (idsTexture) material.uniforms.uIds.value = idsTexture;
  const top = new Mesh(geometry, material);
  top.frustumCulled = false;

  const wallMat = wallMaterial(material.uniforms, blockDimensions(unit).depth, material.uniforms.uLift);
  const group = new Group();
  group.add(top);
  let wall = null;
  let local = [];              // textures owned by this block, from its state package

  /** Build the walls once the outline (loops of [x, z] in scene km) has arrived. */
  function setOutline(loops) {
    wall?.geometry.dispose();
    if (wall) group.remove(wall);
    wall = new Mesh(wallGeometry(loops), wallMat);
    wall.frustumCulled = false;
    group.add(wall);
  }

  /**
   * Swap in the unit's own hi-res rasters (PLAN.md D3). The mesh keeps its country-space
   * uv, so the geometry and the camera are untouched; only the sampling moves, through
   * uLocalRect. The walls share these uniforms and follow automatically. Returns what
   * the country plate needs to cut its socket on the same curve.
   */
  function setPackage(pkg, sizeKm) {
    const next = {
      uHeight: heightTexture(pkg.heights),
      uShade: byteTexture(pkg.shade),
      uIds: byteTexture(pkg.ids, { nearest: true }),
      uStateEdge: byteTexture(pkg.edge),
    };
    const u = material.uniforms;
    for (const [k, tex] of Object.entries(next)) u[k].value = tex;
    u.uHeightTexel.value.set(1 / pkg.heights.width, 1 / pkg.heights.height);
    const [x0, z0, x1, z1] = pkg.rect;
    const rect = [x0 / sizeKm.w + 0.5, z0 / sizeKm.h + 0.5, (x1 - x0) / sizeKm.w, (z1 - z0) / sizeKm.h];
    u.uLocalRect.value.set(...rect);
    u.uStateRect.value.set(...rect);
    u.uStateEdgeRangeKm.value = pkg.edge.header.range_px * pkg.edge.header.km_per_px;
    u.uHasStateEdge.value = 1;
    local.forEach((t) => t.dispose());
    local = Object.values(next);
    return { texture: next.uStateEdge, rect, rangeKm: u.uStateEdgeRangeKm.value };
  }

  return {
    group, material, unit,
    setOutline,
    setPackage,
    setLift(km) { material.uniforms.uLift.value = km; },
    dispose() {
      geometry.dispose();
      wall?.geometry.dispose();
      wallMat.dispose();
      material.dispose();
      local.forEach((t) => t.dispose());
      local = [];
    },
  };
}
