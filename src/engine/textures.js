// @ts-check
// Turns decoded packs into GPU textures. All data textures: no colour management,
// no mipmaps, row 0 = north (flipY false), clamp to edge.
import {
  ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, NearestFilter,
  RedFormat, RepeatWrapping, RGFormat, RGBAFormat, UnsignedByteType,
} from 'three';

function finish(tex, filter) {
  tex.magFilter = filter;
  tex.minFilter = filter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.flipY = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** int16 metres -> R16F. Half floats are exact to 2048 m and within 4 m at 8 km, fine for relief. */
export function heightTexture(pack) {
  const n = pack.width * pack.height;
  const half = new Uint16Array(n);
  const src = pack.data;
  for (let i = 0; i < n; i++) half[i] = DataUtils.toHalfFloat(src[i]);
  return finish(new DataTexture(half, pack.width, pack.height, RedFormat, HalfFloatType), LinearFilter);
}

/** uint8 packs with 1, 2 or 4 channels. `nearest` for id maps that must not be interpolated. */
export function byteTexture(pack, { nearest = false } = {}) {
  const format = pack.channels === 1 ? RedFormat : pack.channels === 2 ? RGFormat : RGBAFormat;
  if (pack.channels === 3) throw new Error('3-channel packs are not uploadable; use 2 or 4');
  const tex = new DataTexture(pack.data, pack.width, pack.height, format, UnsignedByteType);
  return finish(tex, nearest ? NearestFilter : LinearFilter);
}

/** A small tiling value-noise texture for the paper grain. */
export function grainTexture(size = 128, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const coarse = 16, c = new Float32Array(coarse * coarse);
  for (let i = 0; i < c.length; i++) c[i] = rnd();
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // bilinear value noise (tiles) plus fine white noise
      const fx = (x / size) * coarse, fy = (y / size) * coarse;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const x1 = (x0 + 1) % coarse, y1 = (y0 + 1) % coarse;
      const v = (c[y0 * coarse + x0] * (1 - tx) + c[y0 * coarse + x1] * tx) * (1 - ty)
        + (c[y1 * coarse + x0] * (1 - tx) + c[y1 * coarse + x1] * tx) * ty;
      data[y * size + x] = Math.round(255 * (0.5 * v + 0.5 * rnd()));
    }
  }
  const tex = finish(new DataTexture(data, size, size, RedFormat, UnsignedByteType), LinearFilter);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  return tex;
}
