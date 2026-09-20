"""Rasterising polygons and small morphological helpers, with pillow + numpy only."""
import numpy as np
from PIL import Image, ImageDraw


def rasterise(shapes, width, height):
    """shapes: iterable of (value, [(ring_px, is_hole), ...]) drawn in order into an int32 raster.

    ring_px are (n, 2) arrays of continuous pixel coordinates where pixel (i, j) covers
    [i, i+1) x [j, j+1); pillow addresses pixel centres, hence the half-pixel shift.
    Holes are drawn with 0 right after their feature, so callers should draw large
    features first and small ones (enclaves) later.
    """
    img = Image.new('I', (width, height), 0)
    draw = ImageDraw.Draw(img)
    for value, rings in shapes:
        for ring, is_hole in rings:
            if is_hole:
                continue
            pts = [(float(x) - 0.5, float(y) - 0.5) for x, y in ring]
            draw.polygon(pts, fill=int(value))
        for ring, is_hole in rings:
            if not is_hole:
                continue
            pts = [(float(x) - 0.5, float(y) - 0.5) for x, y in ring]
            draw.polygon(pts, fill=0)
    return np.array(img, dtype=np.int32)


def fill_nearest(ids, mask, max_iter=256):
    """Give every 0 pixel inside mask the id of its nearest labelled pixel.

    A wavefront spreads labels outwards over the whole raster (8-connected), so a
    gap that is not touching any label (an island missing from the label set) is
    still reached; only pixels inside mask receive the result.
    """
    spread = ids.copy()
    out = ids.copy()
    h, w = ids.shape
    for _ in range(max_iter):
        want = mask & (out == 0)
        if not want.any():
            break
        cand = np.zeros_like(ids)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            shifted = np.zeros_like(ids)
            src = spread[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
            shifted[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)] = src
            take = (spread == 0) & (cand == 0) & (shifted != 0)
            cand[take] = shifted[take]
        if not cand.any():
            break
        spread[cand != 0] = cand[cand != 0]
        got = want & (spread != 0)
        out[got] = spread[got]
    return out


def edges(ids, land=None):
    """Boolean maps of pixels on a boundary: (between two labelled regions, between labelled and 0).

    With `land`, the second map only counts land/land pairs, so it is the international
    land boundary rather than the coastline.
    """
    h, w = ids.shape
    internal = np.zeros((h, w), bool)
    external = np.zeros((h, w), bool)
    for a, b in (((slice(0, h), slice(0, w - 1)), (slice(0, h), slice(1, w))),
                 ((slice(0, h - 1), slice(0, w)), (slice(1, h), slice(0, w)))):
        ia, ib = ids[a], ids[b]
        diff = ia != ib
        both = diff & (ia != 0) & (ib != 0)
        one = diff & ((ia == 0) | (ib == 0))
        if land is not None:
            one &= land[a] & land[b]
        internal[a] |= both
        internal[b] |= both
        external[a] |= one
        external[b] |= one
    return internal, external


def bounded_distance(mask, radius):
    """Euclidean distance (pixels) from each pixel to the nearest True pixel, capped at radius.

    Exact within the cap: tests every integer offset inside the disc. O(radius^2) numpy
    passes, which is fine for radius <= ~12 on rasters of a few megapixels.
    """
    h, w = mask.shape
    dist = np.full((h, w), float(radius), np.float32)
    pad = np.zeros((h + 2 * radius, w + 2 * radius), bool)
    pad[radius:radius + h, radius:radius + w] = mask
    offsets = [(dy, dx, np.hypot(dy, dx)) for dy in range(-radius, radius + 1)
               for dx in range(-radius, radius + 1) if dy * dy + dx * dx <= radius * radius]
    offsets.sort(key=lambda o: o[2])
    for dy, dx, d in offsets:
        if d >= radius:
            break
        hit = pad[radius + dy:radius + dy + h, radius + dx:radius + dx + w]
        np.minimum(dist, np.where(hit, np.float32(d), dist), out=dist)
    return dist


def erode(mask):
    """4-connected erosion of a boolean mask."""
    out = mask.copy()
    out[1:, :] &= mask[:-1, :]
    out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]
    out[:, :-1] &= mask[:, 1:]
    return out


def pole_of_inaccessibility(mask):
    """Row, col of a pixel deepest inside mask (last survivor of repeated erosion)."""
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = mask[y0:y1, x0:x1]
    last = sub
    while True:
        nxt = erode(last)
        if not nxt.any():
            break
        last = nxt
    ys, xs = np.nonzero(last)
    return int(ys.mean()) + y0, int(xs.mean()) + x0
