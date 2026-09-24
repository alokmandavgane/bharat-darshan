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

    Exact within the cap, and separable: each row's distance to its nearest True pixel
    first (from running indices, two numpy passes), then the minimum over the 2r-1 rows
    in reach of dy^2 + that squared. That is O(radius) passes rather than one per offset
    in the disc: the bleed and coast bands in step 6 are radius 29 and 43, which made
    this most of the pipeline's run time. The squared distance goes back to a float32
    through a table of the same `np.float32(np.hypot(dy, dx))` values the per-offset
    loop wrote, so the output is the same bytes.
    """
    h, w = mask.shape
    r2 = radius * radius
    mask = np.asarray(mask, bool)
    # Along each row: how far to the nearest True pixel, as far as the cap matters.
    col = np.arange(w, dtype=np.int64)
    far = w + radius + 1
    left = np.where(mask, col, -far)
    np.maximum.accumulate(left, axis=1, out=left)
    right = np.where(mask, col, w + far)
    right = np.minimum.accumulate(right[:, ::-1], axis=1)[:, ::-1]
    g = np.minimum(col - left, right - col)
    g2 = np.where(g < radius, g * g, r2).astype(np.int64)
    # Down the columns: the nearest of those rows, with the rows between counted in.
    k = g2.copy()
    for dy in range(1, radius):
        dd = dy * dy
        np.minimum(k[dy:], g2[:-dy] + dd, out=k[dy:])
        np.minimum(k[:-dy], g2[dy:] + dd, out=k[:-dy])
    lut = np.full(r2 + 1, np.float32(radius), np.float32)
    for dy in range(radius):
        for dx in range(radius):
            q = dy * dy + dx * dx
            if q < r2:
                lut[q] = min(lut[q], np.float32(np.hypot(dy, dx)))
    return lut[np.minimum(k, r2)]


def distance_to_segments(segments, width, height, radius):
    """Euclidean distance in pixels to the nearest segment, capped at `radius`.

    segments: (n, 4) of (x0, y0, x1, y1) in continuous pixel coordinates, where pixel
    (col, row) covers [col, col+1) x [row, row+1) and so has its centre at +0.5.

    `bounded_distance` measures to a set of pixels, which is all a raster can offer and
    which makes any line traced from one a staircase. This measures to the line itself,
    so the level set the shader draws is the curve, not the pixels under it. Only the
    window within `radius` of each segment is touched: the cost follows the length of
    the lines, not the area of the raster.
    """
    out = np.full((height, width), float(radius), np.float32)
    r = float(radius)
    for x0, y0, x1, y1 in np.asarray(segments, dtype=np.float64):
        c0 = max(0, int(np.floor(min(x0, x1) - r - 0.5)))
        c1 = min(width - 1, int(np.ceil(max(x0, x1) + r - 0.5)))
        r0 = max(0, int(np.floor(min(y0, y1) - r - 0.5)))
        r1 = min(height - 1, int(np.ceil(max(y0, y1) + r - 0.5)))
        if c1 < c0 or r1 < r0:
            continue
        wx = np.arange(c0, c1 + 1, dtype=np.float64)[None, :] + 0.5 - x0
        wy = np.arange(r0, r1 + 1, dtype=np.float64)[:, None] + 0.5 - y0
        vx, vy = x1 - x0, y1 - y0
        L2 = vx * vx + vy * vy
        t = np.clip((wx * vx + wy * vy) / L2, 0.0, 1.0) if L2 > 0.0 else 0.0
        d = np.hypot(wx - t * vx, wy - t * vy)
        win = out[r0:r1 + 1, c0:c1 + 1]
        np.minimum(win, d, out=win)
    return out


def erode(mask):
    """4-connected erosion of a boolean mask.

    A pixel on the array's own edge keeps whichever neighbour falls outside it, so a
    shape that reaches the edge is never worn away there. Callers that erode to nothing
    have to leave a false margin around the shape; `pole_of_inaccessibility` does.
    """
    out = mask.copy()
    out[1:, :] &= mask[:-1, :]
    out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]
    out[:, :-1] &= mask[:, 1:]
    return out


def pole_of_inaccessibility(mask, max_side=None):
    """
    Row, col of a pixel deepest inside mask (last survivor of repeated erosion).

    Erosion costs one pass per pixel of the inscribed radius, so a country-sized shape
    costs six hundred passes over four million pixels. `max_side` answers on a shrunken
    copy first and then refines within it, which is exact enough for anything that wants
    a place to put a label and turns minutes into milliseconds.
    """
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    # A false margin around the shape, so erosion bites from every side. Without it a
    # shape that touches the edge of its own array is never worn away there, and one that
    # fills its bounding box is never worn away at all: erode returns it unchanged and
    # the loop below runs for ever.
    sub = np.zeros((y1 - y0 + 2, x1 - x0 + 2), bool)
    sub[1:-1, 1:-1] = mask[y0:y1, x0:x1]
    y0 -= 1
    x0 -= 1
    if max_side and max(sub.shape) > max_side:
        step = int(np.ceil(max(sub.shape) / max_side))
        coarse = sub[::step, ::step]
        deep = pole_of_inaccessibility(coarse)
        if deep is None:                       # too thin to survive the thinning
            return int(ys.mean()), int(xs.mean())
        cy, cx = deep[0] * step, deep[1] * step
        # Refine inside a window of one coarse cell either side, at full resolution.
        wy0, wx0 = max(0, cy - step * 2), max(0, cx - step * 2)
        window = sub[wy0:cy + step * 2 + 1, wx0:cx + step * 2 + 1]
        fine = pole_of_inaccessibility(window)
        if fine is None:
            return int(cy) + y0, int(cx) + x0
        return int(fine[0]) + wy0 + y0, int(fine[1]) + wx0 + x0
    last = sub
    while True:
        nxt = erode(last)
        if not nxt.any():
            break
        last = nxt
    ys, xs = np.nonzero(last)
    return int(ys.mean()) + y0, int(xs.mean()) + x0


def convex_hull(points):
    """Andrew's monotone chain on an (n, 2) array; returns the hull counter-clockwise (y down: visually clockwise)."""
    pts = np.unique(np.asarray(points, dtype=np.float64), axis=0)
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])
