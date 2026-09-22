#!/usr/bin/env python3
"""Step 4: content layers -> runtime layer files (PLAN.md section 5, "a layer is a folder").

Every folder under content/layers/<id>/ holds layer.json (id, type, title, categories,
...) and items.json. This step validates them against the base item schema, checks that
each anchor really falls inside a claimed region (using the finest state ID raster,
which catches geocoding slips), projects anchors to scene km, and writes
public/data/layers/<id>.json. Items keep their review status; the runtime decides what
to show (only reviewed items, unless drafts are switched on).

Layer types known today:
  points   an anchor per item, validated against the ID raster
  lines    geometry fetched from the source named in layer.json and joined to the
           curated items either by name or by routing through waypoints, then
           projected, clipped to India and simplified. With "flow": true every run is
           also pointed downstream, against the heightmap
  choropleth  a values.csv of region,value beside layer.json; the build turns the ISO
           codes into raster ids and the runtime makes the id-to-colour lookup
  areas    named polygons that are not regions -- coalfields, physiographic divisions --
           joined to the source by name like a river, then rasterised into one uint8 id
           raster for the layer and clipped to India
  regional a list per region: items belong to the states that keep them and are read in
           the state view; one that also names an anchor -- the place it is most seen at --
           is drawn there as well
A points layer's `marker` says how it draws: a clay token (default), a name alone
(label), a proportional circle (symbol), a bead the size of a pinhead (dot), or a
figurine built from a recipe under content/models/ (model). A points layer may also be
generated from a source (`source.format: "geonames"`) and merged with its curated items.
The engine knows types and markers, never layer ids.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from pipeline.lib import districts as districts_lib  # noqa: E402
from pipeline.lib import fetch, grid, lines, pack, raster, shapefile, wikidata  # noqa: E402
from pipeline.lib import sources as sources_lib  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = ('points', 'lines', 'choropleth', 'regional', 'areas', 'prisms')
GENERATED = 'generated'     # ...or from the item's own description of a line that is defined, not surveyed
DISTRICTS = 'districts'     # a layer the build makes from India's district polygons
JOINS = ('name', 'route', GENERATED)   # how a lines item finds its geometry
STATUSES = ('draft', 'reviewed')
MARKERS = ('symbol', 'label', 'dot', 'model')
MODELS_DIR = os.path.join(ROOT, 'content', 'models')
# The primitives a figurine recipe is built from: what three.js can make from a few numbers.
SHAPES = {
    'sphere': ('r',), 'cylinder': ('rt', 'rb', 'h'), 'cone': ('r', 'h'), 'box': ('w', 'h', 'd'),
    'torus': ('r', 'tube'), 'lathe': ('profile',), 'extrude': ('outline', 'depth'),
}
# Structured columns a layer can add on top of the base item schema (PLAN.md section 5).
FIELD_TYPES = {'int': int, 'number': (int, float), 'text': str, 'year': int, 'month': int,
               'name': dict}    # a proper name, which exists in both languages like any other
BLURB_MAX = 240
EVERYWHERE = '*'     # a regional item kept across the whole country
CATEGORICAL = 'categorical'   # a choropleth's scale, when regions carry a category and not a number
MAX_BANDS = 8        # the terrain shader declares this many colours; keep in step with choropleth.js


def bilingual(v):
    return isinstance(v, dict) and bool(v.get('en')) and bool(v.get('hi'))


def height_loader(out, states):
    """The finest heights tier, read once and only if some layer asks to point downstream."""
    cache = {}

    def get():
        if 'h' not in cache:
            finest = max(states['tiers'], key=int)
            _, h = pack.read(os.path.join(out, 'terrain', f'heights-{finest}.bin.gz'))
            cache['h'] = h[:, :, 0]
        return cache['h']
    return get


def load_states(out):
    with open(os.path.join(out, 'regions', 'states.json'), encoding='utf-8') as f:
        states = json.load(f)
    finest = max(states['tiers'], key=int)
    _, ids = pack.read(os.path.join(out, states['tiers'][finest]['ids']))
    return states, ids[:, :, 0]


def validate_layer(layer, folder, registry):
    p = []
    if layer.get('id') != os.path.basename(folder):
        p.append('layer.id must equal the folder name')
    # Where the layer came from, cited by id against content/sources.json. A map that
    # cannot say where it came from does not ship, so this is a hard failure and not a
    # warning; items may still cite a plain URL for a one-off fact.
    cites = layer.get('sources')
    if not isinstance(cites, list) or not cites:
        p.append('layer.sources must name at least one id from content/sources.json')
    else:
        p += registry.check(cites, 'layer.sources')
        # A bare URL is a citation but not a credit: nothing knows its title, its licence or
        # its year, so a page built on this layer could not say whose map it is.
        if not registry.ids(cites):
            p.append('layer.sources cites only URLs: at least one must be an id from content/sources.json')
    if layer.get('type') not in TYPES:
        p.append(f"layer.type must be one of {TYPES}")
    if not bilingual(layer.get('title')):
        p.append('layer.title needs en and hi')
    cats = layer.get('categories') or []
    # A choropleth is coloured either by a numeric scale or by named categories.
    if layer.get('type') == 'choropleth':
        if layer.get('scale') == CATEGORICAL:
            # The categorical kind: a category per region and a colour each, for what a
            # region *is* rather than how much of something it has -- the political map,
            # language families, climate zones. Its categories are declared exactly as
            # any other layer's, so the legend and the manifest already carry them.
            if not cats or any(not (c.get('id') and bilingual(c.get('title'))) for c in cats):
                p.append('a categorical choropleth needs categories with id and a bilingual title')
            if any(not isinstance(c.get('color'), str) or not c['color'].startswith('#') for c in cats):
                p.append('a categorical choropleth needs a hex color on every category')
            if len(cats) > MAX_BANDS:
                p.append(f'a choropleth can colour at most {MAX_BANDS} categories, got {len(cats)}')
            if layer.get('unit'):
                p.append('a categorical choropleth has no unit: its categories are not quantities')
        else:
            if cats:
                p.append('a choropleth has a scale, not categories')
            p += validate_scale(layer.get('scale'))
            if not bilingual(layer.get('unit')):
                p.append('a choropleth needs a bilingual unit template, e.g. "{n} per km²"')
    elif layer.get('type') == 'prisms':
        # The drawing only a 3D atlas has: the ground of a region raised by a value.
        # It reads values.csv exactly as a choropleth does, and declares how far the top
        # of its range should stand up. It has no categories: a column is one quantity.
        if cats:
            p.append('a prisms layer has a height, not categories')
        p += validate_height(layer.get('height'))
        if not bilingual(layer.get('unit')):
            p.append('a prisms layer needs a bilingual unit template, e.g. "{n} people"')
    elif not cats or any(not (c.get('id') and bilingual(c.get('title'))) for c in cats):
        p.append('categories need id and a bilingual title')
    if layer.get('marker') is not None:
        if layer.get('type') != 'points':
            p.append('only a points layer has a marker')
        elif layer['marker'] not in MARKERS:
            p.append(f'marker must be one of {MARKERS}')
    if layer.get('type') == 'points':
        src = layer.get('source') or {}
        if src and src.get('format') not in ('geonames', DISTRICTS):
            p.append(f'a points layer can only be generated from source.format "geonames" or "{DISTRICTS}"')
        elif src.get('format') == 'geonames' and src.get('dump', 'cities15000') not in GEONAMES_DUMPS:
            p.append(f"source.dump must be one of {GEONAMES_DUMPS}")
    if layer.get('type') == 'areas':
        src = layer.get('source') or {}
        if src.get('format') != 'shapefile-polygon' or not src.get('files'):
            p.append('an areas layer needs source.format "shapefile-polygon" and source.files')
    if layer.get('type') == 'lines':
        src = layer.get('source') or {}
        if src.get('format') == DISTRICTS:
            # The district mesh: geometry and names come from one source together, so the
            # layer names no files and its items are made by the build.
            if src.get('files'):
                p.append(f'a {DISTRICTS} layer fetches its own source: drop source.files')
        elif src.get('join') == GENERATED:
            # Nothing is fetched: each item describes a line that is defined rather than
            # surveyed, and the build walks it across the grid. A parallel has no
            # publisher to credit and no file to download.
            if src.get('files') or src.get('format'):
                p.append('a generated layer fetches nothing: drop source.files and source.format')
        elif not src.get('files') or not src.get('format'):
            p.append('a lines layer needs source.format and source.files')
        if src.get('join', 'name') not in JOINS:
            p.append(f"source.join must be one of {JOINS}")
    elif layer.get('flow') or layer.get('float'):
        p.append('only a lines layer can set flow or float')
    for name, spec in (layer.get('fields') or {}).items():
        if spec.get('type') not in FIELD_TYPES:
            p.append(f'field {name}: type must be one of {FIELD_TYPES}')
        if not bilingual(spec.get('label')):
            p.append(f'field {name}: label needs en and hi')
    p += validate_size(layer)
    return p


AREA_RASTER_HEIGHT = 1024     # areas are broad shapes; the first-view tier's pitch is plenty
MAX_AREAS = 255               # a uint8 raster, with 0 for "no area here"


def build_areas(layer, folder, items, cats, fields, ids, out):
    """
    Named polygons that are not administrative regions: coalfields, physiographic
    divisions, tiger reserves. Returns (out_items, problems).

    They are rasterised rather than kept as outlines, which is what makes them cheap:
    one uint8 raster of area ids for the whole layer, and the terrain then tints itself
    by exactly the lookup a choropleth already uses. A polygon kept as an outline would
    have to be clipped to India's coast as a polygon, which is a far harder thing than
    clipping a line, and then triangulated to be filled at all.
    """
    src = layer['source']
    raw = os.path.join(fetch.RAW, 'layers', layer['id'])
    index = lines.load_polygon_source(src, raw)
    height = AREA_RASTER_HEIGHT
    width = int(round(height * grid.WIDTH_KM / grid.HEIGHT_KM))
    out_items, problems, shapes = [], [], []
    if len(items) > MAX_AREAS:
        return [], [f'an areas layer can hold at most {MAX_AREAS} areas, got {len(items)}']
    for n, it in enumerate(items, start=1):
        problems += validate_line_item(it, cats, 'name', fields)
        if problems and problems[-1].startswith(str(it.get('id'))):
            continue
        rings = []
        for name in it.get('source_names') or []:
            rings.extend(index.get(lines.fold(name), []))
        if not rings:
            problems.append(f"{it['id']}: no polygon in the source is named {it['source_names']}")
            continue
        shapes.append((n, [(np.column_stack(grid.lonlat_to_pixel(r[:, 0], r[:, 1], width, height)), hole)
                           for r, hole in rings]))
        out_items.append({
            'id': it['id'], 'area_id': n, 'name': it['name'], 'category': it['category'],
            'rank': it['rank'], 'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        } | {k: it[k] for k in fields if it.get(k) is not None})
    if problems:
        return out_items, problems
    # Biggest first, so a small area drawn later sits on top of the one that contains it.
    shapes.sort(key=lambda s: -sum(abs(shapefile.signed_area(r)) for r, hole in s[1] if not hole))
    grid_ids = raster.rasterise(shapes, width, height)
    # India only: the model draws nothing else, and Natural Earth's regions run well past
    # the border -- the Ganges Plain into Bangladesh, the Thar into Pakistan.
    inside = np.array(Image.fromarray(ids.astype(np.uint8)).resize((width, height), Image.NEAREST)) > 0
    grid_ids = np.where(inside, grid_ids, 0).astype(np.uint8)
    rel = f'layers/{layer["id"]}-areas.bin.gz'
    size = pack.write(os.path.join(out, rel), grid_ids, 'uint8', predictor='none')
    covered = {int(v) for v in np.unique(grid_ids) if v}
    for it in out_items:
        px = int((grid_ids == it['area_id']).sum())
        it['km2'] = round(px * (grid.WIDTH_KM / width) * (grid.HEIGHT_KM / height))
        print(f"    {it['id']:24} {it['km2']:>9,} km² in India")
    missing = [it['id'] for it in out_items if it['area_id'] not in covered]
    if missing:
        problems.append(f"nothing of these falls inside India: {', '.join(missing)}")
    print(f'    raster {width}x{height} -> {rel} ({size // 1024} KB)')
    return out_items, problems


def validate_height(h):
    """How far a prisms layer stands up: the value range, the km at the top, the key."""
    if not isinstance(h, dict):
        return ['a prisms layer needs a height: { domain, km, legend }']
    p = []
    d = h.get('domain')
    if not (isinstance(d, list) and len(d) == 2 and all(isinstance(n, (int, float)) for n in d)):
        p.append('height.domain must be two numbers')
    elif d[0] >= d[1]:
        p.append('height.domain must ascend')
    if not isinstance(h.get('km'), (int, float)) or h['km'] <= 0:
        p.append('height.km must say how far the top of the range stands up, in km')
    legend = h.get('legend')
    if not (isinstance(legend, list) and legend and all(isinstance(n, (int, float)) for n in legend)):
        p.append('height.legend must list the values the key shows a column for')
    return p


def validate_size(layer):
    """
    A `symbols` layer draws a circle whose area is a value: marker and size go together.
    A `dot` layer may size its beads the same way, or draw them all one size.
    """
    size = layer.get('size')
    if layer.get('marker') in ('symbol', 'dot'):
        if layer.get('type') != 'points':
            return ['only a points layer can draw symbols']
        if not isinstance(size, dict):
            return ['a symbol layer needs a size: { field, domain, range, legend }'] if layer['marker'] == 'symbol' else []
        p = []
        field = size.get('field')
        if field not in (layer.get('fields') or {}):
            p.append(f'size.field {field!r} must be one of the layer\'s own declared fields')
        elif (layer['fields'][field] or {}).get('type') not in ('int', 'number'):
            p.append(f'size.field {field!r} must be a number, so a circle can be sized by it')
        for key in ('domain', 'range'):
            v = size.get(key)
            if not (isinstance(v, list) and len(v) == 2 and all(isinstance(n, (int, float)) for n in v)):
                p.append(f'size.{key} must be two numbers')
            elif v[0] >= v[1]:
                p.append(f'size.{key} must ascend')
        legend = size.get('legend')
        if not (isinstance(legend, list) and legend and all(isinstance(n, (int, float)) for n in legend)):
            p.append('size.legend must list the values the key shows a circle for')
        return p
    if size:
        return ['only a symbol layer has a size']
    return []


def validate_scale(scale):
    """The bands a choropleth colours by: an ascending lower bound and a colour each."""
    if not isinstance(scale, list) or len(scale) < 2:
        return ['scale must list at least two bands']
    p = []
    last = None
    for i, band in enumerate(scale):
        if not isinstance(band.get('from'), (int, float)):
            p.append(f'scale band {i}: from must be a number')
        elif last is not None and band['from'] <= last:
            p.append(f'scale band {i}: from must be greater than the band before it')
        else:
            last = band['from']
        if not isinstance(band.get('color'), str) or not band['color'].startswith('#'):
            p.append(f'scale band {i}: color must be a hex string')
    return p


def build_choropleth(layer, folder, by_iso, by_id):
    """
    values.csv of region,value -> { raster id: value }. Returns (out, problems).

    One file format for both kinds of choropleth: the value is a number for a scale and
    a category id for a categorical one, which is what "value" means for that layer.
    """
    path = os.path.join(folder, 'values.csv')
    if not os.path.exists(path):
        return {}, ['a choropleth needs values.csv beside layer.json']
    values, problems = {}, []
    categorical = layer.get('scale') == CATEGORICAL
    cats = {c['id'] for c in layer.get('categories', [])} if categorical else set()
    with open(path, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    head = [c.strip().lower() for c in rows[0]] if rows else []
    if head[:2] != ['region', 'value']:
        return {}, ['values.csv must start with a region,value header']
    for n, row in enumerate(rows[1:], start=2):
        if not row or not row[0].strip():
            continue
        code = row[0].strip()
        if code not in by_iso:
            problems.append(f'values.csv line {n}: {code} is not an ISO 3166-2:IN code')
            continue
        if categorical:
            value = (row[1].strip() if len(row) > 1 else '')
            if value not in cats:
                problems.append(f"values.csv line {n}: {value!r} is not one of this layer's categories")
                continue
            values[by_iso[code]['id']] = value
            continue
        try:
            values[by_iso[code]['id']] = float(row[1])
        except (IndexError, ValueError):
            problems.append(f'values.csv line {n}: {row[1:2]} is not a number')
    # Regions with no value keep their own clay colour, but say which they are out loud.
    missing = sorted(by_id[i]['iso'] for i in set(by_id) - set(values))
    if missing:
        print(f"    no value for {len(missing)}: {', '.join(missing)}")
    return values, problems


def validate_regional_item(it, cats, by_iso, fields, ids=None, width=0, height=0):
    """
    A regional item belongs to the regions that keep it. It may also name an anchor,
    the one place it is most seen at, so the map has somewhere to draw it: Onam at
    Thrissur, the Hornbill festival at Kisama. Returns (problems, region id at the
    anchor or None).
    """
    tag = it.get('id', '?')
    p = []
    here = None
    a = it.get('anchor')
    if a is not None:
        if not (isinstance(a, dict) and isinstance(a.get('lat'), (int, float)) and isinstance(a.get('lon'), (int, float))):
            p.append(f'{tag}: anchor needs numeric lat and lon')
        elif ids is not None:
            col, row = grid.lonlat_to_pixel(a['lon'], a['lat'], width, height)
            c, r = int(col), int(row)
            here = int(ids[r, c]) if 0 <= r < height and 0 <= c < width else 0
            regions = it.get('regions') or []
            claimed = [by_iso[x]['id'] for x in regions if x in by_iso]
            if not here:
                p.append(f"{tag}: anchor ({a['lat']}, {a['lon']}) falls outside India")
            elif EVERYWHERE not in regions and here not in claimed:
                p.append(f"{tag}: anchor ({a['lat']}, {a['lon']}) falls in region id {here}, not in claimed {regions}")
    if it.get('status') not in STATUSES:
        p.append(f'{tag}: status must be draft or reviewed')
    if not bilingual(it.get('name')):
        p.append(f'{tag}: name needs en and hi')
    if not bilingual(it.get('blurb')):
        p.append(f'{tag}: blurb needs en and hi')
    for lang in ('en', 'hi'):
        if len((it.get('blurb') or {}).get(lang, '')) > BLURB_MAX:
            p.append(f'{tag}: blurb.{lang} longer than {BLURB_MAX} characters')
    if it.get('category') not in cats:
        p.append(f"{tag}: unknown category {it.get('category')!r}")
    if it.get('priority') not in (1, 2, 3):
        p.append(f'{tag}: priority must be 1, 2 or 3')
    regions = it.get('regions') or []
    unknown = [r for r in regions if r != EVERYWHERE and r not in by_iso]
    if not regions or unknown:
        p.append(f'{tag}: regions must be ISO 3166-2:IN codes or {EVERYWHERE!r}, unknown: {unknown}')
    if not it.get('sources') or any(not str(s).startswith('http') for s in it['sources']):
        p.append(f'{tag}: sources must list at least one URL')
    for name, spec in (fields or {}).items():
        v = it.get(name)
        if v is None:
            if spec.get('required'):
                p.append(f'{tag}: {name} is required by the layer')
        elif not isinstance(v, FIELD_TYPES[spec['type']]) or isinstance(v, bool):
            p.append(f"{tag}: {name} must be {spec['type']}")
        elif spec['type'] == 'month' and not 1 <= v <= 12:
            p.append(f'{tag}: {name} must be a month, 1 to 12')
    return p, here


def build_regional(items, cats, by_iso, by_id, fields, ids, width, height):
    """Items that belong to regions rather than to a point on the map."""
    out, problems = [], []
    for it in items:
        p, here = validate_regional_item(it, cats, by_iso, fields, ids, width, height)
        problems += p
        if p:
            continue
        # A festival kept the country over says so once rather than listing 36 codes.
        region_ids = (sorted(by_id) if EVERYWHERE in it['regions']
                      else [by_iso[r]['id'] for r in it['regions']])
        entry = {
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'priority': it['priority'],
            'regions': region_ids, 'regionSlugs': [by_id[i]['slug'] for i in region_ids],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        }
        for name in fields:
            if it.get(name) is not None:
                entry[name] = it[name]
        if here:
            # Drawn as well as listed: the engine's points type reads x, z and region
            # exactly as it does for a place.
            x, z = grid.lonlat_to_scene(it['anchor']['lon'], it['anchor']['lat'])
            entry.update({'x': round(float(x), 1), 'z': round(float(z), 1), 'region': here, 'regionSlug': by_id[here]['slug']})
        out.append(entry)
    return out, problems


def validate_line_item(it, cats, join, fields=()):
    """A line item carries no anchor: its geometry comes from the source."""
    tag = it.get('id', '?')
    p = []
    if it.get('status') not in STATUSES:
        p.append(f'{tag}: status must be draft or reviewed')
    if not bilingual(it.get('name')):
        p.append(f'{tag}: name needs en and hi')
    if not bilingual(it.get('blurb')):
        p.append(f'{tag}: blurb needs en and hi')
    for lang in ('en', 'hi'):
        if len((it.get('blurb') or {}).get(lang, '')) > BLURB_MAX:
            p.append(f'{tag}: blurb.{lang} longer than {BLURB_MAX} characters')
    if it.get('category') not in cats:
        p.append(f"{tag}: unknown category {it.get('category')!r}")
    if it.get('rank') not in (1, 2, 3):
        p.append(f'{tag}: rank must be 1, 2 or 3')
    if it.get('network'):
        # The whole of the source, drawn under the routes that are named. It claims no
        # geometry of its own, so it needs neither waypoints nor a name in the source.
        if it.get('waypoints') or it.get('source_names') or it.get('geometry'):
            p.append(f'{tag}: a network item draws the whole source, so it names no geometry')
    elif join == GENERATED:
        g = it.get('geometry')
        if not isinstance(g, dict):
            p.append(f'{tag}: geometry must say what line to draw')
        elif 'from' in g or 'to' in g:
            # A flow: an arc between two places, optionally bowed.
            ends = [g.get('from'), g.get('to')]
            if any(not isinstance(e, dict) or not all(isinstance(e.get(k), (int, float)) for k in ('lat', 'lon'))
                   for e in ends):
                p.append(f'{tag}: geometry.from and geometry.to each need numeric lat and lon')
            if 'bow' in g and not isinstance(g['bow'], (int, float)):
                p.append(f'{tag}: geometry.bow must be a number')
            if set(g) - {'from', 'to', 'bow'}:
                p.append(f'{tag}: a flow takes from, to and bow, nothing else')
        elif set(g) - {'parallel', 'meridian'} or len(g) != 1:
            p.append(f'{tag}: geometry must be a flow (from/to) or exactly one of parallel or meridian')
        elif not isinstance(list(g.values())[0], (int, float)) or isinstance(list(g.values())[0], bool):
            p.append(f'{tag}: geometry must give a number of degrees')
    elif join == 'route':
        w = it.get('waypoints') or []
        if len(w) < 2:
            p.append(f'{tag}: waypoints must list at least two places for a routed layer')
        elif any(not (isinstance(q.get('lat'), (int, float)) and isinstance(q.get('lon'), (int, float))) for q in w):
            p.append(f'{tag}: every waypoint needs numeric lat and lon')
    elif not it.get('source_names'):
        p.append(f'{tag}: source_names must name at least one feature in the source')
    if not it.get('sources') or any(not str(s).startswith('http') for s in it['sources']):
        p.append(f'{tag}: sources must list at least one URL')
    for name, spec in (fields or {}).items():
        v = it.get(name)
        if v is None:
            if spec.get('required'):
                p.append(f'{tag}: {name} is required by the layer')
        elif not isinstance(v, FIELD_TYPES[spec['type']]) or isinstance(v, bool):
            p.append(f"{tag}: {name} must be {spec['type']}")
        elif spec['type'] == 'name' and not bilingual(v):
            p.append(f'{tag}: {name} needs en and hi')
    return p


def build_lines(layer, folder, items, cats, fields, ids, heights):
    """Join each curated item to its geometry. Returns (out_items, problems)."""
    src = layer['source']
    join = src.get('join', 'name')
    raw = os.path.join(fetch.RAW, 'layers', layer['id'])
    # A named source is indexed by name; a nameless one becomes a graph to walk; a
    # generated one has no source to load at all.
    index = {}
    # A network item draws every part of the source; a routed layer walks a graph built
    # from the same parts, so they are loaded once between them.
    parts = lines.load_parts(src, raw) if (join == 'route' or any(it.get('network') for it in items)) else []
    if join == 'route':
        index = lines.network(parts, ids, [w for it in items for w in (it.get('waypoints') or [])])
    elif join != GENERATED:
        index = lines.load_source(src, raw)
    if join == 'route':
        print(f"    network: {len(index['parts'])} parts, {len(index['nodes'])} junctions inside India")
    # A layer that animates its flow needs its runs pointed downstream -- but only one
    # that is drawing water. An arrow already knows which way it goes, it was given from
    # and to; fitting it against the heightmap turned the monsoon round and had it
    # arriving from Kerala into the Arabian Sea.
    relief = heights() if layer.get('flow') and not layer.get('arrows') else None
    out, problems = [], []
    for it in items:
        problems += validate_line_item(it, cats, join, fields)
        if problems and problems[-1].startswith(str(it.get('id'))):
            continue
        if it.get('network'):
            runs = lines.project(parts, ids, float(src.get('simplify_km', 1.0)))
            km = sum(float(np.hypot(*np.diff(r, axis=0).T).sum()) for r in runs)
            note = None
        else:
            runs, km, note = lines.build(it, index, ids, float(src.get('simplify_km', 1.0)), relief,
                                         clip=not layer.get('arrows'))
        if not runs:
            why = (note or {}).get('why') or (f"names {it['source_names']}" if join == 'name' else 'nothing came back')
            problems.append(f"{it['id']}: no geometry: {why}")
            continue
        widths = None
        # An arrows layer ships a width profile per run, which is what shapes the head,
        # and the head brings vertices of its own: see shape_arrow.
        if layer.get('arrows'):
            shaped = [lines.shape_arrow(r) for r in runs]
            runs = [r for r, _ in shaped]
            widths = [[round(float(w), 3) for w in ws] for _, ws in shaped]
        entry = {
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'rank': it['rank'],
            'km': round(km, 1),
            'lines': [[round(float(v), 1) for v in r.reshape(-1)] for r in runs],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        }
        if widths:
            entry['widths'] = widths
        for name in fields:                      # the columns the layer declared for itself
            if it.get(name) is not None:
                entry[name] = it[name]
        out.append(entry)
        tail = f"  waypoints {max(note['snap']):.0f} km off at worst" if note else ''
        print(f"    {it['id']:20} rank {it['rank']}  {len(runs):3d} runs  {sum(len(r) for r in runs):5d} pts  {km:7.0f} km{tail}")
    return out, problems


def validate_model(name, m):
    """A figurine recipe: a few primitives, each placed, turned, scaled and coloured."""
    p = []
    if m.get('id') != name:
        p.append(f'model {name}: id must equal the file name')
    fp = m.get('footprint', 1)
    if not isinstance(fp, (int, float)) or fp <= 0:
        p.append(f'model {name}: footprint must be a positive number (the shadow\'s radius, in model units)')
    parts = m.get('parts')
    if not isinstance(parts, list) or not parts:
        p.append(f'model {name}: parts must list at least one shape')
        return p
    for i, part in enumerate(parts):
        where = f'model {name} part {i}'
        shape = part.get('shape')
        if shape not in SHAPES:
            p.append(f'{where}: shape must be one of {tuple(SHAPES)}')
            continue
        for key in SHAPES[shape]:
            v = part.get(key)
            if key in ('profile', 'outline'):
                ok = isinstance(v, list) and len(v) >= 3 and all(
                    isinstance(q, list) and len(q) == 2 and all(isinstance(n, (int, float)) for n in q) for q in v)
            else:
                ok = isinstance(v, (int, float)) and v > 0
            if not ok:
                p.append(f'{where}: {shape} needs {key}')
        if not isinstance(part.get('color'), str) or not re.match(r'^#[0-9a-fA-F]{6}$', part['color']):
            p.append(f'{where}: color must be a six-digit hex colour')
        for key in ('at', 'rot', 'scale'):
            v = part.get(key)
            if v is not None and not (isinstance(v, list) and len(v) == 3 and all(isinstance(n, (int, float)) for n in v)):
                p.append(f'{where}: {key} must be three numbers')
        for key in ('segments',):
            v = part.get(key)
            if v is not None and not (isinstance(v, int) and 3 <= v <= 64):
                p.append(f'{where}: segments must be an integer from 3 to 64')
    return p


def load_models():
    """Every recipe under content/models/, validated. Returns ({name: recipe}, problems)."""
    models, problems = {}, []
    if not os.path.isdir(MODELS_DIR):
        return models, problems
    for n in sorted(os.listdir(MODELS_DIR)):
        if not n.endswith('.json'):
            continue
        name = n[:-5]
        with open(os.path.join(MODELS_DIR, n), encoding='utf-8') as f:
            m = json.load(f)
        p = validate_model(name, m)
        problems += p
        if not p:
            models[name] = m
    return models, problems


def write_models(models, out):
    """The recipes ship as they are, minified: a few hundred bytes each."""
    d = os.path.join(out, 'models')
    os.makedirs(d, exist_ok=True)
    for n in os.listdir(d):
        if n.endswith('.json') and n[:-5] not in models:
            os.remove(os.path.join(d, n))
    for name, m in models.items():
        data = {k: m[k] for k in ('id', 'footprint', 'parts') if k in m}
        with open(os.path.join(d, f'{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if models:
        print(f"models: {len(models)} recipes -> public/data/models/")


def resolve_models(layer, out_items, models):
    """A model layer's items each name a recipe: their own, their category's, or the layer's."""
    p = []
    by_cat = {c['id']: c.get('model') for c in layer.get('categories', [])}
    for it in out_items:
        name = it.get('model') or by_cat.get(it['category']) or layer.get('model')
        if not name:
            p.append(f"{it['id']}: no model: give the item, its category or the layer one")
        elif name not in models:
            p.append(f"{it['id']}: no recipe content/models/{name}.json")
        else:
            it['model'] = name
    return p


