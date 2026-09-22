"""Polyline geometry for `lines` layers: fetch, project, clip to India, simplify.

A `lines` layer names its geometry source in `layer.json` and its features in
`items.json`; this module is what joins the two. Geometry is matched to a curated item
by name, because that is the only field a source and a content folder reliably share,
and folding accents off both sides is what makes "Godävari" meet "Godavari".

An item joins its geometry one of three ways. `source_names` matches the source's own
names, which is how rivers work. `waypoints` names the places a route is known by and
the build walks the source's parts between them, for a source that carries geometry
but no names -- which is every road and railway over India in Natural Earth. And
`geometry` describes a line that no dataset should have to supply because it is defined
rather than surveyed: a parallel or a meridian, given as the number that defines it.

Everything leaves here in scene km on the project grid, clipped to the ID raster: the
map draws India alone by default, so a river that carried on into Tibet would trail
off over blank paper.
"""
import collections
import json
import os
import unicodedata

import numpy as np

from . import contour, fetch, grid, shapefile


def fold(name):
    """Lower-case and strip accents, so a source's transliteration can meet a curated name."""
    s = unicodedata.normalize('NFKD', str(name or ''))
    return ''.join(c for c in s if not unicodedata.combining(c)).strip().lower()


FORMATS = ('shapefile-polyline', 'shapefile-polygon', 'geojson-polyline', 'geojson-polygon')
GEOJSON = ('geojson-polyline', 'geojson-polygon')


def read_geojson(path):
    """
    Features of a GeoJSON file, one at a time: (properties, [(n, 2) arrays]).

    Read line by line rather than with `json.load`, because these files run to a hundred
    megabytes and every coordinate would otherwise become a Python list of two floats --
    a gigabyte of objects to answer a question about a few thousand of them. Every writer
    this project meets puts one feature on one line, which is what makes it possible; a
    file that does not is read whole, and says so.
    """
    def parts_of(geo):
        if not geo:
            return []
        t, c = geo.get('type'), geo.get('coordinates')
        if t == 'LineString':
            return [np.asarray(c, dtype=np.float64)]
        if t == 'MultiLineString':
            return [np.asarray(r, dtype=np.float64) for r in c]
        if t == 'Polygon':
            return [np.asarray(r, dtype=np.float64) for r in c]
        if t == 'MultiPolygon':
            return [np.asarray(r, dtype=np.float64) for poly in c for r in poly]
        return []

    whole = None
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip().rstrip(',')
            if '"Feature"' not in line[:48]:
                continue
            try:
                g = json.loads(line)
            except ValueError:                      # not one feature per line after all
                whole = True
                break
            yield (g.get('properties') or {}), [a for a in parts_of(g.get('geometry')) if a.ndim == 2 and len(a) >= 2]
    if whole:
        with open(path, encoding='utf-8') as f:
            for g in json.load(f).get('features', []):
                yield (g.get('properties') or {}), [a for a in parts_of(g.get('geometry')) if a.ndim == 2 and len(a) >= 2]


def _files(source, raw_dir):
    """Download a layer's geometry files. Returns the .shp and .dbf paths."""
    if source.get('format') not in FORMATS:
        raise ValueError(f"unknown geometry source format {source.get('format')!r}")
    paths = {}
    for name, url in source['files'].items():
        dest = os.path.join(raw_dir, name)
        fetch.download(url, dest)
        paths[name] = dest
    if source['format'] in GEOJSON:
        return next(p for n, p in paths.items() if n.endswith(('.geojson', '.json'))), None
    return (next(p for n, p in paths.items() if n.endswith('.shp')),
            next((p for n, p in paths.items() if n.endswith('.dbf')), None))


def _features(source, raw_dir, polygons=False):
    """(properties, parts) for every feature of a source, whichever format it is in."""
    path, dbf = _files(source, raw_dir)
    if source['format'] in GEOJSON:
        yield from read_geojson(path)
        return
    reader = shapefile.read_polygons if polygons else shapefile.read_polylines
    rows = shapefile.read_dbf(dbf, encoding=source.get('encoding', 'latin-1'))[1] if dbf else None
    for i, (_, parts) in enumerate(reader(path)):
        yield (rows[i] if rows else {}), parts


def load_parts(source, raw_dir):
    """Every part of a polyline source, for a layer whose items are routed, not named."""
    out = []
    for _, parts in _features(source, raw_dir):
        out.extend(parts)
    return stitch(out) if source.get('stitch') else out


