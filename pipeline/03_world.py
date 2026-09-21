#!/usr/bin/env python3
"""Step 3: the land around India, coarse, so the model is not standing on nothing.

With Surroundings switched on the map drew the neighbours inside the project grid and
then stopped, a few hundred km out, which left India on a small island of terrain. This
crops a much wider, much coarser sheet -- SCALE tiles of the project grid across and
down, India in the middle one -- from a low zoom of the same elevation source, and the
engine lays it under the plate as a backdrop.

Outputs:
  terrain/world-heights.bin.gz   int16 metres over the wide rect
  terrain/world-shade.bin.gz     uint8 x2 at half resolution: ambient occlusion, coast

It is not on the first view: the backdrop is fetched the first time Surroundings is
switched on, and nothing else depends on it.

Needs a low zoom of the terrain tiles over the wide box:
  python3 pipeline/03_world.py --fetch
"""
import argparse
import importlib.util
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import fetch, grid, lcc, pack  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_spec = importlib.util.spec_from_file_location('dem', os.path.join(ROOT, 'pipeline', '02_dem.py'))
dem = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dem)

SCALE = 3.0          # tiles of the project grid across and down, India in the middle
HEIGHT_PX = 1280     # about 8 km per pixel, which is all a backdrop needs
ZOOM = 4             # terrain tiles at roughly 10 km per pixel
OCEAN_STEP_M = 50.0  # coarser than the country tiers: this is scenery, not bathymetry


def world_rect():
    """The wide rect in projected metres, and its lon/lat box for the tile fetch."""
    half_e = (grid.E_MAX - grid.E_MIN) * SCALE / 2
    half_n = (grid.N_MAX - grid.N_MIN) * SCALE / 2
    e0, e1 = grid.E_CENTRE - half_e, grid.E_CENTRE + half_e
    n0, n1 = grid.N_CENTRE - half_n, grid.N_CENTRE + half_n
    # The edges of a conic are curved, so walk them rather than trusting four corners.
    t = np.linspace(0, 1, 200)
    ex = np.concatenate([e0 + (e1 - e0) * t, e0 + (e1 - e0) * t, np.full(200, e0), np.full(200, e1)])
    ny = np.concatenate([np.full(200, n0), np.full(200, n1), n0 + (n1 - n0) * t, n0 + (n1 - n0) * t])
    lon, lat = lcc.inverse(ex, ny)
    lon, lat = lon[np.isfinite(lon)], lat[np.isfinite(lat)]
    box = (float(lon.min()), max(-84.0, float(lat.min())), float(lon.max()), min(84.0, float(lat.max())))
    return (e0, n0, e1, n1), box


def size():
    w = (grid.E_MAX - grid.E_MIN) / (grid.N_MAX - grid.N_MIN)
    return int(round(HEIGHT_PX * w / 64.0)) * 64, HEIGHT_PX


def sample(mosaic, xr, width, height, rect):
    """Every output pixel centre: projected -> lon/lat -> Mercator pixel -> bilinear."""
    e0, n0, e1, n1 = rect
    ex = e0 + (np.arange(width) + 0.5) * (e1 - e0) / width
    ny = n1 - (np.arange(height) + 0.5) * (n1 - n0) / height
    EX, NY = np.meshgrid(ex, ny)
    lon, lat = lcc.inverse(EX, NY)
    lat = np.clip(np.nan_to_num(lat, nan=0.0), -84.0, 84.0)
    lon = np.nan_to_num(lon, nan=0.0)
    n = 2 ** ZOOM * 256.0
    mx = (lon + 180.0) / 360.0 * n - xr[0] * 256
    lr = np.radians(lat)
    my = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / np.pi) / 2.0 * n - xr[2] * 256
    return dem.sample_bilinear(mosaic, mx, my)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fetch', action='store_true', help='download the tiles first')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    args = ap.parse_args()

    rect, box = world_rect()
    width, height = size()
    km = (rect[2] - rect[0]) / 1000.0, (rect[3] - rect[1]) / 1000.0
    print(f'  wide rect {km[0]:.0f} x {km[1]:.0f} km, lon {box[0]:.1f}..{box[2]:.1f}, lat {box[1]:.1f}..{box[3]:.1f}')
    if args.fetch:
        fetch.fetch_terrarium(ZOOM, box, margin=1)
    xr = fetch.tile_range(ZOOM, *box, margin=1)
    mosaic = dem.load_mosaic(ZOOM, xr)
    print(f'  mosaic z{ZOOM}: {mosaic.shape[1]}x{mosaic.shape[0]}')

    h = sample(mosaic, xr, width, height, rect)
    land = h > 0.0
    ocean = np.minimum(np.round(np.minimum(h, 0.0) / OCEAN_STEP_M) * OCEAN_STEP_M, -OCEAN_STEP_M)
    h = np.where(land, np.maximum(h, 0.0), ocean)
    h16 = np.clip(np.round(h), -32768, 32767).astype(np.int16)

    km_per_px = km[1] / height
    hh = dem.box_down(h16.astype(np.float32), 2)
    land2 = dem.box_down(land.astype(np.float32), 2) >= 0.5
    # The plate searches its horizon about 45 km out; at this pitch that is three cells,
    # not thirteen, or the backdrop's hills would shade each other across 200 km and the
    # sheet would read far darker than the plate it hands over to.
    reach = dem.AO_STEPS[-1] * (grid.HEIGHT_KM / 1024) * 2
    steps = tuple(s for s in dem.AO_STEPS if s * km_per_px * 2 <= reach) or (1,)
    ao = dem.ambient_occlusion(hh, km_per_px * 2, steps=steps)
    print(f'  ambient occlusion: {len(steps)} steps, reaching {max(steps) * km_per_px * 2:.0f} km')
    # The same coastal shadow the plate bakes, in km. Widening it here was what made the
    # sea change tone across the band where the two sheets hand over.
    r = max(1, int(np.ceil(dem.COAST_RANGE_KM / (km_per_px * 2))))
    d = dem.bounded_distance(land2, r)
    coast = np.where(land2, 0.0, 1.0 - np.clip(d / r, 0.0, 1.0))
    shade = np.dstack([np.clip(np.round(ao * 255), 0, 255).astype(np.uint8),
                       np.clip(np.round(coast * 255), 0, 255).astype(np.uint8)])

    out = os.path.join(args.out, 'terrain')
    p1 = os.path.join(out, 'world-heights.bin.gz')
    p2 = os.path.join(out, 'world-shade.bin.gz')
    s1 = pack.write(p1, h16, 'int16', 'plane', kind='world-heights', units='m', km_per_px=km_per_px,
                    width_km=round(km[0], 1), height_km=round(km[1], 1), scale=SCALE,
                    source=f'terrarium z{ZOOM}')
    s2 = pack.write(p2, shade, 'uint8', 'plane', kind='world-shade', km_per_px=km_per_px * 2,
                    channels_meaning=['ao', 'coast'], coast_range_km=dem.COAST_RANGE_KM,
                    ao_curve={'h_ref': dem.H_REF, 'gamma': dem.GAMMA, 'exaggeration': dem.AO_EXAG})
    print(f'  {width}x{height}: {km_per_px:.1f} km/px, heights {h16.min()}..{h16.max()} m, '
          f'land {land.mean() * 100:.1f}%; wrote {os.path.relpath(p1, ROOT)} ({s1 / 1024:.0f} KB), '
          f'{os.path.relpath(p2, ROOT)} ({s2 / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