# --- a points layer generated from GeoNames, merged with what is curated by hand
GEONAMES_URL = 'https://download.geonames.org/export/dump/{dump}.zip'
GEONAMES_DUMPS = ('cities15000', 'cities5000', 'cities1000')   # the floor each dump's name states
WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
FEATURE_CATEGORY = {'PPLC': 'national', 'PPLA': 'capital'}      # any other populated place is a city
SKIP_FEATURES = ('PPLX', 'PPLQ', 'PPLR', 'PPLF', 'PPLL', 'PPLW', 'PPLH')   # a section of a place, abandoned, religious, a farm, a locality
# GeoNames sometimes files a district under a town's name with the district's population.
# Wikidata knows what a thing is, so a candidate whose item is one of these is not a town.
NOT_A_TOWN = ('district', 'taluk', 'tehsil', 'tahsil', 'mandal', 'subdistrict', 'sub-district',
              'block', 'division', 'metropolitan area', 'urban agglomeration', 'municipality of')
POOL = 5     # candidates looked up per region, as a multiple of the number wanted:
             # most of the loss is towns GeoNames has and Wikidata has never heard of,
             # so the pool has to be several times the number that will survive it.


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().strip()


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', fold(s)).strip('-')


def wikidata_lookup(gids, raw):
    """
    What Wikidata says about a set of GeoNames ids: the item, its Hindi name, its
    population and what it is. Asked a batch at a time and cached a batch at a time, so a
    run that meets a timeout resumes rather than restarts.
    """
    def query_for(batch):
        vals = ' '.join(f'"{g}"' for g in batch)
        return ('SELECT ?gn ?item ?hi ?pop ?clsLabel WHERE { VALUES ?gn { ' + vals + ' } '
                '?item wdt:P1566 ?gn . OPTIONAL { ?item rdfs:label ?hi FILTER(LANG(?hi)="hi") } '
                'OPTIONAL { ?item wdt:P1082 ?pop } '
                'OPTIONAL { ?item wdt:P31 ?cls . ?cls rdfs:label ?clsLabel FILTER(LANG(?clsLabel)="en") } }')
    out = {}
    for b in wikidata.batched(gids, query_for, os.path.join(raw, 'wikidata'), 'towns', 'towns'):
        gn = b['gn']['value']
        rec = out.setdefault(gn, {'item': b['item']['value'].rsplit('/', 1)[-1], 'hi': None, 'pop': None, 'classes': []})
        if 'hi' in b and not rec['hi']:
            rec['hi'] = b['hi']['value']
        if 'pop' in b:
            try:
                rec['pop'] = max(rec['pop'] or 0, int(float(b['pop']['value'])))
            except ValueError:
                pass
        if 'clsLabel' in b and b['clsLabel']['value'] not in rec['classes']:
            rec['classes'].append(b['clsLabel']['value'])
    return out


