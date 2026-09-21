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
export const CATEGORICAL = 'categorical';
// The layer types that tint the clay. They are one channel -- see asChoropleth -- so only
// one of them is ever on, and both the shell's switches and the engine go by this list.
export const FILL_TYPES = ['choropleth', 'areas'];

/**
 * An `areas` layer read as a choropleth (PLAN.md section 5). The two are the same
 * drawing -- a fill chosen per pixel by an id -- and differ only in where the id comes
 * from: a choropleth's is the state under the pixel, an area layer's is its own raster,
 * where an id is a coalfield or a plateau rather than a state. So an area layer is
 * handed to `choroplethLookup` as a categorical choropleth whose regions happen to be
 * its own areas, and the terrain is told to read ids from the layer's raster instead.
 *
 * That is also why only one of them shows at a time: they are one channel.
 */
export function asChoropleth(file) {
  return {
    ...file,
    scale: CATEGORICAL,
    values: Object.fromEntries((file.items || []).map((i) => [i.area_id, i.category])),
  };
}

/** The band a value falls in: the last one whose `from` it has reached. */
export function bandOf(scale, value) {
  let at = 0;
  for (let i = 0; i < scale.length; i++) if (value >= scale[i].from) at = i;
  return at;
}

/**
 * A layer file -> what the terrain needs to colour by it.
 *
 * Two kinds, one mechanism. A numeric scale sorts a value into the band it falls in; a
 * categorical one ("scale": "categorical") takes the region's category and looks up
 * which colour that is. Either way what reaches the shader is an index into the same
 * eight colours, so the terrain reads one texel and knows neither kind apart.
 *
 * @param {{ scale: any, categories?: any[], values: Record<string, number | string> }} layer
 * @returns {{ texture: any, colors: Color[], count: number, dispose: () => void }}
 */
export function choroplethLookup(layer) {
  const categorical = layer.scale === CATEGORICAL;
  const bands = (categorical ? layer.categories || [] : layer.scale || []).slice(0, MAX_BANDS);
  const index = categorical ? new Map(bands.map((c, i) => [c.id, i])) : null;
  // r: band index, g: 255 when this region has a value at all. Region 0 is "not a state",
  // so it stays 0 and the sea, the neighbours and the backdrop are left alone.
  const data = new Uint8Array(256 * 2);
  for (const [id, value] of Object.entries(layer.values || {})) {
    const i = Number(id);
    if (!Number.isInteger(i) || i < 1 || i > 255) continue;
    let band;
    if (categorical) {
      band = index.get(value);
      if (band === undefined) continue;          // a category the layer no longer declares
    } else {
      if (!Number.isFinite(value)) continue;
      band = bandOf(bands, value);
    }
    data[i * 2] = band;
    data[i * 2 + 1] = 255;
  }
  const texture = new DataTexture(data, 256, 1, RGFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const colors = bands.map((b) => new Color(b.color));
  while (colors.length < MAX_BANDS) colors.push(new Color('#000000'));
  return { texture, colors, count: bands.length, dispose: () => texture.dispose() };
}