def load_source(source, raw_dir):
    """Download a layer's geometry files and index their parts by folded name."""
    key = source.get('match', 'name')
    by_name = {}
    for props, parts in _features(source, raw_dir):
        if parts:
            by_name.setdefault(fold(props.get(key)), []).extend(parts)
    if source.get('stitch'):
        # Stitched within a name, so a chain is never carried across from one road to another.
        return {k: stitch(v) for k, v in by_name.items()}
    return by_name


def load_polygon_source(source, raw_dir):
    """
    The same name index as load_source, for polygons: folded name -> [(ring, is_hole)].

    An `areas` layer joins the way rivers do, because a published polygon set and a
    content folder share a name and nothing else. A feature's rings arrive together, so
    a region in two pieces -- the Western Ghats broken by the Palghat gap -- stays one
    area with one card.
    """
    key = source.get('match', 'name')
    by_name = {}
    for props, rings in _features(source, raw_dir, polygons=True):
        # A shapefile marks a hole by winding it the other way: outer rings run clockwise
        # in lon/lat, which is a negative signed area, and holes run counter-clockwise.
        tagged = [(r, shapefile.signed_area(r) > 0) for r in rings]
        if tagged:
            by_name.setdefault(fold(props.get(key)), []).extend(tagged)
    return by_name


STITCH_TOL = 1e-6      # degrees: endpoints this close are the same point, about 10 cm


def stitch(parts, tol=STITCH_TOL):
    """
    Join parts that meet end to end into the longest chains the source allows.

    A published network is cut wherever an attribute changes -- a lane count, a bridge, a
    state line -- so one highway can arrive as three thousand fragments, most of them two
    points long. Simplifying a two-point fragment does nothing, and drawing three thousand
    of them is three thousand ribbons where one would do. Chains are broken at real
    junctions (three or more ends meeting), which is what keeps the topology the source's
    and not a guess.
    """
    def key(p):
        return round(float(p[0]) / tol), round(float(p[1]) / tol)
    parts = [np.asarray(p, dtype=np.float64) for p in parts if len(p) >= 2]
    ends = collections.defaultdict(list)
    for i, p in enumerate(parts):
        ends[key(p[0])].append((i, 0))
        ends[key(p[-1])].append((i, 1))
    used = [False] * len(parts)
    out = []
    for i in range(len(parts)):
        if used[i]:
            continue
        used[i] = True
        chain = list(parts[i])
        for forward in (True, False):
            while True:
                tip = chain[-1] if forward else chain[0]
                meeting = ends[key(tip)]
                if len(meeting) != 2:            # a junction, or the end of the line
                    break
                nxt = [(j, e) for j, e in meeting if not used[j]]
                if len(nxt) != 1:
                    break
                j, e = nxt[0]
                used[j] = True
                seg = parts[j] if e == 0 else parts[j][::-1]
                if forward:
                    chain.extend(seg[1:])
                else:
                    chain[:0] = list(seg[:-1])
        out.append(np.asarray(chain))
    return out


def noded(parts, tol_deg):
    """
    Split chains where another chain's end lands in the middle of one.

    Endpoint-to-endpoint snapping only connects a network whose parts were drawn to meet.
    A survey drawing is not: a branch line's first vertex sits somewhere along the main
    line's run, not at a vertex of it, so no amount of widening the snap joins them --
    the main line has to be cut there first. For every chain end, the nearest vertex on
    any other chain within `tol_deg` becomes a cut, and the chains are split at their
    cuts. After this the ends do meet, and `network` can do its work.
    """
    parts = [np.asarray(p, dtype=np.float64) for p in parts if len(p) >= 2]
    if not parts:
        return parts
    # One grid of every vertex, so finding what is near an end is a lookup and not a scan.
    cells = {}
    for i, p in enumerate(parts):
        for j, (lon, lat) in enumerate(p):
            cells.setdefault((int(lon / tol_deg), int(lat / tol_deg)), []).append((i, j))
    cuts = [set() for _ in parts]
    for i, p in enumerate(parts):
        for end in (0, len(p) - 1):
            lon, lat = float(p[end, 0]), float(p[end, 1])
            best, bestd = None, tol_deg
            cx, cy = int(lon / tol_deg), int(lat / tol_deg)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for k, j in cells.get((cx + dx, cy + dy), ()):
                        if k == i:
                            continue
                        d = max(abs(parts[k][j, 0] - lon), abs(parts[k][j, 1] - lat))
                        if d < bestd:
                            best, bestd = (k, j), d
            if best and 0 < best[1] < len(parts[best[0]]) - 1:
                cuts[best[0]].add(best[1])
    out = []
    for p, marks in zip(parts, cuts):
        bounds = sorted({0, len(p) - 1} | marks)
        for lo, hi in zip(bounds, bounds[1:]):
            if hi - lo >= 1:
                out.append(p[lo:hi + 1])
    return out


