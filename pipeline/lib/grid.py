"""The project grid: what the runtime calls "scene units".

Everything rendered shares one rectangle of EPSG:7755 space, chosen once here:
1 scene unit = 1 km, origin at the rectangle centre, x east, z south (three.js y is up).
Rasters cover exactly this rectangle, so a texel (col, row) maps to scene x/z without
any per-raster transform. Raster row 0 is the northern edge (like an image).
"""
import numpy as np

from . import lcc

# Geographic box the country view must cover (PLAN.md section 6): the official
# boundary, Indira Point, Lakshadweep, Andaman and Nicobar in their true positions.
LON_MIN, LON_MAX = 68.0, 97.5
LAT_MIN, LAT_MAX = 6.5, 37.5

# Terrain tiles fetched with one tile of margin so edge samples can interpolate.
TILE_MARGIN = 1


def projected_bounds():
    """Bounding rectangle, in whole km of EPSG:7755, of the geographic box above."""
    lons = np.concatenate([
        np.linspace(LON_MIN, LON_MAX, 200), np.linspace(LON_MIN, LON_MAX, 200),
        np.full(200, LON_MIN), np.full(200, LON_MAX)])
    lats = np.concatenate([
        np.full(200, LAT_MIN), np.full(200, LAT_MAX),
        np.linspace(LAT_MIN, LAT_MAX, 200), np.linspace(LAT_MIN, LAT_MAX, 200)])
    x, y = lcc.forward(lons, lats)
    km = 1000.0
    return (np.floor(x.min() / km) * km, np.floor(y.min() / km) * km,
            np.ceil(x.max() / km) * km, np.ceil(y.max() / km) * km)


E_MIN, N_MIN, E_MAX, N_MAX = projected_bounds()
WIDTH_KM = (E_MAX - E_MIN) / 1000.0
HEIGHT_KM = (N_MAX - N_MIN) / 1000.0
E_CENTRE = (E_MIN + E_MAX) / 2
N_CENTRE = (N_MIN + N_MAX) / 2


def raster_size(height_px):
    """(width, height) in pixels for a raster tier; width keeps pixels square and is a multiple of 64."""
    width = int(round(height_px * WIDTH_KM / HEIGHT_KM / 64.0)) * 64
    return width, height_px


def pixel_centres(width, height):
    """EPSG:7755 coordinates of every pixel centre, as two (height, width) arrays; row 0 is north."""
    xs = E_MIN + (np.arange(width) + 0.5) * (E_MAX - E_MIN) / width
    ys = N_MAX - (np.arange(height) + 0.5) * (N_MAX - N_MIN) / height
    return np.meshgrid(xs, ys)


def to_scene(x, y):
    """EPSG:7755 metres -> scene km (x east, z south)."""
    return (np.asarray(x) - E_CENTRE) / 1000.0, (N_CENTRE - np.asarray(y)) / 1000.0


def lonlat_to_scene(lon, lat):
    return to_scene(*lcc.forward(lon, lat))


def lonlat_to_pixel(lon, lat, width, height):
    """Degrees -> continuous pixel coordinates (col, row) in a raster of the given size."""
    x, y = lcc.forward(lon, lat)
    col = (x - E_MIN) / (E_MAX - E_MIN) * width
    row = (N_MAX - y) / (N_MAX - N_MIN) * height
    return col, row


def describe():
    return {
        'crs': 'EPSG:7755',
        'lonlat_bbox': [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX],
        'projected_bbox_m': [E_MIN, N_MIN, E_MAX, N_MAX],
        'width_km': WIDTH_KM,
        'height_km': HEIGHT_KM,
        'origin_m': [E_CENTRE, N_CENTRE],
    }


if __name__ == '__main__':
    import json
    print(json.dumps(describe(), indent=1))
    for n in (1024, 2048, 4096):
        w, h = raster_size(n)
        print(n, '->', w, 'x', h, 'px,', round(HEIGHT_KM / h, 3), 'km/px')
