"""India's districts: the LGD polygons, with names, headquarters and figures from Wikidata.

The geometry is the `LGD_Districts` layer (785 polygons, 36 units, Local Government
Directory codes of 2024) published as TopoJSON by the india-geodata catalogue. PLAN.md
section 7 surveyed every candidate and this is the one that carries the official external
boundary -- Aksai Chin, Shaksgam and Gilgit inside Leh Ladakh, Pakistan-occupied Kashmir
as two named polygons, the whole of Arunachal -- and both the LGD and the 2011 census
codes, so census tables can be joined to it later.

What it does not carry is a name in Hindi, a headquarters or a population. Wikidata does,
and it files Indian districts under the same LGD code (P12746), so the join is a code
match rather than a name match: 779 of the 785 meet their item exactly.

The TopoJSON matters beyond the licence. It stores every boundary once, as an arc shared
by the two districts it separates, so the district mesh can be drawn without inking any
internal line twice -- which is the difference between a map and a smudge at this density.
"""
import collections
import hashlib
import json
import os

import numpy as np

from . import fetch, grid, lines as lines_lib, raster, topo, wikidata

# Wikidata labels an Indian district "Adilabad district" and "अदिलाबाद जिला": the word
# is the class, not the name, and the layer already says what these are.
SUFFIXES_EN = (' district', ' District')
SUFFIXES_HI = (' जिला', ' ज़िला', ' ज़िला', ' जिल्हा')


def _bare(label, suffixes):
    for s in suffixes:
        if label and label.endswith(s):
            return label[:-len(s)].strip()
    return (label or '').strip()

TOPOJSON_URL = ('https://raw.githubusercontent.com/yashveeeeeeer/india-geodata/main/'
                'docs/maps/data/districts.topo.json')
CATALOGUE_URL = 'https://github.com/yashveeeeeeer/india-geodata'   # what a card links to
# The shapes the map draws when a state is opened. The TopoJSON above is a web-map
# simplification -- its vertices are 1.7 km apart, which is fine over the whole country
# and coarse the moment a state fills the screen -- and it stays the layer's identity: the
# codes, and through them the names. These are the survey's own polygons, eighteen times
# as many points, and geometry is all they are asked for.
POLYGON_URL = ('https://raw.githubusercontent.com/datta07/INDIAN-SHAPEFILES/master/'
               'INDIA/INDIA_DISTRICTS.geojson')
POLYGON_SOURCE = 'https://github.com/datta07/INDIAN-SHAPEFILES'
DISTRICT_CLASS = 'wd:Q1149652'      # district of India, and everything that specialises it
LGD_CODE = 'wdt:P12746'             # the code the two sources meet on

QUERY = f'''SELECT ?item ?lgd ?pc11 ?en ?hi ?pop ?area ?hqEn ?hqHi WHERE {{
 ?item wdt:P31/wdt:P279* {DISTRICT_CLASS} .
 ?item {LGD_CODE} ?lgd .
 OPTIONAL {{ ?item wdt:P5578 ?pc11 }}
 OPTIONAL {{ ?item rdfs:label ?en FILTER(LANG(?en)="en") }}
 OPTIONAL {{ ?item rdfs:label ?hi FILTER(LANG(?hi)="hi") }}
 OPTIONAL {{ ?item wdt:P1082 ?pop }}
 OPTIONAL {{ ?item wdt:P2046 ?area }}
 OPTIONAL {{ ?item wdt:P36 ?hq .
            OPTIONAL {{ ?hq rdfs:label ?hqEn FILTER(LANG(?hqEn)="en") }}
            OPTIONAL {{ ?hq rdfs:label ?hqHi FILTER(LANG(?hqHi)="hi") }} }}
}}'''


