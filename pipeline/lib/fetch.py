"""Cached downloads (stdlib only). Raw files land in pipeline/raw/, which is git-ignored."""
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'pipeline', 'raw')
USER_AGENT = 'bharat-darshan-pipeline/0.1 (+https://github.com/alokmandavgane/bharat-darshan)'


def download(url, dest, retries=4, quiet=False):
    """Fetch url to dest unless dest already exists. Retries with backoff; atomic rename."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, dest)
            if not quiet:
                print(f'  fetched {os.path.relpath(dest, ROOT)} ({os.path.getsize(dest)} bytes)')
            return dest
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            if attempt == retries:
                raise
            print(f'  retry {attempt + 1} for {url}: {e}', file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def tile_range(zoom, lon_min, lat_min, lon_max, lat_max, margin=0):
    """Inclusive XYZ tile ranges covering a lon/lat box at a zoom level."""
    n = 2 ** zoom

    def x_of(lon):
        return int(math.floor((lon + 180.0) / 360.0 * n))

    def y_of(lat):
        r = math.radians(lat)
        return int(math.floor((1.0 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2.0 * n))

    x0, x1 = max(0, x_of(lon_min) - margin), min(n - 1, x_of(lon_max) + margin)
    y0, y1 = max(0, y_of(lat_max) - margin), min(n - 1, y_of(lat_min) + margin)
    return x0, x1, y0, y1


TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def terrarium_dir(zoom):
    return os.path.join(RAW, 'terrarium', str(zoom))


def fetch_terrarium(zoom, bbox, margin=1, workers=8):
    """Download every Terrarium tile covering bbox (lon_min, lat_min, lon_max, lat_max)."""
    x0, x1, y0, y1 = tile_range(zoom, *bbox, margin=margin)
    jobs = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    print(f'terrarium z{zoom}: tiles x {x0}-{x1}, y {y0}-{y1} ({len(jobs)} tiles)')

    def one(xy):
        x, y = xy
        return download(TERRARIUM_URL.format(z=zoom, x=x, y=y),
                        os.path.join(terrarium_dir(zoom), str(x), f'{y}.png'), quiet=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, jobs))
    return (x0, x1, y0, y1)


if __name__ == '__main__':
    from . import grid
    zoom = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    t = time.time()
    fetch_terrarium(zoom, (grid.LON_MIN, grid.LAT_MIN, grid.LON_MAX, grid.LAT_MAX), margin=grid.TILE_MARGIN)
    print(f'done in {time.time() - t:.1f}s')
