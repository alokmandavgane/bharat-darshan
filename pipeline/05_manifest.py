#!/usr/bin/env python3
"""Step 5: content-hash every generated file and write public/data/manifest.json.

The runtime fetches manifest.json first and resolves everything else through it, so
data files can be cached forever by their hashed name once we move to hashed names.
For now files keep plain names and the manifest carries their sha256 prefix and size,
which is enough for cache busting via a query string.

This step also writes public/data/sources.json: the source registry, cut down to the
sources the atlas actually cites, which is what the credits screen and every legend's
source line are generated from (PLAN.md section 5, "Source registry"). Being generated
from what the layers cite, it cannot credit a dataset the atlas does not use, and it
cannot leave out one it does.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import grid  # noqa: E402
from pipeline.lib import sources as sources_lib  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]


def write_sources(out):
    """The cited slice of the registry, from the layer files this build just wrote."""
    registry = sources_lib.load(ROOT)
    cited = []
    for dirname in ('layers',):
        d = os.path.join(out, dirname)
        for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if not n.endswith('.json'):
                continue
            with open(os.path.join(d, n), encoding='utf-8') as f:
                cited += registry.ids(json.load(f).get('sources'))
    data = registry.runtime(cited)
    path = os.path.join(out, 'sources.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f"sources: {len(data['sources'])} cited, {len(data['licences'])} licences "
          f"-> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)")
    return data


def main():
    out = os.path.join(ROOT, 'public', 'data')
    write_sources(out)
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
            layers.append({k: L[k] for k in ('id', 'type', 'marker', 'size', 'title', 'icon', 'group',
                                             'default_on', 'count', 'reviewed', 'categories',
                                             'fields', 'scale', 'height', 'unit', 'note', 'sources') if k in L}
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
        # Who to credit is no longer prose in this file: sources.json holds the registry,
        # each layer cites it by id, and the credits screen is generated from both.
        'sources': 'sources.json',
        'graticule': 'graticule.json' if os.path.exists(os.path.join(out, 'graticule.json')) else None,
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