def build_geonames(layer, curated, cats, fields, ids, by_id, out_items):
    """
    The biggest towns of every region from GeoNames, checked against Wikidata, with the
    curated items laid over them. Returns (out_items, problems).

    GeoNames gives the candidates, ranked by its population; the ID raster says which
    region each stands in; Wikidata then vouches for each one -- it must have an item,
    that item must not be a district or a taluk filed under a town's name, and it must
    carry the town's name in Hindi, or it does not ship. Where Wikidata has a population
    it wins, since GeoNames' figure is the one most often wrong.
    """
    src = layer['source']
    per = int(src.get('top_per_region', 10))
    minpop = int(src.get('min_population', 0))
    raw = os.path.join(fetch.RAW, 'geonames')
    dump = src.get('dump', 'cities15000')
    fetch.download(GEONAMES_URL.format(dump=dump), os.path.join(raw, f'{dump}.zip'), quiet=True)
    height, width = ids.shape
    rows = []
    with zipfile.ZipFile(os.path.join(raw, f'{dump}.zip')) as z, z.open(f'{dump}.txt') as f:
        for line in io.TextIOWrapper(f, encoding='utf-8'):
            q = line.rstrip('\n').split('\t')
            if q[8] != 'IN' or not q[7].startswith('PPL') or q[7] in SKIP_FEATURES:
                continue
            col, row = grid.lonlat_to_pixel(float(q[5]), float(q[4]), width, height)
            c, r = int(col), int(row)
            region = int(ids[r, c]) if 0 <= r < height and 0 <= c < width else 0
            if region:
                rows.append({'gid': q[0], 'name': q[2] or q[1], 'lat': float(q[4]), 'lon': float(q[5]),
                             'feature': q[7], 'pop': int(q[14] or 0), 'region': region})
    by_region = {}
    for row in rows:
        by_region.setdefault(row['region'], []).append(row)
    pool = []
    for region, lst in by_region.items():
        lst.sort(key=lambda r: -r['pop'])
        pool += lst[:per * POOL]
    wd = wikidata_lookup([r['gid'] for r in pool], raw)
    kept = {}
    dropped = {'no item': 0, 'no hindi name': 0, 'not a town': 0, 'too small': 0}
    for row in pool:
        w = wd.get(row['gid'])
        if not w:
            dropped['no item'] += 1
            continue
        if any(word in cls.lower() for cls in w['classes'] for word in NOT_A_TOWN):
            dropped['not a town'] += 1
            continue
        if not w['hi']:
            dropped['no hindi name'] += 1
            continue
        pop = w['pop'] or row['pop']
        if pop < minpop:
            dropped['too small'] += 1
            continue
        kept.setdefault(row['region'], []).append({**row, 'pop': pop, 'hi': w['hi'], 'item': w['item']})
    # The curated items claim their names first: whatever was written by hand wins over
    # the generated row for the same town, and the generated set fills in around it.
    taken = {(it['region'], fold(it['name']['en'])) for it in out_items}
    seen_ids = {it['id'] for it in out_items}
    field = (layer.get('size') or {}).get('field')
    added = 0
    for region, lst in sorted(kept.items()):
        lst.sort(key=lambda r: -r['pop'])
        rank = 0
        for row in lst:
            if rank >= per:
                break
            if (region, fold(row['name'])) in taken:
                rank += 1
                continue
            rank += 1
            slug = slugify(row['name'])
            if slug in seen_ids:
                slug = f"{slug}-{by_id[region]['slug']}"
            if slug in seen_ids:
                slug = f"{slug}-{row['gid']}"
            seen_ids.add(slug)
            taken.add((region, fold(row['name'])))
            category = FEATURE_CATEGORY.get(row['feature'], 'city')
            if category not in cats:
                category = 'city'
            x, z = grid.lonlat_to_scene(row['lon'], row['lat'])
            entry = {
                'id': slug, 'name': {'en': row['name'], 'hi': row['hi']}, 'category': category,
                # The capital and the three biggest towns of a state are worth a name at the
                # middle zooms; the rest arrive close up.
                'priority': 2 if category != 'city' or rank <= 3 else 3,
                'x': round(float(x), 1), 'z': round(float(z), 1), 'region': region, 'regionSlug': by_id[region]['slug'],
                'sources': [f"https://www.geonames.org/{row['gid']}", f"https://www.wikidata.org/wiki/{row['item']}"],
                'status': 'reviewed' if src.get('trust') else 'draft',
            }
            if field:
                entry[field] = int(row['pop'])
            out_items.append(entry)
            added += 1
    covered = sorted(by_id[r]['slug'] for r in kept)
    print(f"    geonames: {len(rows)} towns in India, {len(pool)} looked up, {added} added, "
          f"{len(by_id) - len(covered)} regions without one; dropped " + ', '.join(f'{v} {k}' for k, v in dropped.items()))
    return out_items, []