def _wikidata(raw):
    """What Wikidata says about every district, by LGD code. Cached by the query itself."""
    key = hashlib.sha1(QUERY.encode()).hexdigest()[:12]
    cache = os.path.join(raw, f'wikidata-districts-{key}.json')
    if os.path.exists(cache):
        with open(cache, encoding='utf-8') as f:
            return json.load(f)
    rows = wikidata.ask(QUERY, timeout=300)
    out = {}
    for row in rows:
        rec = out.setdefault(row['lgd']['value'], {'item': row['item']['value'].rsplit('/', 1)[-1]})
        for k in ('pc11', 'en', 'hi', 'hqEn', 'hqHi'):
            if k in row and not rec.get(k):
                rec[k] = row[k]['value']
        # A district can carry several censuses' figures; the largest is the latest.
        for k in ('pop', 'area'):
            if k in row:
                try:
                    rec[k] = max(rec.get(k) or 0, float(row[k]['value']))
                except ValueError:
                    pass
    os.makedirs(raw, exist_ok=True)
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f'    wikidata: {len(out)} districts by LGD code')
    return out


def _place(units, ids, width, height):
    """
    Which state each district stands in, and where its name should sit.

    Both answers come from rasterising the districts onto the project's own ID grid:
    the state is the one holding most of the district's pixels -- not the state named in
    the source, so that a district and its state always agree with the raster the map
    actually draws -- and the anchor is the pixel deepest inside the district, which is
    where a cartographer would letter it and is inside even a horseshoe.
    """
    shapes, boxes = [], []
    for n, (props, rings, _ids) in enumerate(units, start=1):
        px, x0, y0, x1, y1 = [], width, height, 0, 0
        for ring in rings:
            col, row = grid.lonlat_to_pixel(ring[:, 0], ring[:, 1], width, height)
            # TopoJSON follows the right-hand rule: an outer ring runs counter-clockwise
            # and a clockwise one is a hole -- an enclave the district does not hold.
            px.append((np.column_stack([col, row]), topo.ring_area(ring) > 0))
            x0, x1 = min(x0, col.min()), max(x1, col.max())
            y0, y1 = min(y0, row.min()), max(y1, row.max())
        shapes.append((n, px))
        boxes.append((max(0, int(x0) - 1), max(0, int(y0) - 1),
                      min(width, int(x1) + 2), min(height, int(y1) + 2)))
    # Biggest first, so a district drawn inside another one survives it.
    order = sorted(shapes, key=lambda s: -sum(abs(topo.ring_area(np.asarray(r))) for r, hole in s[1] if not hole))
    drawn = raster.rasterise(order, width, height)
    # One pass for every district's state: a histogram over (district, state) pairs.
    n_states = int(ids.max()) + 1
    pair = drawn.ravel().astype(np.int64) * n_states + ids.ravel().astype(np.int64)
    counts = np.bincount(pair, minlength=(len(units) + 1) * n_states).reshape(-1, n_states)
    counts[:, 0] = 0                                    # sea and abroad do not vote
    out = []
    for n, (x0, y0, x1, y1) in enumerate(boxes, start=1):
        region = int(counts[n].argmax()) if counts[n].any() else 0
        # The mask is cut to the district's own box, which is what keeps 785 poles cheap.
        mask = drawn[y0:y1, x0:x1] == n
        deep = raster.pole_of_inaccessibility(mask, max_side=96)
        anchor = None
        if deep is not None:
            row, col = deep[0] + y0, deep[1] + x0
            anchor = (float((col + 0.5) / width * grid.WIDTH_KM - grid.WIDTH_KM / 2),
                      float((row + 0.5) / height * grid.HEIGHT_KM - grid.HEIGHT_KM / 2))
        out.append({'region': region, 'anchor': anchor, 'pixels': int(mask.sum())})
    return out


