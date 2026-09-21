#!/usr/bin/env python3
"""Step 5: content-hash every generated file and write public/data/manifest.json.

The runtime fetches manifest.json first and resolves everything else through it, so
data files can be cached forever by their hashed name once we move to hashed names.
For now files keep plain names and the manifest carries their sha256 prefix and size,
which is enough for cache busting via a query string.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import grid  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def main():
    out = os.path.join(ROOT, 'public', 'data')
    files = {}
    for dirpath, _, names in os.walk(out):
        for n in sorted(names):
            if n == 'manifest.json':
                continue
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, out).replace(os.sep, '/')
            files[rel] = {'size': os.path.getsize(p), 'sha256': digest(p)}
    tiers = {}
    for rel in files:
        base = os.path.basename(rel)
        for prefix, key in (('heights-', 'heights'), ('shade-', 'shade'), ('states-ids-', 'ids'),
                            ('states-borders-', 'borders'), ('india-edge-', 'edge')):
            if base.startswith(prefix) and base.endswith('.bin.gz'):
                h = base[len(prefix):-len('.bin.gz')]
                tiers.setdefault(h, {})[key] = rel
    with open(os.path.join(out, 'regions', 'states.json'), encoding='utf-8') as f:
        states = json.load(f)
    layers = []
    layers_dir = os.path.join(out, 'layers')
    if os.path.isdir(layers_dir):
        for n in sorted(os.listdir(layers_dir)):
            if not n.endswith('.json'):
                continue
            with open(os.path.join(layers_dir, n), encoding='utf-8') as f:
                L = json.load(f)
            # categories and marker ride along so the menu can draw a legend before the
            # layer itself is fetched; the item bodies stay in the layer file.
            layers.append({k: L[k] for k in ('id', 'type', 'marker', 'title', 'icon', 'group',
                                             'default_on', 'count', 'reviewed', 'categories',
                                             'scale', 'unit', 'note') if k in L}
                          | {'path': f'layers/{n}'})
    world = {k: f'terrain/world-{k}.bin.gz' for k in ('heights', 'shade')
             if os.path.exists(os.path.join(out, 'terrain', f'world-{k}.bin.gz'))}
    manifest = {
        'version': 1,
        'grid': grid.describe(),
        'tiers': {h: tiers[h] for h in sorted(tiers, key=int)},
        'regions': {'states': 'regions/states.json', 'count': len(states['units'])},
        'states': 'states/index.json' if os.path.exists(os.path.join(out, 'states', 'index.json')) else None,
        'world': world or None,
        'layers': layers,
        'attribution': [
            states.get('attribution', ''),
            'Elevation: AWS Terrain Tiles (Mapzen Terrarium), from SRTM, GMTED2010, ETOPO1 and others; '
            'see https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
        ],
        'files': files,
    }
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    total = sum(v['size'] for v in files.values())
    first = sum(files[rel]['size'] for rel in tiers.get('1024', {}).values()) + files['regions/states.json']['size']
    print(f'manifest: {len(files)} files, {total / 1024:.0f} KB total; first-view tier (1024 + states.json) {first / 1024:.0f} KB')
    for h, t in manifest['tiers'].items():
        print(f'  tier {h}: ' + ', '.join(f'{k} {files[v]["size"] / 1024:.0f} KB' for k, v in t.items()))


if __name__ == '__main__':
    main()