# --- India's districts: two drawings from one source (PLAN.md section 7, "District boundaries")
DISTRICT_CACHE = {}


def district_records(ids):
    """The district source, read once however many layers draw from it."""
    if 'd' not in DISTRICT_CACHE:
        DISTRICT_CACHE['d'] = districts_lib.load(ids)
    return DISTRICT_CACHE['d']


def build_district_points(layer, curated, cats, fields, ids, by_id, out_items):
    """
    A name inside every district, with its headquarters and its figures on the card.

    The source carries English names and codes; Wikidata carries the name in Hindi, the
    headquarters, the population and the area, joined on the district's LGD code. The
    couple of dozen districts too new for a Hindi label on Wikidata are named by hand in
    this layer's own items.json, matched on the same code.
    """
    recs, _arcs = district_records(ids)
    by_lgd, by_source_name = {}, {}
    for it in curated:
        if not bilingual(it.get('name')):
            return out_items, [f"{it.get('id', '?')}: name needs en and hi"]
        # Keyed by the LGD code, which is what the two sources meet on. The two polygons
        # of Pakistan-occupied Kashmir have no code -- nobody administers them, so nobody
        # numbered them -- and are matched by the name the source files them under.
        if it.get('lgd'):
            by_lgd[int(it['lgd'])] = it
        elif it.get('source_name'):
            by_source_name[fold(it['source_name'])] = it
        else:
            return out_items, [f"{it.get('id', '?')}: a curated district needs an lgd code or a source_name"]
    pok = 'not-administered' if 'not-administered' in cats else sorted(cats)[0]
    plain = 'district' if 'district' in cats else pok
    out, unnamed = [], []
    seen = set()
    for rec in recs:
        hand = by_lgd.get(rec['lgd']) if rec['lgd'] else by_source_name.get(fold(rec['name_en']))
        name_hi = (hand or {}).get('name', {}).get('hi') or rec['name_hi']
        name_en = (hand or {}).get('name', {}).get('en') or rec['name_en']
        if not name_hi:
            unnamed.append(name_en)
            continue                      # its boundary still draws; an unnamed label would not
        slug = slugify(name_en)
        if slug in seen:
            slug = f"{slug}-{by_id[rec['region']]['slug']}" if rec['region'] else slug
        if slug in seen:
            slug = f"{slug}-{rec['lgd']}"
        seen.add(slug)
        entry = {
            'id': slug, 'name': {'en': name_en, 'hi': name_hi},
            'category': plain if rec['lgd'] else pok,
            'priority': 3,                # a district is close-up detail; the state name owns the wide views
            'x': round(rec['anchor'][0], 1), 'z': round(rec['anchor'][1], 1),
            'region': rec['region'], 'regionSlug': by_id[rec['region']]['slug'],
            'sources': [districts_lib.CATALOGUE_URL]
                       + ([f"https://www.wikidata.org/wiki/{rec['item']}"] if rec['item'] else []),
            'status': 'draft',
        }
        if (hand or {}).get('blurb'):
            entry['blurb'] = hand['blurb']
        if rec['hq_en'] and rec['hq_hi'] and 'headquarters' in fields:
            entry['headquarters'] = {'en': rec['hq_en'], 'hi': rec['hq_hi']}
        for key, field in (('population', 'population'), ('area_km2', 'area_km2'), ('lgd', 'lgd')):
            if field in fields and rec[key]:
                entry[field] = int(rec[key])
        out.append(entry)
    out_items.extend(out)
    print(f'    districts: {len(recs)} polygons, {len(out)} lettered, {len(unnamed)} without a name in Hindi'
          + (f" ({', '.join(unnamed[:6])}{'...' if len(unnamed) > 6 else ''})" if unnamed else ''))
    return out_items, []


