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
  states/<slug>-edge.bin.gz      uint8 signed distance to the unit's own outline, 128 on it

The mask is the unit's smoothed outline from step 1 filled at this resolution, not the
country ID raster resampled: that raster is 1.7 km per pixel, and stamping its staircase
into a 0.35 km one is what made the lifted block's edge look sawn rather than moulded.
The block's walls follow the same loops, so its top and its sides now share one curve.

Everything further than BLEED_KM outside the unit is flattened to SENTINEL_M so it costs
almost nothing once the plane predictor and gzip are through with it; the block discards
those fragments anyway. The band that is kept gives the walls real ground to stand on --
they sample the heightmap on the outline itself, where LINEAR filtering would otherwise
drag in the sentinel -- and keeps the ambient occlusion along the edge from being cast by
a 500 m pit that is not there.

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
from pipeline.lib import contour, grid, lcc, pack, raster  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 02_dem.py owns the mosaic loading and resampling; it is a numbered step rather than a
# module, so load it by path instead of duplicating the projection maths.
_spec = importlib.util.spec_from_file_location('dem', os.path.join(ROOT, 'pipeline', '02_dem.py'))
dem = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dem)

KM_PER_PX = 0.35        # about five times finer than the 2048 country tier
PAD_KM = 6.0            # the block pads its uv rect past the bbox; keep data under it
SENTINEL_M = -500.0     # flat fill outside the unit
BLEED_KM = 10.0         # real heights kept this far outside it (walls, ambient occlusion)
EDGE_RANGE_PX = 6       # half-width of the unit's signed edge field, in package pixels


def crop(mosaic, xr, zoom, rect, km_px):
    """Sample the mosaic over a scene-km rect at km_px. Returns heights and the size."""
    x0, z0, x1, z1 = rect
    w = max(16, int(round((x1 - x0) / km_px)))
    h = max(16, int(round((z1 - z0) / km_px)))
    sx = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    sz = z0 + (np.arange(h) + 0.5) * (z1 - z0) / h
    SX, SZ = np.meshgrid(sx, sz)
    lon, lat = lcc.inverse(SX * 1000.0 + grid.E_CENTRE, grid.N_CENTRE - SZ * 1000.0)
    n = 2 ** zoom * 256.0
    mx = (lon + 180.0) / 360.0 * n - xr[0] * 256
    lr = np.radians(lat)
    my = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / np.pi) / 2.0 * n - xr[2] * 256
    return dem.sample_bilinear(mosaic, mx, my), w, h


def unit_rings(loops, rect, w, h):
    """The unit's outline loops (scene km, from step 1) in this crop's pixel coordinates."""
    x0, z0, x1, z1 = rect
    out = []
    for loop in loops:
        px = np.asarray(loop, dtype=np.float64)
        px = np.column_stack([(px[:, 0] - x0) / ((x1 - x0) / w), (px[:, 1] - z0) / ((z1 - z0) / h)])
        if len(px) >= 3:
            out.append(px)
    return out


def unit_mask(rings, w, h):
    """Fill the unit's outline at this crop's resolution.

    The loops are the boundary the state view draws; filling them here is what keeps the
    block's top surface on the same curve as its walls. Outer loops run clockwise on
    screen and holes the other way, which is how enclaves are punched back out.
    """
    return raster.rasterise([(1, [(r, contour.shoelace(r) < 0) for r in rings])], w, h) > 0


def unit_edge(rings, inside, w, h):
    """Signed distance to the unit's outline: 128 on it, above inside, below outside.

    The block discards against the ID mask, which is a hard step however smooth the
    curve it was filled from, and the socket the block leaves in the country plate was
    cut from the 1.7 km ID raster altogether. One field measured to these loops gives
    both a clean edge at any zoom: the block fades its own rim over a screen pixel, and
    the plate cuts the socket where the walls stand rather than where the raster steps.

    It replaces the two border fields a package used to carry, which were always
    entirely zero: `border_fields` wants land on both sides of an edge, and a package
    has one labelled id and nothing else.
    """
    segs = [np.column_stack([r, np.roll(r, -1, axis=0)]) for r in rings]
    d = raster.distance_to_segments(np.concatenate(segs), w, h, EDGE_RANGE_PX)
    signed = np.where(inside, d, -d)
    return np.clip(np.round(127.5 + 127.5 * signed / EDGE_RANGE_PX), 0, 255).astype(np.uint8)


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
        h_m, w, h = crop(mosaic, xr, args.zoom, rect, args.km_per_px)
        with open(os.path.join(out_root, 'regions', 'outlines', f'{u["slug"]}.json'), encoding='utf-8') as f:
            loops = json.load(f)['loops']
        rings = unit_rings(loops, rect, w, h)
        inside = unit_mask(rings, w, h)
        bleed_px = int(np.ceil(BLEED_KM / args.km_per_px))
        h_m = np.where(raster.bounded_distance(inside, bleed_px) < bleed_px, h_m, SENTINEL_M)

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
        edge = unit_edge(rings, inside, w, h)

        files, size = {}, 0
        for name, arr, dtype, pred in (
            ('heights', h16, 'int16', 'plane'),
            ('shade', shade, 'uint8', 'plane'),
            ('ids', ids, 'uint8', 'left'),
            ('edge', edge, 'uint8', 'plane'),
        ):
            rel = f'states/{u["slug"]}-{name}.bin.gz'
            meta = {'km_per_px': args.km_per_px * (2 if name == 'shade' else 1), 'unit': u['id']}
            if name == 'shade':
                meta |= {'channels_meaning': ['ao', 'coast'], 'coast_range_km': dem.COAST_RANGE_KM}
            if name == 'edge':
                meta |= {'range_px': EDGE_RANGE_PX, 'zero': 128}
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
        json.dump({'km_per_px': args.km_per_px, 'pad_km': PAD_KM, 'bleed_km': BLEED_KM,
                   'source': f'terrarium z{args.zoom}', 'mask': 'regions/outlines',
                   'units': index}, f, separators=(',', ':'))
    print(f'  {len(index)} state packages, {total / 1048576:.1f} MB total')


if __name__ == '__main__':
    main()