def load(ids, raw=None):
    """
    Every district: its codes, its names, its state, its outline and the arcs it is
    bounded by. Returns (districts, arcs) with arcs as lon/lat arrays, shared.
    """
    raw = raw or os.path.join(fetch.RAW, 'districts')
    path = os.path.join(raw, 'districts.topo.json')
    fetch.download(TOPOJSON_URL, path, quiet=True)
    arcs, objects = topo.load(path)
    units = topo.features(arcs, objects['districts'])
    wd = _wikidata(raw)
    height, width = ids.shape
    placed = _place(units, ids, width, height)
    km2_per_px = (grid.WIDTH_KM / width) * (grid.HEIGHT_KM / height)
    out = []
    for (props, rings, arc_ids), where in zip(units, placed):
        lgd = str(props.get('lgd') or '')
        w = wd.get(lgd) if lgd and lgd != '0' else None
        out.append({
            'lgd': int(props.get('lgd') or 0),
            'pc11': str(props.get('census') or '') or None,
            'name_en': _bare((w or {}).get('en'), SUFFIXES_EN) or props['name'],
            'name_hi': _bare((w or {}).get('hi'), SUFFIXES_HI) or None,
            'hq_en': (w or {}).get('hqEn'),
            'hq_hi': (w or {}).get('hqHi'),
            'population': int(w['pop']) if (w or {}).get('pop') else None,
            'area_km2': int(round(w['area'])) if (w or {}).get('area') else None,
            'item': (w or {}).get('item'),
            'source_state': props.get('state'),
            'region': where['region'],
            'anchor': where['anchor'],
            'drawn_km2': round(where['pixels'] * km2_per_px),
            'arcs': arc_ids,
            'rings': rings,
        })
    return out, arcs


def outlines(ids, raw=None):
    """
    The survey's district polygons, grouped by the state they stand in, as the lines
    *between* districts -- the state's own edge left out, because the model draws it.

    The survey draws each district as a closed ring, so the line between two of them is
    drawn twice, once by each, and the line around a whole state once. Counting segments
    tells the two apart exactly, and the kept ones are chained back into long runs.

    Returns {region id: [lon/lat polylines]}.
    """
    raw = raw or os.path.join(fetch.RAW, 'districts')
    path = os.path.join(raw, 'districts.geojson')
    fetch.download(POLYGON_URL, path, quiet=True)
    height, width = ids.shape
    by_region = {}
    for props, rings in lines_lib.read_geojson(path):
        if not rings:
            continue
        # Which state, from the project's own raster rather than the source's name, so a
        # district and its state always agree with what the map draws.
        big = max(rings, key=len)
        col, row = grid.lonlat_to_pixel(big[:, 0], big[:, 1], width, height)
        c = np.clip(np.round(col.mean()).astype(int), 0, width - 1)
        r = np.clip(np.round(row.mean()).astype(int), 0, height - 1)
        region = int(ids[r, c])
        if not region:                       # a centre in the sea: ask the ring itself
            cc = np.clip(col.astype(int), 0, width - 1)
            rr = np.clip(row.astype(int), 0, height - 1)
            seen = ids[rr, cc]
            seen = seen[seen > 0]
            if not len(seen):
                continue
            region = int(np.bincount(seen).argmax())
        by_region.setdefault(region, []).extend(rings)
    return {region: shared_edges(rings) for region, rings in by_region.items()}


def shared_edges(rings):
    """
    The lines inside a group of districts: every segment two of them share, chained.

    A segment seen twice is a boundary between two districts; a segment seen once is the
    group's own outer edge, which is the state border and the coast, and the model draws
    both of those for itself.
    """
    seen = collections.Counter()
    for ring in rings:
        q = np.round(ring, 7)
        for a, b in zip(q, q[1:]):
            ka, kb = (float(a[0]), float(a[1])), (float(b[0]), float(b[1]))
            seen[(ka, kb) if ka <= kb else (kb, ka)] += 1
    inner = [np.array(k, dtype=np.float64) for k, n in seen.items() if n > 1]
    return lines_lib.stitch(inner, tol=1e-7)
