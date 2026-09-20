// @ts-check
// Decoder for the pipeline's raster container (pipeline/lib/pack.py):
//   gzip( 'BDR1' + uint32le headerLength + headerJson + residuals )
// Residuals undo a 'left' or 'plane' predictor with wrapping arithmetic, which typed
// arrays give us for free on assignment.

/**
 * @typedef {{ header: any, data: Uint8Array | Int16Array, width: number, height: number, channels: number }} Pack
 */

/** @returns {Promise<Pack>} */
export async function loadPack(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  // Some hosts serve .gz with Content-Encoding and hand us the raw bytes already.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  return decodePack(bytes);
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @param {Uint8Array} raw @returns {Pack} */
export function decodePack(raw) {
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'BDR1') throw new Error('not a pack file');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + n)));
  const { width, height, channels, dtype, predictor } = header;
  const count = width * height * channels;
  const body = raw.subarray(8 + n);
  let data;
  if (dtype === 'uint8') {
    data = body.slice(0, count);
  } else if (dtype === 'int16') {
    const aligned = new Uint8Array(count * 2);
    aligned.set(body.subarray(0, count * 2));
    data = new Int16Array(aligned.buffer); // little-endian on every platform we target
  } else {
    throw new Error(`pack dtype ${dtype}`);
  }
  undoPredictor(data, width, height, channels, predictor);
  return { header, data, width, height, channels };
}

function undoPredictor(d, w, h, c, predictor) {
  const stride = w * c;
  if (predictor === 'none') return;
  if (predictor === 'left') {
    for (let y = 0; y < h; y++) {
      const row = y * stride;
      for (let x = c; x < stride; x++) d[row + x] += d[row + x - c];
    }
    return;
  }
  if (predictor === 'plane') {
    for (let x = c; x < stride; x++) d[x] += d[x - c];                 // row 0: left only
    for (let y = 1; y < h; y++) {
      const row = y * stride, prev = row - stride;
      for (let x = 0; x < c; x++) d[row + x] += d[prev + x];           // column 0: up only
      for (let x = c; x < stride; x++) d[row + x] += d[row + x - c] + d[prev + x] - d[prev + x - c];
    }
    return;
  }
  throw new Error(`pack predictor ${predictor}`);
}