def build_district_lines(layer, cats, fields, ids, by_id):
    """
    The district mesh, one item per state: the lines *inside* a state, never its own edge.

    A shared arc is the point of the TopoJSON. Every boundary is stored once, so the line
    between two districts is drawn once however many districts meet along it. An arc is
    kept only when it has a district on each side and both are in the same state: an arc
    with one side is the coast or the international border, and one whose sides fall in
    two states is the state border. The model draws both of those itself, and inking them
    again only thickens them.
    """
    recs, arcs = district_records(ids)
    owners = {}
    for n, rec in enumerate(recs):
        for a in rec['arcs']:
            owners.setdefault(a, []).append(n)
    inside = {}
    for a, sides in owners.items():
        if len(sides) != 2:
            continue
        regions = {recs[n]['region'] for n in sides}
        if len(regions) == 1 and 0 not in regions:
            inside.setdefault(next(iter(regions)), []).append(arcs[a])
    counts = {}
    for rec in recs:
        counts[rec['region']] = counts.get(rec['region'], 0) + 1
    category = 'border' if 'border' in cats else sorted(cats)[0]
    simplify = float((layer.get('source') or {}).get('simplify_km', 1.5))
    out, drawn = [], 0
    for region, parts in sorted(inside.items()):
        unit = by_id.get(region)
        if not unit:
            continue
        runs = lines.project(parts, ids, simplify)
        if not runs:
            continue
        drawn += sum(len(r) for r in runs)
        n = counts.get(region, 0)
        out.append({
            'id': f"{unit['slug']}-districts", 'name': {
                'en': f"Districts of {unit['name']['en']}", 'hi': f"{unit['name']['hi']} के ज़िले"},
            'category': category, 'rank': 3,
            'km': round(sum(float(np.hypot(*np.diff(r, axis=0).T).sum()) for r in runs), 1),
            'lines': [[round(float(v), 1) for v in r.reshape(-1)] for r in runs],
            'blurb': {
                'en': f"{unit['name']['en']} is divided into {n} districts. The lines are the boundaries "
                      f"between them; the state's own edge is drawn by the model itself.",
                'hi': f"{unit['name']['hi']} {n} ज़िलों में बँटा है। ये रेखाएँ उनके बीच की सीमाएँ हैं; "
                      f"राज्य की अपनी सीमा मॉडल स्वयं खींचता है।"},
            'sources': [districts_lib.CATALOGUE_URL],
            'status': 'draft',
        })
        if 'districts' in fields:
            out[-1]['districts'] = n
    print(f'    districts: {len(out)} states, {len(inside)} arc groups, {drawn} points inside state lines')
    return out, []


