#!/usr/bin/env python3
"""Step 6: per-state hi-res packages (PLAN.md D3, section 6 "State view").

The country tiers top out at about 1.7 km per pixel, which the state view outruns
badly: at its zoom floor one height texel covers roughly fifty screen pixels. This
step crops a much finer raster out of the elevation mosaic for each unit, masked to
that unit, so entering a state can swap the block's textures for its own.

Per unit, over its bounding box padded by PAD_KM, at KM_PER_PX:
  states/<slug>-heights.bin.gz   int16 metres
  states/<slug>-shade.bin.gz     uint8 2ch: ambient occlusion, coastal shadow
  states/<slug>-ids.bin.gz       uint8 state id (the mask the block discards against)
  states/<slug>-borders.bin.gz   uint8 2ch internal / external border fields

Everything outside the unit is flattened to SENTINEL_M so it costs almost nothing
once the plane predictor and gzip are through with it; the block discards those
fragments anyway.

Needs the zoom 8 mosaic (about 600 m per pixel), which is finer than the zoom 7 the
country tiers use:  python3 -m pipeline.lib.fetch 8
"""
import argparse
import importlib.util
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import grid, lcc, pack  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 02_dem.py owns the mosaic loading and resampling; it is a numbered step rather than a
# module, so load it by path instead of duplicating the projection maths.
_spec = importlib.util.spec_from_file_location('dem', os.path.join(ROOT, 'pipeline', '02_dem.py'))
dem = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dem)

KM_PER_PX = 0.35        # about five times finer than the 2048 country tier
PAD_KM = 6.0            # the block pads its uv rect past the bbox; keep data under it
SENTINEL_M = -500.0     # flat fill outside the unit


def crop(mosaic, xr, zoom, rect, km_px):
    """Sample the mosaic over a scene-km rect at km_px. Returns heights and the size."""
    x0, z0, x1, z1 = rect
    w = max(16, int(round((x1 - x0) / km_px)))
    h = max(16, int(round((z1 - z0) / km_px)))
    sx = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    sz = z0 + (np.arange(h) + 0.5) * (z1 - z0) / h
    SX, SZ = np.meshgrid(sx, sz)
    east = SX * 1000.0 + grid.E_CENTRE
    north = grid.N_CENTRE - SZ * 1000.0
    lon, lat = lcc.inverse(east, north)
    n = 2 ** zoom * 256.0
    mx = (lon + 180.0) / 360.0 * n - xr[0] * 256
    lr = np.radians(lat)
    my = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / np.pi) / 2.0 * n - xr[2] * 256
    return dem.sample_bilinear(mosaic, mx, my), w, h, east, north


def unit_mask(east, north, ids_r, uid):
    """Nearest-sample the country id raster at these projected coordinates."""
    ih, iw = ids_r.shape
    col = np.clip(((east - grid.E_MIN) / (grid.E_MAX - grid.E_MIN) * iw).astype(int), 0, iw - 1)
    row = np.clip(((grid.N_MAX - north) / (grid.N_MAX - grid.N_MIN) * ih).astype(int), 0, ih - 1)
    return ids_r[row, col] == uid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zoom', type=int, default=8)
    ap.add_argument('--km-per-px', type=float, default=KM_PER_PX)
    ap.add_argument('--only', default='', help='comma-separated slugs, for a quick run')
    args = ap.parse_args()

    out_root = os.path.join(ROOT, 'public', 'data')
    out_dir = os.path.join(out_root, 'states')
    os.makedirs(out_dir, exist_ok=True)

    states = json.load(open(os.path.join(out_root, 'regions', 'states.json'), encoding='utf-8'))
    finest = max(states['tiers'], key=int)
    _, ids_raster = pack.read(os.path.join(out_root, states['tiers'][finest]['ids']))
    ids_raster = ids_raster[:, :, 0]

    xr = dem.fetch.tile_range(args.zoom, *dem.BBOX, margin=grid.TILE_MARGIN)
    mosaic = dem.load_mosaic(args.zoom, xr)
    print(f'  mosaic z{args.zoom}: {mosaic.shape[1]}x{mosaic.shape[0]}')

    wanted = set(s for s in args.only.split(',') if s)
    index, total = {}, 0
    for u in states['units']:
        if wanted and u['slug'] not in wanted:
            continue
        x0, z0, x1, z1 = u['bbox']
        rect = [x0 - PAD_KM, z0 - PAD_KM, x1 + PAD_KM, z1 + PAD_KM]
        h_m, w, h, east, north = crop(mosaic, xr, args.zoom, rect, args.km_per_px)
        inside = unit_mask(east, north, ids_raster, u['id'])
        h_m = np.where(inside, h_m, SENTINEL_M)

        ids = np.where(inside, u['id'], 0).astype(np.uint8)
        h16 = np.clip(np.round(h_m), -32768, 32767).astype(np.int16)

        # Shade mirrors 02_dem.py exactly: half resolution, two channels, ambient
        # occlusion and coastal shadow. The shader reads .rg, so a single channel here
        # leaves the coast term at zero and the whole block renders black.
        hh = dem.box_down(h16.astype(np.float32), 2)
        land2 = dem.box_down(inside.astype(np.float32), 2) >= 0.5
        ao = dem.ambient_occlusion(hh, args.km_per_px * 2)
        r = int(np.ceil(dem.COAST_RANGE_KM / (args.km_per_px * 2)))
        d = dem.bounded_distance(land2, r)
        coast = np.where(land2, 0.0, 1.0 - np.clip(d / r, 0.0, 1.0))
        shade = np.dstack([np.clip(np.round(ao * 255), 0, 255).astype(np.uint8),
                           np.clip(np.round(coast * 255), 0, 255).astype(np.uint8)])
        borders = dem.border_fields(ids, inside)

        files, size = {}, 0
        for name, arr, dtype, pred in (
            ('heights', h16, 'int16', 'plane'),
            ('shade', shade, 'uint8', 'plane'),
            ('ids', ids, 'uint8', 'left'),
            ('borders', borders, 'uint8', 'plane'),
        ):
            rel = f'states/{u["slug"]}-{name}.bin.gz'
            meta = {'km_per_px': args.km_per_px * (2 if name == 'shade' else 1), 'unit': u['id']}
            if name == 'shade':
                meta |= {'channels_meaning': ['ao', 'coast'], 'coast_range_km': dem.COAST_RANGE_KM}
            if name == 'borders':
                meta |= {'range_px': dem.BORDER_RANGE_PX}
            size += pack.write(os.path.join(out_root, rel), arr, dtype, predictor=pred,
                               kind=f'state-{name}', **meta)
            files[name] = rel
        total += size
        index[u['slug']] = {
            'id': u['id'], 'rect': [round(v, 1) for v in rect],
            'width': w, 'height': h, 'km_per_px': args.km_per_px,
            'bytes': size, **files,
        }
        print(f'  {u["slug"]:42} {w:5d}x{h:<5d} {size // 1024:6d} KB  {inside.mean():5.1%} fill')

    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump({'km_per_px': args.km_per_px, 'pad_km': PAD_KM,
                   'source': f'terrarium z{args.zoom}', 'units': index}, f, separators=(',', ':'))
    print(f'  {len(index)} state packages, {total / 1048576:.1f} MB total')


if __name__ == '__main__':
    main()
