// @ts-check
// The `choropleth` layer type (PLAN.md section 5): one value per region, coloured by the
// layer's own scale. The whole layer reaches the shader as a 256-texel lookup indexed by
// raster id, so the terrain needs one texture read and knows nothing about the layer.
//
// The lookup stores a band *index*, not a colour: the band colours travel as ordinary
// Color uniforms, which three.js converts from sRGB to linear for us, and an 8-bit
// texture of linear colour would have thrown away the darks.
import { Color, DataTexture, NearestFilter, RGFormat, UnsignedByteType } from 'three';

export const MAX_BANDS = 8;          // the shader declares this many; the scale may use fewer

/** The band a value falls in: the last one whose `from` it has reached. */
export function bandOf(scale, value) {
  let at = 0;
  for (let i = 0; i < scale.length; i++) if (value >= scale[i].from) at = i;
  return at;
}

/**
 * A layer file -> what the terrain needs to colour by it.
 * @param {{ scale: any[], values: Record<string, number> }} layer
 * @returns {{ texture: any, colors: Color[], count: number, dispose: () => void }}
 */
export function choroplethLookup(layer) {
  const scale = (layer.scale || []).slice(0, MAX_BANDS);
  // r: band index, g: 255 when this region has a value at all. Region 0 is "not a state",
  // so it stays 0 and the sea, the neighbours and the backdrop are left alone.
  const data = new Uint8Array(256 * 2);
  for (const [id, value] of Object.entries(layer.values || {})) {
    const i = Number(id);
    if (!Number.isInteger(i) || i < 1 || i > 255 || !Number.isFinite(value)) continue;
    data[i * 2] = bandOf(scale, value);
    data[i * 2 + 1] = 255;
  }
  const texture = new DataTexture(data, 256, 1, RGFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const colors = scale.map((b) => new Color(b.color));
  while (colors.length < MAX_BANDS) colors.push(new Color('#000000'));
  return { texture, colors, count: scale.length, dispose: () => texture.dispose() };
}
