#!/usr/bin/env python3
"""Step 2: elevation tiles -> heightmap and shade maps on the project grid.

Source: AWS Terrain Tiles, "Terrarium" PNG encoding (h = R*256 + G + B/256 - 32768 m),
https://registry.opendata.aws/terrain-tiles/ . Open data; attribution required for
the underlying sources (SRTM, GMTED2010, ETOPO1 bathymetry and others):
https://github.com/tilezen/joerd/blob/master/docs/attribution.md . Zoom 7 is about
1.1 km per pixel over India, zoom 8 about 0.55 km.

For each tier the mosaic is box-filtered to roughly the output pixel size, then every
output pixel centre is mapped EPSG:7755 -> lon/lat -> Mercator pixel and sampled
bilinearly. Land pixels (inside India, or above sea level) keep exact metres, clamped
to >= 0 so the coast never dips below the ocean sheet. Ocean pixels keep bathymetry
for tinting, quantised to 25 m steps and forced to <= -25 m: that halves what the
noisy sea floor costs on the wire and lets the shader read land as "filtered height
> -12.5 m", which gives a smooth coastline without a separate mask.

Outputs, per tier H:
  terrain/heights-{H}.bin.gz         int16 metres, full tier resolution
  terrain/shade-{H}.bin.gz           uint8 x2 at half resolution: baked ambient occlusion and
                                     coastal shadow (ocean pixels near land). AO reads fine
                                     when upsampled (PLAN.md section 3); full resolution would
                                     cost 4x the bytes.
  regions/states-borders-{H}.bin.gz  uint8 x2: distance to the nearest state/state border and
                                     to the international land boundary (coast excluded),
                                     255 on the line falling to 0 at range_px pixels; sampled
                                     LINEAR in the shader for crisp lines at any zoom.
Needs step 1 (the state ID raster marks India as land). Previews in pipeline/tmp/.
"""
import argparse
import os
import sys
import time

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.lib import fetch, grid, lcc, pack, raster  # noqa: E402

ROOT = fetch.ROOT
BBOX = (grid.LON_MIN, grid.LAT_MIN, grid.LON_MAX, grid.LAT_MAX)

# Vertical curve used for the baked AO; must stay in step with the terrain shader:
# y_km = EXAG * (h / H_REF) ** GAMMA * H_REF / 1000
H_REF, GAMMA, AO_EXAG = 8000.0, 0.65, 12.0
COAST_RANGE_KM = 30.0
OCEAN_STEP_M = 25.0
BORDER_RANGE_PX = 8