def validate_item(it, cats, by_iso, ids, width, height, fields):
    tag = it.get('id', '?')
    p = []
    if it.get('status') not in STATUSES:
        p.append(f'{tag}: status must be draft or reviewed')
    if not bilingual(it.get('name')):
        p.append(f'{tag}: name needs en and hi')
    if not bilingual(it.get('blurb')):
        p.append(f'{tag}: blurb needs en and hi')
    for lang in ('en', 'hi'):
        if len((it.get('blurb') or {}).get(lang, '')) > BLURB_MAX:
            p.append(f'{tag}: blurb.{lang} longer than {BLURB_MAX} characters')
    if it.get('category') not in cats:
        p.append(f"{tag}: unknown category {it.get('category')!r}")
    if it.get('priority') not in (1, 2, 3):
        p.append(f'{tag}: priority must be 1, 2 or 3')
    if not it.get('sources') or any(not str(s).startswith('http') for s in it['sources']):
        p.append(f'{tag}: sources must list at least one URL')
    for name, spec in fields.items():
        v = it.get(name)
        if v is None:
            if spec.get('required'):
                p.append(f'{tag}: {name} is required by the layer')
        elif not isinstance(v, FIELD_TYPES[spec['type']]) or isinstance(v, bool):
            p.append(f"{tag}: {name} must be {spec['type']}")
    # A figurine's own recipe and tint, on a `model` layer (validated against the recipes later).
    if it.get('model') is not None and not isinstance(it['model'], str):
        p.append(f'{tag}: model must name a recipe under content/models')
    if it.get('color') is not None and not (isinstance(it['color'], str) and re.match(r'^#[0-9a-fA-F]{6}$', it['color'])):
        p.append(f'{tag}: color must be a six-digit hex colour')
    a = it.get('anchor') or {}
    if not (isinstance(a.get('lat'), (int, float)) and isinstance(a.get('lon'), (int, float))):
        p.append(f'{tag}: anchor needs numeric lat and lon')
        return p, None
    regions = it.get('regions') or []
    unknown = [r for r in regions if r not in by_iso]
    if not regions or unknown:
        p.append(f'{tag}: regions must be ISO 3166-2:IN codes, unknown: {unknown}')
        return p, None
    col, row = grid.lonlat_to_pixel(a['lon'], a['lat'], width, height)
    c, r = int(col), int(row)
    here = int(ids[r, c]) if 0 <= r < height and 0 <= c < width else 0
    claimed = [by_iso[x]['id'] for x in regions]
    if here not in claimed:
        p.append(f"{tag}: anchor ({a['lat']}, {a['lon']}) falls in region id {here}, not in claimed {regions}")
    return p, here


