// @ts-check
// The raster container (pipeline/lib/pack.py). A planar pack stores one channel after
// another; the decoder must hand back exactly what the interleaved pack of the same
// samples gives, for every predictor and both sample types. A heights pack may be stored
// in steps along the rendered curve, and metresTable must turn it back into metres.
// Run `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePack, metresTable } from '../src/engine/pack.js';

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

test('heights decode to metres, on the curve or not', () => {
  const plain = metresTable({});
  for (const v of [-32768, -500, -25, 0, 1, 2048, 32767]) assert.equal(plain[v & 0xffff], v);
  // pipeline/02_dem.py HEIGHT_CURVE: one step looks like 1 m does at 30 m
  const curve = { gamma: 0.65, h_ref: 8000, step: 0.65 * (30 / 8000) ** 0.65 / 30 };
  const t = metresTable({ curve });
  assert.equal(metresTable({ curve: { ...curve } }), t, 'one table per curve');
  for (const v of [-11000, -500, -25, 0]) assert.equal(t[v & 0xffff], v, 'the sea and fill stay metres');
  const code = (h) => Math.round((h / 8000) ** 0.65 / curve.step);
  for (const [h, tol] of [[5, 0.3], [30, 0.5], [300, 1.2], [3000, 2.6], [8848, 4]]) {
    assert.ok(Math.abs(t[code(h)] - h) <= tol, `${h} m comes back as ${t[code(h)]}`);
  }
  for (let q = 1; q < 2000; q++) assert.ok(t[q] > t[q - 1], 'codes rise with height');
});
