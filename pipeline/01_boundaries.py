#!/usr/bin/env python3
"""Step 1: official boundaries -> state ID rasters, border distance fields, states.json.

Inputs (fetched into pipeline/raw/boundaries/ on first run), both from the DataMeet
community maps repository, CC BY 4.0, https://github.com/datameet/maps :
  States/Admin2.shp (+.dbf)   28 states + 8 union territories, Census-of-India lineage,
                              official external boundary (all of Jammu & Kashmir and
                              Ladakh, Arunachal Pradesh); already carries Telangana,
                              Ladakh and the merged Dadra and Nagar Haveli and Daman and Diu.
  Country/india-soi.geojson   India's outline as per Survey of India: the authoritative
                              mask. Gaps between state polygons inside it are filled from
                              the nearest state; state pixels outside it are reported.
Never replace these with default Natural Earth / OSM outlines (PLAN.md D6).

Outputs, per tier H (public/data/regions/), all on the project grid (pipeline/lib/grid.py):
  states-ids-{H}.bin.gz   uint8 state id per pixel, 0 = outside India (sample NEAREST)
  states.json             id -> slug, ISO 3166-2, type, names, validated facts (only shown when
                          reviewed), bbox + anchor in scene km, and area_km2 counted from raster
                          pixels (within a few percent; it ranks units for touch hit-testing and is
                          not a fact to display)
  outlines/<slug>.json    simplified outline loops of each unit in scene km, traced from the
                          finest ID raster (walls of the lifted state block, tight camera fits);
                          outlines/india.json is the whole country
The border distance fields are made in step 2, which knows where the coast is.
A colour preview goes to pipeline/tmp/preview-states-{H}.png for eyeballing.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import contour, fetch, grid, lcc, pack, raster, shapefile  # noqa: E402

ROOT = fetch.ROOT
RAW = os.path.join(fetch.RAW, 'boundaries')
DATAMEET = 'https://raw.githubusercontent.com/datameet/maps/master/'
INPUTS = {
    'Admin2.shp': DATAMEET + 'States/Admin2.shp',
    'Admin2.dbf': DATAMEET + 'States/Admin2.dbf',
    'Admin2.prj': DATAMEET + 'States/Admin2.prj',
    'india-soi.geojson': DATAMEET + 'Country/india-soi.geojson',
}


def load_units():
    with open(os.path.join(ROOT, 'content', 'states', 'states.json'), encoding='utf-8') as f:
        units = json.load(f)['units']
    problems = []
    for u in units:
        problems += validate_facts(u)
    if problems:
        sys.exit('content/states/states.json:\n  ' + '\n  '.join(problems))
    return units


BLURB_MAX = 240


def validate_facts(u):
    """The content rules from PLAN.md section 5, applied to a unit's facts. Returns problems."""
    f = u.get('facts')
    tag = u['slug']
    if not f:
        return [f'{tag}: no facts']
    p = []
    if f.get('status') not in ('draft', 'reviewed'):
        p.append(f'{tag}: status must be draft or reviewed')
    for field in ('capital', 'blurb'):
        v = f.get(field) or {}
        for lang in ('en', 'hi'):
            if not v.get(lang):
                p.append(f'{tag}: {field}.{lang} missing')
    for lang in ('en', 'hi'):
        if len((f.get('blurb') or {}).get(lang, '')) > BLURB_MAX:
            p.append(f'{tag}: blurb.{lang} longer than {BLURB_MAX} characters')
    if not f.get('languages') or any(not (l.get('en') and l.get('hi')) for l in f['languages']):
        p.append(f'{tag}: languages need en and hi for every entry')
    for field in ('area_km2', 'population_2011'):
        v = f.get(field)
        if v is not None and (not isinstance(v, int) or v <= 0):
            p.append(f'{tag}: {field} must be a positive integer or null')
    if not f.get('sources') or any(not str(s).startswith('http') for s in f['sources']):
        p.append(f'{tag}: sources must list at least one URL')
    return p


def geojson_rings(path):
    """[(ring array lon/lat, is_hole)] for every polygon in a GeoJSON file."""
    with open(path, encoding='utf-8') as f:
        gj = json.load(f)
    feats = gj['features'] if gj['type'] == 'FeatureCollection' else [gj]
    out = []
    for ft in feats:
        g = ft['geometry'] if ft['type'] == 'Feature' else ft
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            for i, ring in enumerate(poly):
                arr = np.asarray(ring, dtype=np.float64)[:, :2]
                if len(arr) >= 4:
                    out.append((arr, i > 0))
    return out


