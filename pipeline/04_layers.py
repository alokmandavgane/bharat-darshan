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
  lines    geometry fetched from the source named in layer.json and joined to the curated
           items by name, then projected, clipped to India and simplified
The engine knows types, never layer ids.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import fetch, grid, lines, pack  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TYPES = ('points', 'lines')
STATUSES = ('draft', 'reviewed')
BLURB_MAX = 240


def bilingual(v):
    return isinstance(v, dict) and bool(v.get('en')) and bool(v.get('hi'))


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
    if not cats or any(not (c.get('id') and bilingual(c.get('title'))) for c in cats):
        p.append('categories need id and a bilingual title')
    if layer.get('type') == 'lines':
        src = layer.get('source') or {}
        if not src.get('files') or not src.get('format'):
            p.append('a lines layer needs source.format and source.files')
    return p


def validate_line_item(it, cats):
    """A line item carries no anchor: its geometry comes from the source, by name."""
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
    if not it.get('source_names'):
        p.append(f'{tag}: source_names must name at least one feature in the source')
    if not it.get('sources') or any(not str(s).startswith('http') for s in it['sources']):
        p.append(f'{tag}: sources must list at least one URL')
    return p


def build_lines(layer, folder, items, cats, ids):
    """Join each curated item to its geometry. Returns (out_items, problems)."""
    src = layer['source']
    raw = os.path.join(fetch.RAW, 'layers', layer['id'])
    by_name = lines.load_source(src, raw)
    out, problems = [], []
    for it in items:
        problems += validate_line_item(it, cats)
        if problems and problems[-1].startswith(str(it.get('id'))):
            continue
        runs, km = lines.build(it, by_name, ids, float(src.get('simplify_km', 1.0)))
        if not runs:
            problems.append(f"{it['id']}: no geometry matched {it['source_names']}")
            continue
        out.append({
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'rank': it['rank'],
            'km': round(km, 1),
            'lines': [[round(float(v), 1) for v in r.reshape(-1)] for r in runs],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        })
        print(f"    {it['id']:14} rank {it['rank']}  {len(runs):3d} runs  {sum(len(r) for r in runs):5d} pts  {km:7.0f} km")
    return out, problems


def validate_item(it, cats, by_iso, ids, width, height):
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


def build_layer(folder, states, ids, out):
    with open(os.path.join(folder, 'layer.json'), encoding='utf-8') as f:
        layer = json.load(f)
    problems = validate_layer(layer, folder)
    items_path = os.path.join(folder, 'items.json')
    items = json.load(open(items_path, encoding='utf-8')) if os.path.exists(items_path) else []
    cats = {c['id'] for c in layer.get('categories', [])}
    by_iso = {u['iso']: u for u in states['units']}
    by_id = {u['id']: u for u in states['units']}
    height, width = ids.shape
    seen = set()
    out_items = []
    if layer.get('type') == 'lines' and not problems:
        out_items, line_problems = build_lines(layer, folder, items, cats, ids)
        problems += line_problems
        return finish(layer, out_items, out, problems, order=lambda i: (i['rank'], i['id']))
    for it in items:
        if it.get('id') in seen:
            problems.append(f"{it.get('id')}: duplicate id")
        seen.add(it.get('id'))
        p, region = validate_item(it, cats, by_iso, ids, width, height)
        problems += p
        if p:
            continue
        x, z = grid.lonlat_to_scene(it['anchor']['lon'], it['anchor']['lat'])
        out_items.append({
            'id': it['id'], 'name': it['name'], 'category': it['category'], 'priority': it['priority'],
            'x': round(float(x), 1), 'z': round(float(z), 1), 'region': region, 'regionSlug': by_id[region]['slug'],
            'blurb': it['blurb'], 'sources': it['sources'], 'status': it['status'],
        })
    return finish(layer, out_items, out, problems, order=lambda i: (i['priority'], i['id']))


def finish(layer, out_items, out, problems, order):
    """Write public/data/layers/<id>.json, whatever the type put in out_items."""
    if problems:
        return layer, None, problems
    out_items.sort(key=order)
    data = {k: layer[k] for k in ('id', 'type', 'marker', 'title', 'icon', 'group', 'categories', 'attribution') if k in layer}
    data['default_on'] = bool(layer.get('default_on'))
    data['count'] = len(out_items)
    data['reviewed'] = sum(1 for i in out_items if i['status'] == 'reviewed')
    data['items'] = out_items
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
    failed = False
    for name in sorted(os.listdir(root)):
        folder = os.path.join(root, name)
        if not os.path.isfile(os.path.join(folder, 'layer.json')):
            continue
        layer, path, problems = build_layer(folder, states, ids, args.out)
        if problems:
            failed = True
            print(f'{name}: {len(problems)} problem(s)')
            for p in problems:
                print('  ' + p)
        else:
            n = sum(1 for _ in json.load(open(path, encoding='utf-8'))['items'])
            print(f"{name}: {n} items -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)")
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