CORRIDOR_KM = 8.0      # how far from a route's line a track may lie and still be that route
CORRIDOR_FRAC = 0.7    # ...and how much of a chain must lie inside before it is taken


def corridor(parts, waypoints, width_km=CORRIDOR_KM, frac=CORRIDOR_FRAC):
    """
    The source's own chains that run along a route, chosen by nearness rather than by
    walking a graph.

    Routing needs a source whose parts meet; Indian Railways' centrelines are a drawing
    and do not, whatever is done to close the gaps. But a railway line is also simply
    "the track between these towns", and that can be asked directly: densify the line
    through the route's places, and keep every chain that lies inside a corridor about it.
    Nothing is invented -- every metre drawn is the source's -- and nothing far from the
    route can creep in. What does creep in is a branch or a second track beside the route
    for a few kilometres, so the length reported is track along the way, not the route's
    own mileage.
    """
    w = np.array([[float(p['lon']), float(p['lat'])] for p in waypoints], dtype=np.float64)
    if len(w) < 2:
        return []
    wx, wz = grid.lonlat_to_scene(w[:, 0], w[:, 1])
    line = np.column_stack([wx, wz])
    dense = []
    for a, b in zip(line, line[1:]):
        steps = max(2, int(np.hypot(*(b - a)) / (width_km / 2)) + 1)
        dense.append(np.linspace(a, b, steps))
    dense = np.vstack(dense)
    cells = {}
    for i, (a, b) in enumerate(dense):
        cells.setdefault((int(a // width_km), int(b // width_km)), []).append(i)
    w2 = width_km * width_km
    kept = []
    for n, part in enumerate(parts):
        px, pz = grid.lonlat_to_scene(part[:, 0], part[:, 1])
        near = 0
        for a, b in zip(px, pz):
            cx, cy = int(a // width_km), int(b // width_km)
            hit = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in cells.get((cx + dx, cy + dy), ()):
                        if (dense[j, 0] - a) ** 2 + (dense[j, 1] - b) ** 2 <= w2:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    break
            near += hit
        if near >= frac * len(px):
            kept.append(n)
    return kept


def _clip(xz, inside):
    """Split a projected line into the runs whose vertices are inside the mask."""
    runs, cur = [], []
    for p, ok in zip(xz, inside):
        if ok:
            cur.append(p)
        elif cur:
            runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


def _orient(run, heights):
    """Turn a run round if it climbs, so it reads source to mouth.

    Water is the one thing on a map with a direction of its own, and the source does not
    carry it: Natural Earth's centrelines are not digitised downstream, and a run clipped
    at the border can come out either way about. The bed is the record. Fit height against
    distance along the run and reverse it when the fit rises.
    """
    if len(run) < 3:
        return run
    h, w = heights.shape
    col, row = grid.scene_to_pixel(run[:, 0], run[:, 1], w, h)
    z = heights[np.clip(row.astype(int), 0, h - 1), np.clip(col.astype(int), 0, w - 1)].astype(np.float64)
    d = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(run, axis=0).T))])
    dd = d - d.mean()
    if not dd.any():
        return run
    slope = float((dd * (z - z.mean())).sum() / (dd * dd).sum())
    return run[::-1] if slope > 0 else run


