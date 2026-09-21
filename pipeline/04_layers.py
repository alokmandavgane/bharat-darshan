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
  regional a list per region: items belong to the states that keep them and carry no
           anchor, so they are read in the state view rather than drawn on the map
The engine knows types, never layer ids.
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import fetch, grid, lines, pack  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = ('points', 'lines', 'choropleth', 'regional')
JOINS = ('name', 'route')   # how a lines item finds its geometry: by the source's names, or through waypoints
STATUSES = ('draft', 'reviewed')
# Structured columns a layer can add on top of the base item schema (PLAN.md section 5).
FIELD_TYPES = {'int': int, 'number': (int, float), 'text': str, 'year': int, 'month': int}
BLURB_MAX = 240
EVERYWHERE = '*'     # a regional item kept across the whole country


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


def validate_layer(layer, folder):
    p = []
    if layer.get('id') != os.path.basename(folder):
        p.append('layer.id must equal the folder name')
    if layer.get('type') not in TYPES:
        p.append(f"layer.type must be one of {TYPES}")
    if not bilingual(layer.get('title')):
        p.append('layer.title needs en and hi')
    cats = layer.get('categories') or []
    # A choropleth is coloured by a scale, not sorted into categories.
    if layer.get('type') == 'choropleth':
        if cats:
            p.append('a choropleth has a scale, not categories')
        p += validate_scale(layer.get('scale'))
        if not bilingual(layer.get('unit')):
            p.append('a choropleth needs a bilingual unit template, e.g. "{n} per km²"')
    elif not cats or any(not (c.get('id') and bilingual(c.get('title'))) for c in cats):
        p.append('categories need id and a bilingual title')
    if layer.get('type') == 'lines':
        src = layer.get('source') or {}
        if not src.get('files') or not src.get('format'):
            p.append('a lines layer needs source.format and source.files')
        if src.get('join', 'name') not in JOINS:
            p.append(f"source.join must be one of {JOINS}")
    elif layer.get('flow'):
        p.append('only a lines layer can set flow')
    for name, spec in (layer.get('fields') or {}).items():
        if spec.get('type') not in FIELD_TYPES:
            p.append(f'field {name}: type must be one of {FIELD_TYPES}')
        if not bilingual(spec.get('label')):
            p.append(f'field {name}: label needs en and hi')
    return p


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
    """values.csv of region,value -> { raster id: value }. Returns (out, problems)."""
    path = os.path.join(folder, 'values.csv')
    if not os.path.exists(path):
        return {}, ['a choropleth needs values.csv beside layer.json']
    values, problems = {}, []
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
        try:
            values[by_iso[code]['id']] = float(row[1])
        except (IndexError, ValueError):
            problems.append(f'values.csv line {n}: {row[1:2]} is not a number')
    # Regions with no value keep their own clay colour, but say which they are out loud.
    missing = sorted(by_id[i]['iso'] for i in set(by_id) - set(values))
    if missing:
        print(f"    no value for {len(missing)}: {', '.join(missing)}")
    return values, problems


def validate_regional_item(it, cats, by_iso, fields):
    """A regional item has no anchor: it belongs to the regions that keep it."""
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
    return p


def build_regional(items, cats, by_iso, by_id, fields):
    """Items that belong to regions rather than to a point on the map."""
    out, problems = [], []
    for it in items:
        p = validate_regional_item(it, cats, by_iso, fields)
        problems += p
        if p:
            continue
        # A festival kept the country over says so once rather than listing 36 codes.
        ids = (sorted(by_id) if EVERYWHERE in it['regions']
               else [by_iso[r]['id'] for r in it['regions']])
        entry = {
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'priority': it['priority'],
            'regions': ids, 'regionSlugs': [by_id[i]['slug'] for i in ids],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        }
        for name in fields:
            if it.get(name) is not None:
                entry[name] = it[name]
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
    if join == 'route':
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
    return p


def build_lines(layer, folder, items, cats, fields, ids, heights):
    """Join each curated item to its geometry. Returns (out_items, problems)."""
    src = layer['source']
    join = src.get('join', 'name')
    raw = os.path.join(fetch.RAW, 'layers', layer['id'])
    # A named source is indexed by name; a nameless one becomes a graph to walk.
    index = (lines.network(lines.load_parts(src, raw), ids,
                           [w for it in items for w in (it.get('waypoints') or [])])
             if join == 'route' else lines.load_source(src, raw))
    if join == 'route':
        print(f"    network: {len(index['parts'])} parts, {len(index['nodes'])} junctions inside India")
    # A layer that animates its flow needs its runs pointed downstream; nothing else does.
    relief = heights() if layer.get('flow') else None
    out, problems = [], []
    for it in items:
        problems += validate_line_item(it, cats, join, fields)
        if problems and problems[-1].startswith(str(it.get('id'))):
            continue
        runs, km, note = lines.build(it, index, ids, float(src.get('simplify_km', 1.0)), relief)
        if not runs:
            why = (note or {}).get('why') or (f"names {it['source_names']}" if join == 'name' else 'nothing came back')
            problems.append(f"{it['id']}: no geometry: {why}")
            continue
        entry = {
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'rank': it['rank'],
            'km': round(km, 1),
            'lines': [[round(float(v), 1) for v in r.reshape(-1)] for r in runs],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        }
        for name in fields:                      # the columns the layer declared for itself
            if it.get(name) is not None:
                entry[name] = it[name]
        out.append(entry)
        tail = f"  waypoints {max(note['snap']):.0f} km off at worst" if note else ''
        print(f"    {it['id']:20} rank {it['rank']}  {len(runs):3d} runs  {sum(len(r) for r in runs):5d} pts  {km:7.0f} km{tail}")
    return out, problems


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


def build_layer(folder, states, ids, heights, out):
    with open(os.path.join(folder, 'layer.json'), encoding='utf-8') as f:
        layer = json.load(f)
    problems = validate_layer(layer, folder)
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
        out_items, region_problems = build_regional(items, cats, by_iso, by_id, fields)
        problems += region_problems
        return finish(layer, out_items, out, problems, order=lambda i: (i['priority'], i['id']))
    if layer.get('type') == 'choropleth' and not problems:
        values, choro_problems = build_choropleth(layer, folder, by_iso, by_id)
        problems += choro_problems
        return finish(layer, [], out, problems, order=lambda i: i['id'], extra={'values': values})
    if layer.get('type') == 'lines' and not problems:
        out_items, line_problems = build_lines(layer, folder, items, cats, fields, ids, heights)
        problems += line_problems
        return finish(layer, out_items, out, problems, order=lambda i: (i['rank'], i['id']))
    for it in items:
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
        out_items.append(entry)
    return finish(layer, out_items, out, problems, order=lambda i: (i['priority'], i['id']))


def finish(layer, out_items, out, problems, order, extra=None):
    """Write public/data/layers/<id>.json, whatever the type put in out_items."""
    if problems:
        return layer, None, problems
    out_items.sort(key=order)
    data = {k: layer[k] for k in ('id', 'type', 'marker', 'flow', 'title', 'icon', 'group', 'categories',
                                  'fields', 'scale', 'unit', 'note', 'sources', 'attribution') if k in layer}
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
    states, ids = load_states(args.out)
    heights = height_loader(args.out, states)
    failed = False
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if not os.path.isfile(os.path.join(folder, 'layer.json')):
            continue
        layer, path, problems = build_layer(folder, states, ids, heights, args.out)
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
