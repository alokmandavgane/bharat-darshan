#!/usr/bin/env python3
"""Step 7: atlas plates -> public/data/plates.json (PLAN.md D11, section 5 "Plates").

A plate is a page of the atlas: a title, a few words, and the view state that shows it --
which layers are on and how much relief. It is a preset, nothing more, so opening one
sets the same store keys a URL does and the engine never learns the word.

This step's whole job is to check that a plate points at layers that exist. A page naming
a layer that was renamed or removed would come up blank, and blank is the one thing a
contents page must never do.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = ('draft', 'reviewed')
BLURB_MAX = 240
# The contents page's headings, in the order an atlas reads. A plate's section must be
# one of these; the strings themselves live in src/i18n, keyed by the id.
SECTIONS = ('political', 'physical', 'climate', 'resources', 'agriculture',
            'industry', 'transport', 'people', 'culture', 'history')


def bilingual(v):
    return isinstance(v, dict) and bool(v.get('en')) and bool(v.get('hi'))


def validate(plate, name, layer_ids):
    p = []
    if plate.get('id') != name:
        p.append('plate.id must equal the file name')
    if plate.get('section') not in SECTIONS:
        p.append(f'section must be one of {SECTIONS}')
    if plate.get('status') not in STATUSES:
        p.append('status must be draft or reviewed')
    if not bilingual(plate.get('title')):
        p.append('title needs en and hi')
    if not bilingual(plate.get('blurb')):
        p.append('blurb needs en and hi')
    for lang in ('en', 'hi'):
        if len((plate.get('blurb') or {}).get(lang, '')) > BLURB_MAX:
            p.append(f'blurb.{lang} longer than {BLURB_MAX} characters')
    layers = plate.get('layers')
    if not isinstance(layers, list) or not layers:
        p.append('layers must name at least one layer')
    else:
        missing = [x for x in layers if x not in layer_ids]
        if missing:
            p.append(f"names layers that do not exist: {', '.join(missing)}")
    if not isinstance(plate.get('order'), int):
        p.append('order must be an integer: it sorts the plates inside a section')
    relief = plate.get('relief')
    if relief is not None and not (isinstance(relief, (int, float)) and 0 <= relief <= 30):
        p.append('relief must be between 0 and 30')
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    ap.add_argument('--content', default=os.path.join(ROOT, 'content', 'plates'))
    args = ap.parse_args()

    layers_dir = os.path.join(args.out, 'layers')
    layer_ids = {n[:-5] for n in os.listdir(layers_dir) if n.endswith('.json')} if os.path.isdir(layers_dir) else set()

    plates, problems = [], []
    for name in sorted(os.listdir(args.content)) if os.path.isdir(args.content) else []:
        if not name.endswith('.json'):
            continue
        with open(os.path.join(args.content, name), encoding='utf-8') as f:
            plate = json.load(f)
        p = validate(plate, name[:-5], layer_ids)
        if p:
            problems.append((name, p))
            continue
        plates.append({k: plate[k] for k in ('id', 'section', 'order', 'title', 'blurb',
                                             'layers', 'relief', 'status') if k in plate})

    for name, p in problems:
        print(f'{name}: {len(p)} problem(s)')
        for line in p:
            print(f'  {line}')
    if problems:
        sys.exit(1)

    plates.sort(key=lambda x: (SECTIONS.index(x['section']), x['order'], x['id']))
    path = os.path.join(args.out, 'plates.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'sections': list(SECTIONS), 'plates': plates}, f, ensure_ascii=False, separators=(',', ':'))
    by_section = {}
    for x in plates:
        by_section.setdefault(x['section'], []).append(x['id'])
    print(f'plates: {len(plates)} in {len(by_section)} sections -> {os.path.relpath(path, ROOT)}')
    for s in SECTIONS:
        if s in by_section:
            print(f"    {s:12} {', '.join(by_section[s])}")


if __name__ == '__main__':
    main()