def build_layer(folder, states, ids, heights, out, registry, models):
    with open(os.path.join(folder, 'layer.json'), encoding='utf-8') as f:
        layer = json.load(f)
    problems = validate_layer(layer, folder, registry)
    items_path = os.path.join(folder, 'items.json')
    items = json.load(open(items_path, encoding='utf-8')) if os.path.exists(items_path) else []
    cats = {c['id'] for c in layer.get('categories', [])}
    fields = layer.get('fields') or {}
    by_iso = {u['iso']: u for u in states['units']}
    by_id = {u['id']: u for u in states['units']}
    height, width = ids.shape
    seen = set()
    out_items = []
    if layer.get('type') == 'regional' and not problems:
        out_items, region_problems = build_regional(items, cats, by_iso, by_id, fields, ids, width, height)
        problems += region_problems
        # Whether it has anywhere to be drawn. A regional layer whose items name the place
        # they are most seen at is drawn there as tokens; one whose items do not is read in
        # the state cards alone, and its colours appear nowhere on the map -- which is what
        # the key needs to know before it offers a reader a row of swatches.
        anchored = any('x' in i for i in out_items)
        return finish(layer, out_items, out, problems, order=lambda i: (i['priority'], i['id']),
                      extra={'anchored': anchored})
    if layer.get('type') == 'prisms' and not problems:
        values, prism_problems = build_choropleth(layer, folder, by_iso, by_id)
        problems += prism_problems
        return finish(layer, [], out, problems, order=lambda i: i['id'], extra={'values': values})
    if layer.get('type') == 'choropleth' and not problems:
        values, choro_problems = build_choropleth(layer, folder, by_iso, by_id)
        problems += choro_problems
        return finish(layer, [], out, problems, order=lambda i: i['id'], extra={'values': values})
    if layer.get('type') == 'areas' and not problems:
        out_items, area_problems = build_areas(layer, folder, items, cats, fields, ids, out)
        problems += area_problems
        return finish(layer, out_items, out, problems, order=lambda i: (i['rank'], i['id']),
                      extra={'raster': f'layers/{layer["id"]}-areas.bin.gz'})
    if layer.get('type') == 'lines' and not problems:
        if (layer.get('source') or {}).get('format') == DISTRICTS:
            out_items, line_problems = build_district_lines(layer, cats, fields, ids, by_id)
        else:
            out_items, line_problems = build_lines(layer, folder, items, cats, fields, ids, heights)
        problems += line_problems
        return finish(layer, out_items, out, problems, order=lambda i: (i['rank'], i['id']))
    generated = (layer.get('source') or {}).get('format') == DISTRICTS
    for it in ([] if generated else items):
        if it.get('id') in seen:
            problems.append(f"{it.get('id')}: duplicate id")
        seen.add(it.get('id'))
        p, region = validate_item(it, cats, by_iso, ids, width, height, fields)
        problems += p
        if p:
            continue
        x, z = grid.lonlat_to_scene(it['anchor']['lon'], it['anchor']['lat'])
        entry = {
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'priority': it['priority'],
            'x': round(float(x), 1), 'z': round(float(z), 1), 'region': region, 'regionSlug': by_id[region]['slug'],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        }
        for name in fields:
            if it.get(name) is not None:
                entry[name] = it[name]
        for key in ('model', 'color'):
            if it.get(key):
                entry[key] = it[key]
        out_items.append(entry)
    if layer.get('source') and not problems:
        if layer['source'].get('format') == DISTRICTS:
            out_items, gen_problems = build_district_points(layer, items, cats, fields, ids, by_id, out_items)
        else:
            out_items, gen_problems = build_geonames(layer, items, cats, fields, ids, by_id, out_items)
        problems += gen_problems
    if layer.get('marker') == 'model' and not problems:
        problems += resolve_models(layer, out_items, models)
    # Tokens are written most important first, so the thinning keeps those. A symbol's
    # importance is its value, and the biggest circle should claim its space before the
    # circle it would otherwise hide behind.
    if layer.get('marker') in ('symbol', 'dot') and (layer.get('size') or {}).get('field'):
        field = (layer.get('size') or {}).get('field')
        order = lambda i: (-(i.get(field) or 0), i['id'])    # noqa: E731
    else:
        order = lambda i: (i['priority'], i['id'])           # noqa: E731
    return finish(layer, out_items, out, problems, order=order)