def load_mosaic(zoom, xr):
    x0, x1, y0, y1 = xr
    cols, rows = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    mosaic = np.zeros((rows, cols), np.float32)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            p = os.path.join(fetch.terrarium_dir(zoom), str(x), f'{y}.png')
            rgb = np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)
            h = rgb[:, :, 0] * 256.0 + rgb[:, :, 1] + rgb[:, :, 2] / 256.0 - 32768.0
            mosaic[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = h
    return mosaic


def box_down(img, f):
    if f <= 1:
        return img
    h, w = img.shape
    h2, w2 = h // f * f, w // f * f
    return img[:h2, :w2].reshape(h2 // f, f, w2 // f, f).mean(axis=(1, 3))


def sample_bilinear(img, px, py):
    """px, py: continuous pixel coordinates where pixel i covers [i, i+1)."""
    h, w = img.shape
    px = np.clip(px - 0.5, 0, w - 1.001)
    py = np.clip(py - 0.5, 0, h - 1.001)
    x0 = np.floor(px).astype(np.int64)
    y0 = np.floor(py).astype(np.int64)
    fx = (px - x0).astype(np.float32)
    fy = (py - y0).astype(np.float32)
    v00 = img[y0, x0]
    v01 = img[y0, x0 + 1]
    v10 = img[y0 + 1, x0]
    v11 = img[y0 + 1, x0 + 1]
    return (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy


def resample(mosaic, zoom, xr, width, height):
    x0, _, y0, _ = xr
    ex, ny = grid.pixel_centres(width, height)
    lon, lat = lcc.inverse(ex, ny)
    n = 2 ** zoom * 256.0
    mx = (lon + 180.0) / 360.0 * n - x0 * 256
    lr = np.radians(lat)
    my = (1.0 - np.log(np.tan(lr) + 1.0 / np.cos(lr)) / np.pi) / 2.0 * n - y0 * 256
    # Source pixel size at the grid's mid latitude vs output pixel size -> box filter factor.
    mid = np.radians((grid.LAT_MIN + grid.LAT_MAX) / 2)
    src_km = 40075.016686 / n * np.cos(mid)
    out_km = grid.HEIGHT_KM / height
    f = max(1, int(np.floor(out_km / src_km)))
    small = box_down(mosaic, f)
    return sample_bilinear(small, mx / f, my / f), f


def shift(a, dy, dx, fill=0.0):
    out = np.full_like(a, fill)
    h, w = a.shape
    out[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)] = a[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
    return out


def ambient_occlusion(h_m, km_per_px):
    """Horizon-based sky visibility on the exaggerated terrain, 8 directions x 6 distances."""
    y = AO_EXAG * (np.maximum(h_m, 0.0) / H_REF) ** GAMMA * H_REF / 1000.0     # km, as rendered
    occl = np.zeros_like(y)
    dirs = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
    steps = [1, 2, 3, 5, 8, 13]
    for dy, dx in dirs:
        horizon = np.zeros_like(y)
        for s in steps:
            dist = s * km_per_px * np.hypot(dy, dx)
            slope = (shift(y, -dy * s, -dx * s, fill=np.nan) - y) / dist
            slope = np.nan_to_num(slope, nan=0.0)
            np.maximum(horizon, slope, out=horizon)
        occl += np.arctan(horizon) / (np.pi / 2)
    ao = 1.0 - np.clip(occl / len(dirs), 0.0, 1.0)
    return ao


def bounded_distance(mask, radius):
    return raster.bounded_distance(mask, radius)


def border_fields(ids, land):
    """(h, w, 2) uint8: encoded distance to internal and to external land borders."""
    internal, external = raster.edges(ids, land)
    out = []
    for e in (internal, external):
        d = raster.bounded_distance(e, BORDER_RANGE_PX)
        out.append(np.clip(np.round(255.0 * (1.0 - d / BORDER_RANGE_PX)), 0, 255).astype(np.uint8))
    return np.dstack(out)


def preview(h, shade, borders, path):
    """A quick hypsometric + AO look so a human can eyeball the tier."""
    land = h >= 0
    up = np.repeat(np.repeat(shade, 2, axis=0), 2, axis=1)[:h.shape[0], :h.shape[1]].astype(np.float32)
    t = np.clip(h / 5000.0, 0, 1) ** 0.5
    rgb = np.zeros(h.shape + (3,), np.float32)
    low, high = np.array([176, 196, 132]) / 255.0, np.array([236, 226, 210]) / 255.0
    rgb[:] = low * (1 - t[..., None]) + high * t[..., None]
    rgb *= (0.55 + 0.45 * up[:, :, 0:1] / 255.0)
    sea = np.array([168, 196, 214]) / 255.0 * (1.0 - 0.35 * up[:, :, 1:2] / 255.0)
    rgb[~land] = sea[~land]
    rgb[borders[:, :, 0] > 220] *= 0.55
    rgb[borders[:, :, 1] > 220] = (0.15, 0.1, 0.1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((rgb * 255).astype(np.uint8)).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--zoom', type=int, default=7)
    ap.add_argument('--tiers', default='1024,2048')
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'data'))
    args = ap.parse_args()
    tiers = [int(t) for t in args.tiers.split(',')]

    t0 = time.time()
    xr = fetch.fetch_terrarium(args.zoom, BBOX, margin=grid.TILE_MARGIN)
    mosaic = load_mosaic(args.zoom, xr)
    print(f'mosaic {mosaic.shape[1]}x{mosaic.shape[0]} px, {mosaic.min():.0f}..{mosaic.max():.0f} m  [{time.time() - t0:.1f}s]')

    out_dir = os.path.join(args.out, 'terrain')
    for tier in tiers:
        t = time.time()
        width, height = grid.raster_size(tier)
        km_per_px = grid.HEIGHT_KM / height
        ids_path = os.path.join(args.out, 'regions', f'states-ids-{height}.bin.gz')
        if not os.path.exists(ids_path):
            sys.exit(f'missing {ids_path}: run pipeline/01_boundaries.py first')
        _, ids = pack.read(ids_path)
        ids = ids[:, :, 0]
        india = ids > 0

        h, f = resample(mosaic, args.zoom, xr, width, height)
        land = india | (h > 0.0)
        ocean = np.minimum(np.round(np.minimum(h, 0.0) / OCEAN_STEP_M) * OCEAN_STEP_M, -OCEAN_STEP_M)
        h = np.where(land, np.maximum(h, 0.0), ocean)
        h16 = np.clip(np.round(h), -32768, 32767).astype(np.int16)

        # Shade maps at half resolution: AO on the 2x2-averaged heights, coast distance in km.
        hh = box_down(h16.astype(np.float32), 2)
        land2 = box_down(land.astype(np.float32), 2) >= 0.5
        ao = ambient_occlusion(hh, km_per_px * 2)
        r = int(np.ceil(COAST_RANGE_KM / (km_per_px * 2)))
        d = bounded_distance(land2, r)
        coast = np.where(land2, 0.0, 1.0 - np.clip(d / r, 0.0, 1.0))
        shade = np.dstack([
            np.clip(np.round(ao * 255), 0, 255).astype(np.uint8),
            np.clip(np.round(coast * 255), 0, 255).astype(np.uint8)])

        borders = border_fields(ids, land)

        p1 = os.path.join(out_dir, f'heights-{height}.bin.gz')
        p2 = os.path.join(out_dir, f'shade-{height}.bin.gz')
        p3 = os.path.join(args.out, 'regions', f'states-borders-{height}.bin.gz')
        s1 = pack.write(p1, h16, 'int16', 'plane', kind='heights', units='m', km_per_px=km_per_px,
                        min=int(h16.min()), max=int(h16.max()), ocean_step_m=OCEAN_STEP_M,
                        land_threshold_m=-OCEAN_STEP_M / 2, source=f'terrarium z{args.zoom}, box {f}')
        s2 = pack.write(p2, shade, 'uint8', 'plane', kind='shade', km_per_px=km_per_px * 2,
                        channels_meaning=['ao', 'coast'], coast_range_km=COAST_RANGE_KM,
                        ao_curve={'h_ref': H_REF, 'gamma': GAMMA, 'exaggeration': AO_EXAG})
        s3 = pack.write(p3, borders, 'uint8', 'plane', kind='border-sdf', range_px=BORDER_RANGE_PX,
                        km_per_px=km_per_px, channels_meaning=['internal', 'external'])
        preview(h16.astype(np.float32), shade, borders, os.path.join(ROOT, 'pipeline', 'tmp', f'preview-terrain-{height}.png'))
        print(f'  {width}x{height}: {km_per_px:.2f} km/px, box {f}, heights {h16.min()}..{h16.max()} m, '
              f'land {land.mean() * 100:.1f}%; wrote {os.path.relpath(p1, ROOT)} ({s1 / 1024:.0f} KB), '
              f'{os.path.relpath(p2, ROOT)} ({s2 / 1024:.0f} KB), {os.path.relpath(p3, ROOT)} ({s3 / 1024:.0f} KB)  [{time.time() - t:.1f}s]')


if __name__ == '__main__':
    main()
