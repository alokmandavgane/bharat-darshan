// @ts-check
// The backdrop (PLAN.md section 6): a wide, coarse sheet of the land around India, so
// that switching Surroundings on puts the model in a landscape instead of ending it a
// few hundred km out. It is the terrain's own material and shaders with its own rasters
// bound, so the clay look cannot drift between the two; what it has that the plate does
// not is uInnerKm, which fades it in exactly where the plate fades out.
import { Mesh, Vector2, Vector4 } from 'three';
import { gridGeometry } from './terrain.js';
import { byteTexture, heightTexture, zeroTexture } from './textures.js';

/**
 * @param {{ data: any, terrain: any, innerKm: { w: number, h: number }, grid: number }} opts
 *   data: the world pack pair; innerKm: the plate's size, the rect this hands over to
 */
export function createWorld({ data, terrain, innerKm, grid }) {
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
  // A few km under the plate's own sheet. Both are flat at sea level over the ocean, and
  // without this they fight for the depth buffer and the water comes out in stripes.
  u.uLift = { value: -4 };
  u.uInnerKm = { value: new Vector2(innerKm.w / 2, innerKm.h / 2) };

  const cols = Math.max(16, Math.round((grid * sizeKm.w) / sizeKm.h));
  const geometry = gridGeometry(cols, grid);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;                 // under the plate, which is drawn over its middle

  return {
    mesh,
    /** Keep the relief curve in step with the plate's, so the two read as one model. */
    setCurve({ exag, gamma, hRef }) {
      u.uExag.value = exag;
      u.uGamma.value = gamma;
      u.uHRef.value = hRef;
    },
    setKmPerPx(km) { u.uKmPerPx.value = km; },
    dispose() {
      geometry.dispose();
      material.dispose();
      owned.forEach((t) => t.dispose());
    },
  };
}
