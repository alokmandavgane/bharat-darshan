"""A TopoJSON reader, for sources published as shared arcs rather than as a shapefile.

TopoJSON stores every boundary once, as an *arc*, and describes a polygon as a list of
arc indices; a negative index means that arc traversed backwards. For administrative
units that is exactly the right shape: the line between two districts is one arc, so a
district mesh can be drawn without inking every internal border twice.

Coordinates are delta-encoded integers on a quantised grid, which `transform` turns back
into degrees. Only what this project needs is implemented: GeometryCollection objects of
Polygon and MultiPolygon, and their properties.
"""
import json

import numpy as np


def load(path):
    """Read a TopoJSON file. Returns (arcs, objects) with arcs as (n, 2) lon/lat arrays."""
    with open(path, encoding='utf-8') as f:
        topo = json.load(f)
    tr = topo.get('transform')
    arcs = []
    for arc in topo['arcs']:
        a = np.asarray(arc, dtype=np.float64)
        if tr:                                  # delta-encoded on the quantised grid
            a = np.cumsum(a, axis=0)
            a = a * np.asarray(tr['scale']) + np.asarray(tr['translate'])
        arcs.append(a)
    return arcs, topo['objects']


def _ring(arcs, indices):
    """One ring: the arcs it names, joined end to end, a negative index reversed."""
    parts = []
    for i in indices:
        a = arcs[~i][::-1] if i < 0 else arcs[i]
        parts.append(a[1:] if parts else a)
    return np.concatenate(parts) if parts else np.zeros((0, 2))


def features(arcs, obj):
    """
    Every geometry of a GeometryCollection as (properties, rings, arc_ids).

    `rings` are closed lon/lat loops, outer rings first within each polygon; `arc_ids` is
    the set of arcs the unit is bounded by, without direction, which is what lets a
    caller ink a shared border once.
    """
    out = []
    for g in obj.get('geometries', []):
        polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs'] if g['type'] == 'MultiPolygon' else []
        rings, ids = [], set()
        for poly in polys:
            for ring in poly:
                rings.append(_ring(arcs, ring))
                ids.update(i if i >= 0 else ~i for i in ring)
        if rings:
            out.append((g.get('properties') or {}, rings, ids))
    return out


def ring_area(ring):
    """Signed area of a closed lon/lat ring in square degrees; positive is clockwise."""
    if len(ring) < 3:
        return 0.0
    x, y = ring[:, 0], ring[:, 1]
    return float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y)) / 2.0
