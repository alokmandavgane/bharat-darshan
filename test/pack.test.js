// @ts-check
// The raster container (pipeline/lib/pack.py). A planar pack stores one channel after
// another; the decoder must hand back exactly what the interleaved pack of the same
// samples gives, for every predictor and both sample types. Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePack } from '../src/engine/pack.js';

/** pack.py's write, without the gzip: residuals with wrapping arithmetic, then the bytes. */
function encode(samples, width, height, channels, dtype, predictor, planar) {
  const Typed = dtype === 'int16' ? Int16Array : Uint8Array;
  const at = (x, y, c) => (x < 0 || y < 0 ? 0 : samples[(y * width + x) * channels + c]);
  const res = new Typed(samples.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const pred = predictor === 'none' ? 0
          : predictor === 'left' ? at(x - 1, y, c)
            : at(x - 1, y, c) + at(x, y - 1, c) - at(x - 1, y - 1, c);
        const i = planar ? c * width * height + y * width + x : (y * width + x) * channels + c;
        res[i] = at(x, y, c) - pred;
      }
    }
  }
  const header = { width, height, channels, dtype, predictor, ...(planar ? { layout: 'planar' } : {}) };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + res.byteLength);
  out.set(new TextEncoder().encode('BDR1'));
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(new Uint8Array(res.buffer), 8 + json.length);
  return out;
}

test('a planar pack decodes to the same samples as an interleaved one', () => {
  const width = 7, height = 5, channels = 2;
  for (const dtype of ['uint8', 'int16']) {
    const Typed = dtype === 'int16' ? Int16Array : Uint8Array;
    const samples = new Typed(width * height * channels);
    let seed = 7;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      samples[i] = seed >>> 8;   // wraps into the type, extremes included
    }
    for (const predictor of ['none', 'left', 'plane']) {
      const flat = decodePack(encode(samples, width, height, channels, dtype, predictor, false));
      const planar = decodePack(encode(samples, width, height, channels, dtype, predictor, true));
      assert.deepEqual(Array.from(flat.data), Array.from(samples), `${dtype} ${predictor} interleaved`);
      assert.deepEqual(Array.from(planar.data), Array.from(samples), `${dtype} ${predictor} planar`);
      assert.equal(planar.data.constructor, Typed);
    }
  }
});