def to_pixels(rings, width, height):
    out = []
    for ring, is_hole in rings:
        col, row = grid.lonlat_to_pixel(ring[:, 0], ring[:, 1], width, height)
        out.append((np.column_stack([col, row]), is_hole))
    return out


def ring_area_px(rings):
    return sum(abs(shapefile.signed_area(r)) for r, hole in rings if not hole)


def build_tier(height, features, soi_rings, units_by_id):
    width, height = grid.raster_size(height)
    km_per_px = grid.HEIGHT_KM / height
    t = time.time()
    shapes = []
    for unit_id, rings in features:
        px = to_pixels(rings, width, height)
        shapes.append((ring_area_px(px), unit_id, px))
    shapes.sort(key=lambda s: -s[0])                 # big first, enclaves later
    ids = raster.rasterise([(uid, px) for _, uid, px in shapes], width, height)
    mask = raster.rasterise([(1, to_pixels(soi_rings, width, height))], width, height) > 0

    gaps = int((mask & (ids == 0)).sum())
    outside = ~mask & (ids != 0)
    n_out = int(outside.sum())
    if n_out:
        # Where do state polygons reach beyond the SoI outline? Report by 1-degree cell.
        d_out = raster.bounded_distance(mask, 12)
        rows, cols = np.nonzero(outside)
        ex, ny = grid.pixel_centres(width, height)
        lon, lat = lcc.inverse(ex[rows, cols], ny[rows, cols])
        cells = {}
        for lo, la, dd in zip(np.floor(lon), np.floor(lat), d_out[rows, cols]):
            c = cells.setdefault((int(lo), int(la)), [0, 0.0])
            c[0] += 1
            c[1] = max(c[1], float(dd))
        top = sorted(cells.items(), key=lambda kv: -kv[1][0])[:6]
        print('  state px outside the SoI outline by 1-degree cell (lon, lat): n, max px:',
              ', '.join(f'({k[0]},{k[1]}): {v[0]}, {v[1]:.1f}' for k, v in top))
        # The SoI outline is the authority for the external boundary: drop pixels more
        # than about one pixel beyond it (generalisation noise), keep the rest.
        ids[d_out > 1.5] = 0
    ids = raster.fill_nearest(ids, mask)
    left = int((mask & (ids == 0)).sum())
    print(f'  {width}x{height}: {km_per_px:.2f} km/px, {gaps} gap px filled ({left} left), '
          f'{n_out} state px outside the SoI outline  [{time.time() - t:.1f}s]')
    assert ids.max() <= 255 and left == 0
    return width, height, km_per_px, ids.astype(np.uint8), mask


def country_hull(ids, width, height):
    """Convex hull of India (all labelled pixels) in scene km, for tight camera fits."""
    _, external = raster.edges(ids)
    rows, cols = np.nonzero(external & (ids != 0))
    # pixel corners, so the hull encloses whole pixels
    pts = np.concatenate([np.column_stack([cols + dx, rows + dy]) for dx in (0, 1) for dy in (0, 1)])
    hull = raster.convex_hull(pts)
    sx = -grid.WIDTH_KM / 2 + hull[:, 0] * grid.WIDTH_KM / width
    sz = -grid.HEIGHT_KM / 2 + hull[:, 1] * grid.HEIGHT_KM / height
    return [[round(float(x), 1), round(float(z), 1)] for x, z in zip(sx, sz)]


def write_outlines(ids, width, height, units_by_id, out_dir):
    """Trace every unit (and the whole country) from the ID raster into simplified loops in scene km."""
    os.makedirs(out_dir, exist_ok=True)
    sx = grid.WIDTH_KM / width
    sz = grid.HEIGHT_KM / height
    total = 0
    jobs = [(u['slug'], u['id'], ids == u['id']) for u in units_by_id.values()] + [('india', 0, ids > 0)]
    for slug, uid, mask in jobs:
        loops = contour.trace(mask, tol=1.0, min_area=2.0)
        out = [[[round(-grid.WIDTH_KM / 2 + x * sx, 1), round(-grid.HEIGHT_KM / 2 + y * sz, 1)] for x, y in loop.tolist()] for loop in loops]
        total += sum(len(l) for l in out)
        with open(os.path.join(out_dir, f'{slug}.json'), 'w', encoding='utf-8') as f:
            json.dump({'id': uid, 'slug': slug, 'km_per_px': round(sz, 4), 'loops': out}, f, separators=(',', ':'))
    print(f'  wrote {len(jobs)} outlines ({total} points) to {os.path.relpath(out_dir, ROOT)}/')


