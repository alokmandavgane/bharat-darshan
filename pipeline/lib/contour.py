"""Outlines of labelled regions in an ID raster, as smooth simplified polygons (numpy + stdlib).

Pixel edges between a region and everything else are collected, linked into closed
loops walking clockwise on screen with the region on the right, the right-angle
staircase is low-pass filtered along its arc length, and the result is simplified with
Douglas-Peucker. Coordinates start on pixel corners (col, row) and end within about a
pixel of them, so a loop can be scaled to any tier's grid.

The state view draws these loops as the walls of a lifted block and fills them for its
top surface (pipeline/06_states.py), five times finer than the raster they came from,
so the smoothing has to remove the staircase rather than round its corners.
"""
import numpy as np


def _edges(mask):
    """Directed pixel edges (x0, y0, x1, y1) around True pixels, region on the right."""
    h, w = mask.shape
    pad = np.zeros((h + 2, w + 2), bool)
    pad[1:-1, 1:-1] = mask
    m = pad[1:-1, 1:-1]
    top = m & ~pad[:-2, 1:-1]       # nothing above: edge travels east along y = r
    bottom = m & ~pad[2:, 1:-1]     # nothing below: edge travels west along y = r + 1
    left = m & ~pad[1:-1, :-2]      # nothing to the left: edge travels north along x = c
    right = m & ~pad[1:-1, 2:]      # nothing to the right: edge travels south along x = c + 1
    out = []
    r, c = np.nonzero(top);    out.append(np.column_stack([c, r, c + 1, r]))
    r, c = np.nonzero(right);  out.append(np.column_stack([c + 1, r, c + 1, r + 1]))
    r, c = np.nonzero(bottom); out.append(np.column_stack([c + 1, r + 1, c, r + 1]))
    r, c = np.nonzero(left);   out.append(np.column_stack([c, r + 1, c, r]))
    return np.concatenate(out) if out else np.zeros((0, 4), np.int64)


def _link(edges):
    """Join directed edges end to start into closed loops; at a pinch, turn right."""
    by_start = {}
    for i, (x0, y0, x1, y1) in enumerate(edges.tolist()):
        by_start.setdefault((x0, y0), []).append(i)
    used = np.zeros(len(edges), bool)
    loops = []
    for start in range(len(edges)):
        if used[start]:
            continue
        loop = []
        i = start
        while not used[i]:
            used[i] = True
            x0, y0, x1, y1 = edges[i]
            loop.append((int(x0), int(y0)))
            cands = [j for j in by_start.get((int(x1), int(y1)), []) if not used[j]]
            if not cands:
                break
            if len(cands) == 1:
                i = cands[0]
            else:
                # incoming direction d; prefer the candidate that turns right (clockwise on screen)
                dx, dy = int(x1 - x0), int(y1 - y0)
                def turn(j):
                    ex, ey = int(edges[j][2] - edges[j][0]), int(edges[j][3] - edges[j][1])
                    return dx * ey - dy * ex          # > 0: right turn with y down
                i = max(cands, key=turn)
        if len(loop) >= 4:
            loops.append(np.array(loop, dtype=np.float64))
    return loops


def _collapse(loop):
    """Drop points on straight runs."""
    if len(loop) < 3:
        return loop
    p = np.roll(loop, 1, axis=0)
    n = np.roll(loop, -1, axis=0)
    d1 = loop - p
    d2 = n - loop
    keep = (d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) != 0
    return loop[keep]


def _dp(points, tol):
    """Iterative Douglas-Peucker on an open polyline."""
    n = len(points)
    if n < 3:
        return points
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        pa, pb = points[a], points[b]
        seg = pb - pa
        L = np.hypot(*seg)
        mid = points[a + 1:b]
        if L == 0:
            d = np.hypot(*(mid - pa).T)
        else:
            d = np.abs(seg[0] * (mid[:, 1] - pa[1]) - seg[1] * (mid[:, 0] - pa[0])) / L
        k = int(np.argmax(d))
        if d[k] > tol:
            idx = a + 1 + k
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return points[keep]


def simplify_line(points, tol):
    """Simplify an open polyline (a river, a road), keeping its two ends."""
    return _dp(np.asarray(points, float), tol) if len(points) > 2 else np.asarray(points, float)


def simplify(loop, tol):
    """Simplify a closed loop; the split point is the farthest from the first point."""
    loop = _collapse(loop)
    if len(loop) < 4:
        return loop
    far = int(np.argmax(np.hypot(*(loop - loop[0]).T)))
    a = _dp(loop[:far + 1], tol)
    b = _dp(np.concatenate([loop[far:], loop[:1]]), tol)
    out = np.concatenate([a[:-1], b[:-1]])
    return out if len(out) >= 3 else loop


