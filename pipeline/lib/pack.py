"""The "pack" raster container the runtime decodes with DecompressionStream.

    gzip( b'BDR1' + uint32le header_len + header_json + payload )

header: {"width", "height", "channels", "dtype": "uint8"|"int16", "predictor":
"none"|"left"|"plane", ...anything else the step wants to record}. The payload is the
prediction residual of the row-major, channel-interleaved samples, little-endian,
computed with wrapping arithmetic in the sample type. Predictors:
  left:  pred = sample to the left (0 at column 0)
  plane: pred = left + up - upleft (0 outside the raster)
"plane" behaves like PNG's filters and shrinks smooth data (heights) markedly;
"left" is enough for label-like data (ids). The decoder is src/engine/pack.js.
"""
import gzip
import json
import os

import numpy as np

MAGIC = b'BDR1'
DTYPES = {'uint8': np.uint8, 'int16': np.int16}


def _predict(a, predictor):
    """a: (h, w, c) array in its final dtype. Returns residuals in the same dtype (wrapping)."""
    if predictor == 'none':
        return a
    wide = a.astype(np.int64)
    left = np.zeros_like(wide)
    left[:, 1:] = wide[:, :-1]
    if predictor == 'left':
        pred = left
    elif predictor == 'plane':
        up = np.zeros_like(wide)
        up[1:, :] = wide[:-1, :]
        upleft = np.zeros_like(wide)
        upleft[1:, 1:] = wide[:-1, :-1]
        pred = left + up - upleft
    else:
        raise ValueError(predictor)
    res = wide - pred
    info = np.iinfo(a.dtype)
    span = int(info.max) - int(info.max - 1) + (int(info.max) - int(info.min))  # == 2^bits
    res = ((res - info.min) % span) + info.min
    return res.astype(a.dtype)


def write(path, array, dtype, predictor='plane', **meta):
    """array: (h, w) or (h, w, c). Writes the gzip pack; returns the byte size on disk."""
    a = np.asarray(array)
    if a.ndim == 2:
        a = a[:, :, None]
    a = a.astype(DTYPES[dtype])
    h, w, c = a.shape
    header = {'width': int(w), 'height': int(h), 'channels': int(c), 'dtype': dtype,
              'predictor': predictor, **meta}
    hj = json.dumps(header, separators=(',', ':')).encode('utf-8')
    body = _predict(a, predictor).astype('<' + a.dtype.str[1:]).tobytes()
    raw = MAGIC + len(hj).to_bytes(4, 'little') + hj + body
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # mtime=0 and no filename: identical input gives identical bytes, so re-running the
    # pipeline never dirties git for nothing.
    with open(path, 'wb') as fh, gzip.GzipFile(filename='', mode='wb', fileobj=fh, compresslevel=9, mtime=0) as f:
        f.write(raw)
    return os.path.getsize(path)


def read(path):
    """Inverse of write, for checks and for later pipeline steps. Returns (header, array (h,w,c))."""
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    assert raw[:4] == MAGIC, path
    n = int.from_bytes(raw[4:8], 'little')
    header = json.loads(raw[8:8 + n].decode('utf-8'))
    dt = np.dtype('<' + np.dtype(DTYPES[header['dtype']]).str[1:])
    h, w, c = header['height'], header['width'], header['channels']
    res = np.frombuffer(raw[8 + n:], dtype=dt).reshape(h, w, c).astype(np.int64)
    pred = header['predictor']
    info = np.iinfo(DTYPES[header['dtype']])
    span = int(info.max) - int(info.min) + 1
    if pred == 'none':
        out = res
    elif pred == 'left':
        out = np.cumsum(res, axis=1)
    elif pred == 'plane':
        # Undo left+up-upleft: cumulative sum along rows, then along columns.
        out = np.cumsum(np.cumsum(res, axis=1), axis=0)
    else:
        raise ValueError(pred)
    out = ((out - info.min) % span) + info.min
    return header, out.astype(DTYPES[header['dtype']])


if __name__ == '__main__':
    import tempfile
    rng = np.random.default_rng(1)
    for dtype, pred in (('int16', 'plane'), ('uint8', 'left'), ('int16', 'none'), ('uint8', 'plane')):
        a = rng.integers(np.iinfo(DTYPES[dtype]).min, np.iinfo(DTYPES[dtype]).max, size=(37, 53, 2), endpoint=True)
        p = os.path.join(tempfile.gettempdir(), 'pack-test.bin.gz')
        write(p, a, dtype, pred)
        hdr, b = read(p)
        assert np.array_equal(a.astype(DTYPES[dtype]), b), (dtype, pred)
    print('pack ok')
