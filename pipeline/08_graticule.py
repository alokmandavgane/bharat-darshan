#!/usr/bin/env python3
"""Step 8: the graticule -> public/data/graticule.json (PLAN.md section 3, item 6).

Parallels and meridians every 5 degrees, scored into the table the model stands on. It is
furniture rather than a layer: as a layer every parallel would need a name, a blurb in two
languages and a card nobody wants, and the engine would give it a legend and picking it
has no use for. What it is instead is a plain list of pre-projected polylines the engine
draws as hairlines on the paper.

Pre-projected because the runtime has no projection code (PLAN.md D3), and walked rather
than drawn end to end because a parallel is a straight line in EPSG:7755 only at the
projection's standard parallels: everywhere else it curves, and that curve is the thing
worth showing -- it is what makes a turned view legible.

Output (scene km, x east and z south, 1 unit = 1 km):
  graticule.json   { spacing_deg, lines: [ { kind, deg, points: [[x, z], ...] } ] }
Each line is clipped to the board -- the project grid's own rectangle -- so nothing hangs
off the edge of the paper.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np  # noqa: E402

from pipeline.lib import contour, grid, lines  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPACING_DEG = 5           # 5 degrees is about 550 km: a handful of lines, not a mesh
SIMPLIFY_KM = 4.0         # the curve is gentle; 4 km keeps it smooth and the file small
EDGE_KM = 1.0             # stop this far inside the board, so a line never sits on its rim


def multiples(lo, hi, step):
    """The multiples of `step` inside [lo, hi] -- the round degrees, not the box's own."""
    first = int(np.ceil(lo / step)) * step
    return list(range(first, int(np.floor(hi / step)) * step + 1, step))


def on_board(xz):
    """Runs of a polyline that fall on the board, as [(n, 2) arrays]."""
    half_w, half_h = grid.WIDTH_KM / 2 - EDGE_KM, grid.HEIGHT_KM / 2 - EDGE_KM
    inside = (np.abs(xz[:, 0]) <= half_w) & (np.abs(xz[:, 1]) <= half_h)
    out, run = [], []
    for point, keep in zip(xz, inside):
        if keep:
            run.append(point)
        elif run:
            out.append(np.array(run))
            run = []
    if run:
        out.append(np.array(run))
    return [r for r in out if len(r) >= 2]


def build():
    out = []
    for kind, key, degrees in (
            ('parallel', 'parallel', multiples(grid.LAT_MIN, grid.LAT_MAX, SPACING_DEG)),
            ('meridian', 'meridian', multiples(grid.LON_MIN, grid.LON_MAX, SPACING_DEG))):
        for deg in degrees:
            for part in lines.generate({key: float(deg)}):
                x, z = grid.lonlat_to_scene(part[:, 0], part[:, 1])
                for run in on_board(np.column_stack([x, z])):
                    simple = contour.simplify_line(run, SIMPLIFY_KM)
                    if len(simple) < 2:
                        continue
                    out.append({
                        'kind': kind,
                        'deg': deg,
                        'points': [[round(float(a), 1), round(float(b), 1)] for a, b in simple],
                    })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    args = ap.parse_args()
    lines_out = build()
    if not lines_out:
        print('graticule: nothing crosses the board, which cannot be right')
        sys.exit(1)
    data = {'spacing_deg': SPACING_DEG, 'lines': lines_out}
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, 'graticule.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    points = sum(len(x['points']) for x in lines_out)
    kinds = {k: sum(1 for x in lines_out if x['kind'] == k) for k in ('parallel', 'meridian')}
    print(f"graticule: {kinds['parallel']} parallels, {kinds['meridian']} meridians, "
          f"{points} points -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)")


if __name__ == '__main__':
    main()