def shoelace(loop):
    x, y = loop[:, 0], loop[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _resample(loop, step):
    """Re-space a closed loop's points evenly along its arc length, `step` pixels apart."""
    p = np.vstack([loop, loop[:1]])
    d = np.hypot(*np.diff(p, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(d)])
    if s[-1] <= 0:
        return np.asarray(loop, float)
    n = max(8, int(round(s[-1] / step)))
    t = np.linspace(0.0, s[-1], n, endpoint=False)
    return np.column_stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])])


SMOOTH_STEP = 0.5          # resampling pitch before the blur, in pixels


def _smooth(loop, sigma):
    """Gaussian blur along the arc length of a closed loop; `sigma` is in pixels.

    A loop straight off the tracer is a right-angle staircase whose risers are a whole
    pixel tall. Corner cutting (Chaikin) only rounds those corners: the one-pixel
    wiggle survives, which is what the state block shows once its own rasters are five
    times finer than the one the outline was traced from. Blurring the loop as two
    signals along its arc length removes the wiggle instead of rounding it -- on
    Chhattisgarh it takes the mean turn between segments from 13.2 degrees to 6.6 --
    while moving no point more than about three quarters of a pixel and changing the
    enclosed area by a fiftieth of a percent.

    Sigma is capped at half the loop's equivalent radius so that specks and small
    enclaves, whose whole outline is a few pixels across, are not blurred away.
    """
    pts = _resample(loop, SMOOTH_STEP)
    perimeter = len(pts) * SMOOTH_STEP
    sigma = min(sigma, 0.5 * perimeter / (2.0 * np.pi))
    r = int(round(3.0 * sigma / SMOOTH_STEP))
    if r < 1 or len(pts) <= 2 * r:
        return pts
    k = np.exp(-0.5 * (np.arange(-r, r + 1) * SMOOTH_STEP / sigma) ** 2)
    k /= k.sum()
    pad = np.vstack([pts[-r:], pts, pts[:r]])
    return np.column_stack([np.convolve(pad[:, i], k, 'valid') for i in (0, 1)])


def trace(mask, tol=0.2, min_area=3.0, sigma=1.2):
    """Smoothed outline loops of a boolean mask; tiny specks are dropped.

    `sigma` is the blur width in pixels (0 keeps the raw pixel staircase) and `tol` the
    Douglas-Peucker tolerance. Smoothing comes first so that simplification has a curve
    to follow, and the tolerance has to stay well under sigma or it puts the corners
    straight back: the old pairing of a one-pixel tolerance with corner cutting left
    Chhattisgarh with chords averaging 8.1 km, which the state view drew as flat facets.
    """
    loops = _link(_edges(mask))
    out = []
    for loop in loops:
        if abs(shoelace(loop)) < min_area:
            continue
        if sigma:
            loop = _smooth(loop, sigma)
        out.append(simplify(loop, tol))
    out.sort(key=lambda l: -abs(shoelace(l)))
    return out


if __name__ == '__main__':
    m = np.zeros((12, 12), bool)
    m[2:8, 3:9] = True
    m[5, 9] = True             # a bump
    m[9:11, 1:3] = True        # a second blob (4 px)
    m[4:6, 5:7] = False        # a hole
    loops = trace(m, tol=0.5, min_area=2, sigma=0)
    areas = sorted(round(abs(shoelace(l)), 1) for l in loops)
    assert areas == [4.0, 4.0, 37.0], areas       # outer (36 + bump), the hole as its own loop, the blob
    # outer loops run clockwise on screen (positive shoelace), holes the other way
    assert sorted(round(shoelace(l), 1) for l in loops) == [-4.0, 4.0, 37.0]

    smooth = trace(m, sigma=1.2, min_area=2)
    assert len(smooth) == 3, len(smooth)          # the 4 px blob and the hole survive the cap
    big = max(smooth, key=lambda l: abs(shoelace(l)))
    d = np.diff(np.vstack([big, big[:1]]), axis=0)
    e = np.roll(d, -1, axis=0)
    turn = np.degrees(np.abs(np.arctan2(d[:, 0] * e[:, 1] - d[:, 1] * e[:, 0],
                                        d[:, 0] * e[:, 0] + d[:, 1] * e[:, 1])))
    assert turn.max() < 60.0, turn.max()          # the staircase's right angles are gone
    print('contour ok:', [len(l) for l in loops], 'points raw,',
          [len(l) for l in smooth], 'smoothed')
