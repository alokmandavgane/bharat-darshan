"""Polyline geometry for `lines` layers: fetch, project, clip to India, simplify.

A `lines` layer names its geometry source in `layer.json` and its features in
`items.json`; this module is what joins the two. Geometry is matched to a curated item
by name, because that is the only field a source and a content folder reliably share,
and folding accents off both sides is what makes "Godävari" meet "Godavari".

Everything leaves here in scene km on the project grid, clipped to the ID raster: the
map draws India alone by default, so a river that carried on into Tibet would trail
off over blank paper.
"""
import os
import unicodedata

import numpy as np

from . import contour, fetch, grid, shapefile


def fold(name):
    """Lower-case and strip accents, so a source's transliteration can meet a curated name."""
    s = unicodedata.normalize('NFKD', str(name or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()


def load_source(source, raw_dir):
    """Download a layer's geometry files and index their parts by folded name."""
    if source.get('format') != 'shapefile-polyline':
        raise ValueError(f"unknown lines source format {source.get('format')!r}")
    paths = {}
    for name, url in source['files'].items():
        dest = os.path.join(raw_dir, name)
        fetch.download(url, dest)
        paths[name] = dest
    shp = next(p for n, p in paths.items() if n.endswith('.shp'))
    dbf = next(p for n, p in paths.items() if n.endswith('.dbf'))
    _, rows = shapefile.read_dbf(dbf, encoding=source.get('encoding', 'latin-1'))
    key = source.get('match', 'name')
    by_name = {}
    for row, (_, parts) in zip(rows, shapefile.read_polylines(shp)):
        if parts:
            by_name.setdefault(fold(row.get(key)), []).extend(parts)
    return by_name


def _clip(xz, inside):
    """Split a projected line into the runs whose vertices are inside the mask."""
    runs, cur = [], []
    for p, ok in zip(xz, inside):
        if ok:
            cur.append(p)
        elif cur:
            runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


def _orient(run, heights):
    """Turn a run round if it climbs, so it reads source to mouth.

    Water is the one thing on a map with a direction of its own, and the source does not
    carry it: Natural Earth's centrelines are not digitised downstream, and a run clipped
    at the border can come out either way about. The bed is the record. Fit height against
    distance along the run and reverse it when the fit rises.
    """
    if len(run) < 3:
        return run
    h, w = heights.shape
    col, row = grid.scene_to_pixel(run[:, 0], run[:, 1], w, h)
    z = heights[np.clip(row.astype(int), 0, h - 1), np.clip(col.astype(int), 0, w - 1)].astype(np.float64)
    d = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(run, axis=0).T))])
    dd = d - d.mean()
    if not dd.any():
        return run
    slope = float((dd * (z - z.mean())).sum() / (dd * dd).sum())
    return run[::-1] if slope > 0 else run


def project(parts, ids, simplify_km, heights=None):
    """lon/lat parts -> scene-km runs inside India, simplified. Returns [(n, 2) arrays]."""
    height, width = ids.shape
    km_per_px = grid.HEIGHT_KM / height
    out = []
    for part in parts:
        x, z = grid.lonlat_to_scene(part[:, 0], part[:, 1])
        xz = np.column_stack([x, z])
        col, row = grid.lonlat_to_pixel(part[:, 0], part[:, 1], width, height)
        c = np.clip(col.astype(int), 0, width - 1)
        r = np.clip(row.astype(int), 0, height - 1)
        for run in _clip(xz, ids[r, c] > 0):
            if len(run) < 2:
                continue
            simple = contour.simplify_line(run, simplify_km)
            if len(simple) >= 2 and _length(simple) > km_per_px:
                out.append(simple if heights is None else _orient(simple, heights))
    return out


def _length(run):
    return float(np.hypot(*np.diff(run, axis=0).T).sum())


def build(item, by_name, ids, simplify_km, heights=None):
    """Geometry for one curated item: its source names joined, projected and clipped.

    With `heights`, every run is pointed downstream, for a layer that animates its flow.
    """
    parts = []
    for name in item.get('source_names') or []:
        parts.extend(by_name.get(fold(name), []))
    runs = project(parts, ids, simplify_km, heights)
    runs.sort(key=lambda r: -_length(r))
    return runs, sum(_length(r) for r in runs)