def project(parts, ids, simplify_km, heights=None, clip=True, min_km=None):
    """
    lon/lat parts -> scene-km runs, simplified. Returns [(n, 2) arrays].

    Clipped to India by default, because the map draws India alone and a river carrying
    on into Tibet would trail off over blank paper. An arrow is the exception: the
    monsoon's whole story is that it arrives from the sea, so a flow that stopped at the
    coast would be telling the opposite of it.
    """
    height, width = ids.shape
    # Shorter than this is a speck the map cannot draw. One raster pixel suits a layer of
    # long named courses; a dense network is full of real links shorter than that, and
    # says so with its own floor.
    floor = grid.HEIGHT_KM / height if min_km is None else float(min_km)
    out = []
    for part in parts:
        x, z = grid.lonlat_to_scene(part[:, 0], part[:, 1])
        xz = np.column_stack([x, z])
        col, row = grid.lonlat_to_pixel(part[:, 0], part[:, 1], width, height)
        c = np.clip(col.astype(int), 0, width - 1)
        r = np.clip(row.astype(int), 0, height - 1)
        inside = np.ones(len(xz), dtype=bool) if not clip else ids[r, c] > 0
        for run in _clip(xz, inside):
            if len(run) < 2:
                continue
            simple = contour.simplify_line(run, simplify_km)
            if len(simple) >= 2 and _length(simple) > floor:
                out.append(simple if heights is None else _orient(simple, heights))
    return out


def _length(run):
    return float(np.hypot(*np.diff(run, axis=0).T).sum())


# The step a generated line is sampled at, in degrees. A parallel is a straight line in
# EPSG:7755 only at the projection's standard parallels; everywhere else it curves, so it
# has to be walked rather than drawn between its two ends. At 0.05 degrees that is about
# 5.5 km a step, well under the simplify tolerance that follows, so the curve is the
# projection's and not the sampling's.
GENERATED_STEP_DEG = 0.05


ARROW_KM = 260.0       # how far back from the tip the head reaches
SHAFT_WIDEN = 2.4      # an arrow's shaft against a river of the same rank
ARROW_WIDEN = 3.0      # and the head against its own shaft
ARROW_STEPS = 8        # vertices the head is shaped from


def arc(a, b, bow=0.22, steps=64):
    """
    A flow's course: a quadratic bend from `a` to `b`, bulging left of the straight line
    by `bow` of its length. Bent rather than straight because two arrows between nearby
    places would otherwise lie on top of each other, and because a flow on a map is a
    movement rather than a measurement -- the monsoon does not arrive along a ruler.
    Returns a lon/lat part.
    """
    ax, ay = float(a['lon']), float(a['lat'])
    bx, by = float(b['lon']), float(b['lat'])
    mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
    dx, dy = bx - ax, by - ay
    cx, cy = mx - dy * bow, my + dx * bow          # control point, perpendicular to the chord
    t = np.linspace(0.0, 1.0, steps)[:, None]
    p = (1 - t) ** 2 * np.array([ax, ay]) + 2 * (1 - t) * t * np.array([cx, cy]) + t ** 2 * np.array([bx, by])
    return p


def _resample(run, d, targets):
    """Points along a polyline at the given distances from its start."""
    return np.column_stack([np.interp(targets, d, run[:, 0]), np.interp(targets, d, run[:, 1])])


def shape_arrow(run):
    """
    Turn a run into an arrow: the shaft as it is, and a head with vertices of its own.
    Returns (run, widths), the widths being a multiplier the ribbon's half-width is
    scaled by -- 1 along the shaft, swelling over the last ARROW_KM, a point at the tip.

    The head has to be resampled rather than shaped in place. Simplification is what
    makes a 2,200 km arc nine points, and nine points across 2,200 km leaves one inside
    the last ninety, so a profile laid over the vertices that survive produces no head at
    all -- which is what it did the first time.

    Shaping the ribbon is the trick worth keeping: an arrowhead as separate geometry
    would need its own mesh, its own picking and its own place in the draw order.
    """
    d = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(run, axis=0).T))])
    total = float(d[-1])
    head_km = min(ARROW_KM, total * 0.45)           # a short flow still gets a head
    if total <= 1e-6 or len(run) < 2:
        return run, np.ones(len(run))
    base = total - head_km
    shaft = run[d < base]
    if len(shaft) < 1:
        shaft = run[:1]
    head = _resample(run, d, np.linspace(base, total, ARROW_STEPS))
    out = np.vstack([shaft, head])
    t = np.concatenate([np.zeros(len(shaft)), np.linspace(0.0, 1.0, ARROW_STEPS)])
    w = SHAFT_WIDEN * (1.0 + (ARROW_WIDEN - 1.0) * (1.0 - t) ** 0.55)
    w[:len(shaft)] = SHAFT_WIDEN
    w[-1] = 0.0                                     # the tip is a point
    return out, w