def unit_stats(ids, km_per_px, width, height):
    stats = {}
    for uid in np.unique(ids):
        if uid == 0:
            continue
        m = ids == uid
        ys, xs = np.nonzero(m)
        pr, pc = raster.pole_of_inaccessibility(m)
        # pixel -> scene km: x east from the west edge, z south from the north edge.
        def sx(col):
            return round(-grid.WIDTH_KM / 2 + (col + 0.5) * grid.WIDTH_KM / width, 1)

        def sz(row):
            return round(-grid.HEIGHT_KM / 2 + (row + 0.5) * grid.HEIGHT_KM / height, 1)
        stats[int(uid)] = {
            'bbox': [sx(xs.min()), sz(ys.min()), sx(xs.max()), sz(ys.max())],
            'anchor': [sx(pc), sz(pr)],
            'area_km2': int(round(m.sum() * km_per_px * km_per_px)),
        }
    return stats


def preview(ids, path):
    rng = np.random.default_rng(7)
    lut = np.concatenate([[[232, 236, 240]], rng.integers(90, 230, size=(255, 3))]).astype(np.uint8)
    img = lut[ids]
    internal, external = raster.edges(ids)
    img[internal] = (60, 60, 60)
    img[external] = (0, 0, 0)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(img).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tiers', default='1024,2048', help='raster heights to build')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    args = ap.parse_args()
    tiers = [int(t) for t in args.tiers.split(',')]

    print('inputs')
    for name, url in INPUTS.items():
        fetch.download(url, os.path.join(RAW, name))

    units = load_units()
    by_source = {u['source_name']: u for u in units}
    feats = shapefile.read_features(os.path.join(RAW, 'Admin2.shp'), os.path.join(RAW, 'Admin2.dbf'))
    features, seen = [], set()
    for row, rings in feats:
        u = by_source.get(row['ST_NM'])
        if u is None:
            sys.exit(f'unmatched shapefile record: {row}')
        holes = sum(1 for _, h in rings if h)
        print(f"  {row['ST_NM']:42s} -> id {u['id']:2d} {u['iso']}  rings={len(rings)} holes={holes}")
        features.append((u['id'], rings))
        seen.add(u['id'])
    missing = [u['iso'] for u in units if u['id'] not in seen]
    if missing:
        sys.exit(f'units without geometry: {missing}')
    soi = geojson_rings(os.path.join(RAW, 'india-soi.geojson'))
    print(f'  SoI outline: {len(soi)} rings')

    units_by_id = {u['id']: u for u in units}
    out_dir = os.path.join(args.out, 'regions')
    files, stats = {}, None
    print('tiers')
    for h in tiers:
        width, height, km_per_px, ids, mask = build_tier(h, features, soi, units_by_id)
        p1 = os.path.join(out_dir, f'states-ids-{height}.bin.gz')
        s1 = pack.write(p1, ids, 'uint8', 'left', kind='region-ids', km_per_px=km_per_px)
        print(f'  wrote {os.path.relpath(p1, ROOT)} ({s1 / 1024:.0f} KB)')
        files[str(height)] = {'ids': os.path.relpath(p1, args.out),
                              'width': width, 'height': height, 'km_per_px': round(km_per_px, 4)}
        stats = unit_stats(ids, km_per_px, width, height)   # the last (finest) tier wins
        hull = country_hull(ids, width, height)
        finest = (ids, width, height)
        preview(ids, os.path.join(ROOT, 'pipeline', 'tmp', f'preview-states-{height}.png'))

    write_outlines(finest[0], finest[1], finest[2], units_by_id, os.path.join(out_dir, 'outlines'))
    out_units = []
    for u in units:
        entry = {k: u[k] for k in ('id', 'slug', 'iso', 'type', 'name', 'facts')}
        entry.update(stats[u['id']])
        out_units.append(entry)
    bbox = [min(u['bbox'][0] for u in out_units), min(u['bbox'][1] for u in out_units),
            max(u['bbox'][2] for u in out_units), max(u['bbox'][3] for u in out_units)]
    meta = {
        'grid': grid.describe(),
        'tiers': files,
        'country': {'bbox': bbox, 'hull': hull},
        'attribution': 'State boundaries and India outline: DataMeet India community maps (CC BY 4.0), '
                       'Census of India / Survey of India lineage.',
        'units': out_units,
    }
    with open(os.path.join(out_dir, 'states.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f'  wrote {os.path.relpath(os.path.join(out_dir, "states.json"), ROOT)}')


if __name__ == '__main__':
    main()
