// @ts-check
// The glyph set as one texture, for the decal on a peg's head (marks.js). Each glyph is
// rasterised once from its SVG into a cell of a canvas; the shader picks the cell by
// index. Built on the device from src/glyphs.js, so the set that names a category in
// layer.json is the set on the model.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter } from 'three';
import { GLYPHS } from '../glyphs.js';

const CELL = 96;       // px per glyph; the head is at most about 30 px across
const COLS = 4;

/** @type {Promise<{ texture: CanvasTexture, cols: number, index: Map<string, number> }> | null} */
let atlas = null;

function rasterise(body, ctx, x, y) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${CELL}" height="${CELL}" fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, x + CELL * 0.12, y + CELL * 0.12, CELL * 0.76, CELL * 0.76); URL.revokeObjectURL(url); resolve(undefined); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };   // a cell left blank beats a marker never drawn
    img.src = url;
  });
}

/** The atlas, built once and shared. */
export function loadGlyphAtlas() {
  if (atlas) return atlas;
  atlas = (async () => {
    const names = Object.keys(GLYPHS);
    const rows = Math.ceil(names.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = CELL * COLS;
    canvas.height = CELL * rows;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const index = new Map();
    await Promise.all(names.map((name, i) => {
      index.set(name, i);
      return rasterise(GLYPHS[name], ctx, (i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    }));
    const texture = new CanvasTexture(canvas);
    texture.flipY = false;                 // cells are laid out from the top, as drawn
    texture.minFilter = LinearMipmapLinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return { texture, cols: COLS, rows, index };
  })();
  return atlas;
}