def generate(geometry):
    """
    A line defined rather than surveyed: `{"parallel": 23.4394}` or `{"meridian": 82.5}`,
    walked across the project grid's geographic box. Returns lon/lat parts, or [] if the
    line does not cross the box at all.
    """
    if not isinstance(geometry, dict):
        return []
    lat = geometry.get('parallel')
    lon = geometry.get('meridian')
    if isinstance(lat, (int, float)) and not isinstance(lat, bool):
        if not grid.LAT_MIN <= lat <= grid.LAT_MAX:
            return []
        lons = np.arange(grid.LON_MIN, grid.LON_MAX + GENERATED_STEP_DEG, GENERATED_STEP_DEG)
        return [np.column_stack([lons, np.full(len(lons), float(lat))])]
    if isinstance(lon, (int, float)) and not isinstance(lon, bool):
        if not grid.LON_MIN <= lon <= grid.LON_MAX:
            return []
        lats = np.arange(grid.LAT_MIN, grid.LAT_MAX + GENERATED_STEP_DEG, GENERATED_STEP_DEG)
        return [np.column_stack([np.full(len(lats), float(lon)), lats])]
    if isinstance(geometry.get('from'), dict) and isinstance(geometry.get('to'), dict):
        return [arc(geometry['from'], geometry['to'], float(geometry.get('bow', 0.22)))]
    return []


def build(item, index, ids, simplify_km, heights=None, clip=True, min_km=None, corridor_opts=None):
    """Geometry for one curated item, projected and clipped.

    `index` is whatever the layer's source gave: a name index for an item that lists
    source_names, a network for one that lists the waypoints its route runs through, and
    nothing at all for one that describes its own geometry.
    With `heights`, every run is pointed downstream, for a layer that animates its flow.
    Returns (runs, km, note); the note says how the routing went, or nothing for a name join.
    """
    note = None
    if item.get('geometry'):
        parts = generate(item['geometry'])
    elif item.get('waypoints') and isinstance(index, list):
        # A corridor join: `index` is the source's chains, not a graph or a name table.
        taken = corridor(index, item['waypoints'], **(corridor_opts or {}))
        parts = [index[i] for i in taken]
        note = {'snap': [0.0], 'chains': len(taken), 'taken': taken}
    elif item.get('waypoints'):
        joined, note = route(item['waypoints'], index)
        parts = joined or []
    else:
        parts = []
        for name in item.get('source_names') or []:
            parts.extend(index.get(fold(name), []))
    runs = project(parts, ids, simplify_km, heights, clip=clip, min_km=min_km)
    runs.sort(key=lambda r: -_length(r))
    return runs, sum(_length(r) for r in runs), note


# --- routing: a curated item names places, the source supplies the course between them
#
# Natural Earth's roads and railways carry no names at all over India: every road record
# there has an empty name, and the railway file has no name field. So a road cannot be
# joined to a curated item the way a river is. What it does have is good geometry, split
# at junctions, which is a graph. An item lists the places its route is known by and the
# build walks the source's own parts between them, shortest first. The names and the facts
# stay in the folder; the course is still the published dataset's, never drawn by hand.

SNAP_DEG = 0.002       # endpoints this close, about 200 m, are the same junction
SLACK_PX = 3           # how far outside the ID raster a part may stray and still count


def _inside_mask(ids, slack=SLACK_PX):
    """India, widened by a few pixels, so a coastal road is not cut by a coarse raster."""
    m = ids > 0
    for _ in range(slack):
        m[1:, :] |= m[:-1, :]
        m[:-1, :] |= m[1:, :]
        m[:, 1:] |= m[:, :-1]
        m[:, :-1] |= m[:, 1:]
    return m


def _split_inside(part, mask):
    """The stretches of a part that lie inside the widened mask.

    Splitting rather than dropping: the source's parts are long, hundreds of km of them,
    and a corridor that leaves the country for one bend would take the whole road with it.
    Cut at the border, the network keeps everything of it that is here and simply ends
    where the country does.
    """
    height, width = mask.shape
    col, row = grid.lonlat_to_pixel(part[:, 0], part[:, 1], width, height)
    c = np.clip(col.astype(int), 0, width - 1)
    r = np.clip(row.astype(int), 0, height - 1)
    out, cur = [], []
    for point, good in zip(part, mask[r, c]):
        if good:
            cur.append(point)
        elif cur:
            out.append(np.array(cur))
            cur = []
    if cur:
        out.append(np.array(cur))
    return out