def finish(layer, out_items, out, problems, order, extra=None):
    """Write public/data/layers/<id>.json, whatever the type put in out_items."""
    if problems:
        return layer, None, problems
    out_items.sort(key=order)
    # `attribution` stays in content/layers/<id>/layer.json and is not shipped: it says what
    # the build did with the source, for whoever edits the layer. What the reader is owed --
    # who published it, under what licence -- is the registry's job now, and saying it twice
    # is the sprawl the registry exists to stop.
    data = {k: layer[k] for k in ('id', 'type', 'marker', 'model', 'flow', 'float', 'size', 'title', 'icon', 'group', 'categories',
                                  'fields', 'scale', 'height', 'arrows', 'unit', 'note', 'sources') if k in layer}
    data['default_on'] = bool(layer.get('default_on'))
    data['count'] = len(out_items)
    data['reviewed'] = sum(1 for i in out_items if i['status'] == 'reviewed')
    data['items'] = out_items
    if extra:
        data.update(extra)
        data['count'] = len(extra.get('values', out_items))
    os.makedirs(os.path.join(out, 'layers'), exist_ok=True)
    path = os.path.join(out, 'layers', f"{layer['id']}.json")
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    return layer, path, []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    args = ap.parse_args()
    root = os.path.join(ROOT, 'content', 'layers')
    if not os.path.isdir(root):
        print('no content/layers')
        return
    registry = sources_lib.load(ROOT)
    states, ids = load_states(args.out)
    heights = height_loader(args.out, states)
    failed = False
    models, model_problems = load_models()
    if model_problems:
        failed = True
        print(f'content/models: {len(model_problems)} problem(s)')
        for p in model_problems:
            print('  ' + p)
    write_models(models, args.out)
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if not os.path.isfile(os.path.join(folder, 'layer.json')):
            continue
        layer, path, problems = build_layer(folder, states, ids, heights, args.out, registry, models)
        if problems:
            failed = True
            print(f'{name}: {len(problems)} problem(s)')
            for p in problems:
                print('  ' + p)
        else:
            data = json.load(open(path, encoding='utf-8'))
            what = 'regions' if data['type'] == 'choropleth' else 'items'
            print(f"{name}: {data['count']} {what} -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)")
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
