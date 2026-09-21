// @ts-check
// The backdrop (PLAN.md section 6): a wide, coarse sheet of the land around India, so
// that switching Surroundings on puts the model in a landscape instead of ending it a
// few hundred km out. It is the terrain's own material and shaders with its own rasters
// bound, so the clay look cannot drift between the two; what it has that the plate does
// not is uPool, which rounds it off far out instead of ending it at its rect.
//
// It is a sheet behind the model, not part of it: the engine draws it into its own scene
// and clears the depth buffer afterwards, so the plate covers it wherever the plate is
// opaque and it shows only through the rim the plate fades out over.
import { Mesh, Vector2, Vector4 } from 'three';
import { gridGeometry } from './terrain.js';
import { byteTexture, heightTexture, zeroTexture } from './textures.js';

/**
 * @param {{ data: any, terrain: any, grid: number }} opts  data: the world pack pair
 */
export function createWorld({ data, terrain, grid }) {
  const sizeKm = {
    w: data.heights.header.width_km,
    h: data.heights.header.height_km,
  };
  const material = terrain.siblingMaterial({ independent: true });
  const owned = [heightTexture(data.heights), byteTexture(data.shade), zeroTexture()];
  const [height, shade, zero] = owned;
  const u = material.uniforms;
  // Its own rasters, and a black stand-in for every sampler a backdrop never reads: no
  // ids, no borders, no outline fields. A zero India field reads as "not India", which
  // is what paints the whole sheet in the quiet neighbour colours.
  u.uHeight = { value: height };
  u.uShade = { value: shade };
  u.uIds = { value: zero };
  u.uBorders = { value: zero };
  u.uIndiaEdge = { value: zero };
  u.uStateEdge = { value: zero };
  u.uHeightTexel = { value: new Vector2(1 / data.heights.width, 1 / data.heights.height) };
  u.uSizeKm = { value: new Vector2(sizeKm.w, sizeKm.h) };
  u.uLocalRect = { value: new Vector4(0, 0, 1, 1) };
  u.uStateRect = { value: new Vector4(0, 0, 1, 1) };
  u.uOnlyIndia = { value: 0 };
  u.uHasStateEdge = { value: 0 };
  u.uHole = { value: -1 };
  u.uSelected = { value: -1 };
  u.uHover = { value: -1 };
  u.uRegion = { value: -1 };
  u.uDim = { value: 0 };
  // Level with the plate, not sunk under it: the depth clear between the two passes is
  // what keeps them from fighting over the flat ocean, so the sheets can meet at the same
  // sea level instead of stepping down by a few km where they hand over.
  u.uLift = { value: 0 };
  u.uPool = { value: 1 };

  const cols = Math.max(16, Math.round((grid * sizeKm.w) / sizeKm.h));
  const geometry = gridGeometry(cols, grid);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    /** Keep the relief curve in step with the plate's, so the two read as one model. */
    setCurve({ exag, gamma, hRef }) {
      u.uExag.value = exag;
      u.uGamma.value = gamma;
      u.uHRef.value = hRef;
    },
    setKmPerPx(km) { u.uKmPerPx.value = km; },
    // The backdrop binds its own rasters, so it is not one of the terrain's siblings and
    // broadcasts do not reach it: it has to be told the light's direction like the scale.
    setLightDir(x, z) { u.uLightDir.value.set(x, z); },
    dispose() {
      geometry.dispose();
      material.dispose();
      owned.forEach((t) => t.dispose());
    },
  };
}