def network(parts, ids, waypoints=(), snap_deg=None):
    """The source inside India as a graph: nodes are shared endpoints, edges are parts.

    Every part is cut twice. First at the border, so a route can never leave the country
    and come back. Then at the vertex nearest each of the layer's waypoints, because the
    source's parts run for hundreds of km: a road passes straight through a city whose
    nearest part *endpoint* is ninety km away, and without this cut the city has nowhere
    on the network to stand.

    `snap_deg` is how far apart two ends may be and still be one junction. A published
    topology shares its endpoints exactly and wants the default; a survey drawing --
    Indian Railways' track centrelines are one -- leaves gaps of a few hundred metres at
    a third of its joins, and a layer drawn from one says how wide to close them.
    """
    snap = SNAP_DEG if snap_deg is None else float(snap_deg)
    mask = _inside_mask(ids)
    pieces = []
    for whole in parts:
        pieces.extend(p for p in _split_inside(whole, mask) if len(p) >= 2)

    # Every vertex of every piece at once, so the nearest one to a place is a single scan.
    owner = np.concatenate([np.full(len(p), i) for i, p in enumerate(pieces)]) if pieces else np.zeros(0, int)
    at = np.concatenate([np.arange(len(p)) for p in pieces]) if pieces else np.zeros(0, int)
    vx, vz = grid.lonlat_to_scene(np.concatenate([p[:, 0] for p in pieces]),
                                  np.concatenate([p[:, 1] for p in pieces]))
    cuts = [set() for _ in pieces]
    for w in waypoints:
        px, pz = grid.lonlat_to_scene(w['lon'], w['lat'])
        i = int(np.argmin(np.hypot(vx - px, vz - pz)))
        cuts[owner[i]].add(int(at[i]))

    cells, nodes, edges, adj = {}, [], [], []

    def node(lon, lat):
        cx, cy = int(lon / snap), int(lat / snap)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in cells.get((cx + dx, cy + dy), ()):
                    if abs(nodes[i][0] - lon) <= snap and abs(nodes[i][1] - lat) <= snap:
                        return i
        nodes.append((lon, lat))
        adj.append([])
        cells.setdefault((cx, cy), []).append(len(nodes) - 1)
        return len(nodes) - 1

    kept = []
    for piece, marks in zip(pieces, cuts):
        bounds = sorted({0, len(piece) - 1} | {m for m in marks if 0 < m < len(piece) - 1})
        for lo, hi in zip(bounds, bounds[1:]):
            part = piece[lo:hi + 1]
            if len(part) < 2:
                continue
            a = node(float(part[0, 0]), float(part[0, 1]))
            b = node(float(part[-1, 0]), float(part[-1, 1]))
            if a == b:
                continue
            x, z = grid.lonlat_to_scene(part[:, 0], part[:, 1])
            km = float(np.hypot(*np.diff(np.column_stack([x, z]), axis=0).T).sum())
            adj[a].append(len(edges))
            adj[b].append(len(edges))
            edges.append((a, b, len(kept), km))
            kept.append(part)
    return {'nodes': np.array(nodes), 'edges': edges, 'adj': adj, 'parts': kept}


def bridge(net, max_km):
    """
    Join what a drawing left apart: a straight edge between the nearest ends of two
    otherwise separate pieces, where they are within `max_km` of each other.

    Indian Railways' published centrelines are drawn section by section and the sections
    do not quite meet: a track that runs unbroken on the ground arrives as a thousand
    pieces with gaps of a few hundred metres between them. Nothing can be routed across
    that. Closing the gaps smallest first, and only between pieces that are not already
    joined, restores the network the drawing is of without inventing a line anywhere the
    drawing does not already go within a kilometre or two. Returns how many were closed.
    """
    nodes = net['nodes']
    if not len(nodes):
        return 0
    x, z = grid.lonlat_to_scene(nodes[:, 0], nodes[:, 1])
    pts = np.column_stack([x, z])
    parent = list(range(len(nodes)))

    def find(u):
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u
    for i in range(len(nodes)):
        for e in net['adj'][i]:
            a, b, _, _ = net['edges'][e]
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    cells = {}
    for i, (a, b) in enumerate(pts):
        cells.setdefault((int(a // max_km), int(b // max_km)), []).append(i)
    pairs = []
    for i, (a, b) in enumerate(pts):
        cx, cy = int(a // max_km), int(b // max_km)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cells.get((cx + dx, cy + dy), ()):
                    if j <= i:
                        continue
                    d = float(np.hypot(pts[j, 0] - a, pts[j, 1] - b))
                    if d <= max_km:
                        pairs.append((d, i, j))
    pairs.sort()
    added = 0
    for d, i, j in pairs:
        ri, rj = find(i), find(j)
        if ri == rj:
            continue
        parent[ri] = rj
        net['adj'][i].append(len(net['edges']))
        net['adj'][j].append(len(net['edges']))
        net['edges'].append((i, j, len(net['parts']), d))
        net['parts'].append(np.array([nodes[i], nodes[j]]))
        added += 1
    return added


def _nearest_node(net, lon, lat):
    """The node closest to a place, and how far away it is in km."""
    x, z = grid.lonlat_to_scene(net['nodes'][:, 0], net['nodes'][:, 1])
    px, pz = grid.lonlat_to_scene(lon, lat)
    d = np.hypot(x - px, z - pz)
    i = int(np.argmin(d))
    return i, float(d[i])


def _shortest(net, start, goal):
    """Dijkstra over the edges. Returns the edge indices of the path, or None."""
    import heapq
    best = {start: 0.0}
    came = {}
    queue = [(0.0, start)]
    while queue:
        cost, here = heapq.heappop(queue)
        if here == goal:
            path = []
            while here != start:
                e, here = came[here]
                path.append(e)
            return path[::-1]
        if cost > best.get(here, float('inf')):
            continue
        for e in net['adj'][here]:
            a, b, _, km = net['edges'][e]
            there = b if a == here else a
            step = cost + km
            if step < best.get(there, float('inf')):
                best[there] = step
                came[there] = (e, here)
                heapq.heappush(queue, (step, there))
    return None


MAX_SNAP_KM = 25.0     # a place further than this from the network: the route is not in the source
MAX_LEG_DETOUR = 2.0   # ... and a stretch this much longer than the flight is a detour, not the road
MIN_COVERED = 0.6      # a route the source only has scraps of is not that route


def _flight_km(a, b):
    x, z = grid.lonlat_to_scene([a['lon'], b['lon']], [a['lat'], b['lat']])
    return float(np.hypot(x[1] - x[0], z[1] - z[0]))


def route(waypoints, net, max_snap_km=MAX_SNAP_KM, max_detour=MAX_LEG_DETOUR, min_covered=MIN_COVERED):
    """Walk the source's own parts through the places a route is known by.

    A stretch the source does not hold is left out rather than gone round: asked for the
    coastal highway across a gap in its data, a shortest path will happily return six
    hundred km of inland road, which is not that highway. A stretch that comes back far
    longer than the flight between its two places is taken as such a gap, the run is
    ended there and the next one begins after it -- the route is drawn in the pieces the
    source has of it. An item that ends up with only scraps is refused outright.

    Returns (list of lon/lat arrays, note) or (None, note) with a reason in note['why'].
    """
    hops = [_nearest_node(net, w['lon'], w['lat']) for w in waypoints]
    note = {'snap': [round(d, 1) for _, d in hops]}
    far = max(range(len(hops)), key=lambda i: hops[i][1])
    if hops[far][1] > max_snap_km:
        note['why'] = f'waypoint {far + 1} is {hops[far][1]:.0f} km from the nearest line in the source'
        return None, note

    runs, cur, gaps = [], [], []
    km = covered = total = 0.0
    for leg, ((a, _), (b, _)) in enumerate(zip(hops, hops[1:])):
        flight = _flight_km(waypoints[leg], waypoints[leg + 1])
        total += flight
        path = None if a == b else _shortest(net, a, b)
        leg_km = sum(net['edges'][e][3] for e in path) if path else 0.0
        if a == b:
            continue
        if path is None or (flight > 0 and leg_km > max_detour * flight):
            gaps.append(leg + 1)
            if cur:
                runs.append(np.vstack(cur))
                cur = []
            continue
        here = a
        for e in path:
            u, v, part, _ = net['edges'][e]
            piece = net['parts'][part]
            cur.append(piece if u == here else piece[::-1])
            here = v if u == here else u
        covered += flight
        km += leg_km
    if cur:
        runs.append(np.vstack(cur))
    note.update(km=round(km, 1), flight_km=round(total, 1), gaps=gaps)
    if not runs:
        note['why'] = 'the source holds none of the stretches between these places'
        return None, note
    if total > 0 and covered < min_covered * total:
        note['why'] = f'the source holds only {covered / total * 100:.0f}% of the way between these places'
        return None, note
    return runs, note
