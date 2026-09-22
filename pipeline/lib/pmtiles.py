"""A PMTiles reader with a Mapbox Vector Tile decoder, standard library and numpy only.

Some of the best sources for India are published only as tile archives: India-WRIS's
river network reaches us through a catalogue that ships PMTiles, Parquet and 7z, and of
the three only a tile archive can be read without adding a dependency. PMTiles (v3) is
a header, a few gzipped directories and a run of gzipped tiles; a vector tile is a small
protobuf. Both specifications are short, and this is the part of them a line layer needs.

What comes out is features, not tiles: each tile's geometry is clipped to the tile's own
square -- the archive draws a buffer past it, so neighbours overlap -- which makes the
pieces on either side of a tile edge end on the same line, and the caller's `stitch`
joins them back into rivers.

Specifications: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md and
https://github.com/mapbox/vector-tile-spec/tree/master/2.1
"""
import gzip
import math
import struct

import numpy as np


# --- varints and protobuf fields ---------------------------------------------------------

def _varint(buf, i):
    out = shift = 0
    while True:
        b = buf[i]
        i += 1
        out |= (b & 0x7F) << shift
        if b < 0x80:
            return out, i
        shift += 7


def _fields(buf):
    """(field number, wire type, value) for every field of one protobuf message."""
    i, n = 0, len(buf)
    while i < n:
        key, i = _varint(buf, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            v, i = _varint(buf, i)
        elif wire == 2:
            size, i = _varint(buf, i)
            v = buf[i:i + size]
            i += size
        elif wire == 1:
            v = buf[i:i + 8]
            i += 8
        elif wire == 5:
            v = buf[i:i + 4]
            i += 4
        else:
            raise ValueError(f'protobuf wire type {wire} is not supported')
        yield field, wire, v


def _packed(buf):
    out, i, n = [], 0, len(buf)
    while i < n:
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _zigzag(v):
    return (v >> 1) ^ -(v & 1)


# --- the archive ------------------------------------------------------------------------

def _decompress(data, kind):
    if kind in (0, 1):          # unknown or none
        return data
    if kind == 2:
        return gzip.decompress(data)
    raise ValueError(f'PMTiles compression {kind} is not supported (gzip only)')


def _directory(buf):
    """The entries of one directory: (tile_id, offset, length, run_length)."""
    n, i = _varint(buf, 0)
    ids, runs, lens, offs = [], [], [], []
    last = 0
    for _ in range(n):
        d, i = _varint(buf, i)
        last += d
        ids.append(last)
    for _ in range(n):
        v, i = _varint(buf, i)
        runs.append(v)
    for _ in range(n):
        v, i = _varint(buf, i)
        lens.append(v)
    for k in range(n):
        v, i = _varint(buf, i)
        # An offset of zero means "straight after the previous tile", which is how a
        # clustered archive writes most of its entries.
        offs.append(offs[k - 1] + lens[k - 1] if v == 0 and k > 0 else v - 1)
    return list(zip(ids, offs, lens, runs))


def _tile_id_to_zxy(tile_id):
    """Invert PMTiles' tile id: tiles counted zoom by zoom, each zoom along a Hilbert curve."""
    acc, z = 0, 0
    while True:
        count = 4 ** z
        if tile_id < acc + count:
            break
        acc += count
        z += 1
    pos, n = tile_id - acc, 2 ** z
    x = y = 0
    s, t = 1, pos
    while s < n:
        rx = 1 & (t // 2)
        ry = 1 & (t ^ rx)
        if ry == 0:
            if rx == 1:
                x, y = s - 1 - x, s - 1 - y
            x, y = y, x
        x += s * rx
        y += s * ry
        t //= 4
        s *= 2
    return z, x, y


class Archive:
    """One PMTiles file on disk."""

    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            head = f.read(127)
        if head[:7] != b'PMTiles' or head[7] != 3:
            raise ValueError(f'{path} is not a version 3 PMTiles archive')
        (self.root_off, self.root_len, self.meta_off, self.meta_len, self.leaf_off,
         self.leaf_len, self.data_off, self.data_len) = struct.unpack('<8Q', head[8:72])
        self.internal = head[97]
        self.tile_compression = head[98]
        self.tile_type = head[99]
        self.min_zoom, self.max_zoom = head[100], head[101]
        if self.tile_type != 1:
            raise ValueError(f'{path} holds tile type {self.tile_type}, not vector tiles')

    def _read(self, off, length):
        with open(self.path, 'rb') as f:
            f.seek(off)
            return f.read(length)

    def tiles(self, zoom):
        """(z, x, y, raw tile bytes) for every tile at one zoom."""
        want = [(self.root_off, self.root_len, False)]
        found = []
        while want:
            off, length, leaf = want.pop()
            base = self.leaf_off if leaf else 0
            entries = _directory(_decompress(self._read(base + off if leaf else off, length), self.internal))
            for tid, toff, tlen, run in entries:
                if run == 0:
                    want.append((toff, tlen, True))
                    continue
                for k in range(run):
                    z, x, y = _tile_id_to_zxy(tid + k)
                    if z == zoom:
                        found.append((z, x, y, toff, tlen))
        with open(self.path, 'rb') as f:
            for z, x, y, toff, tlen in sorted(found, key=lambda t: t[3]):
                f.seek(self.data_off + toff)
                yield z, x, y, _decompress(f.read(tlen), self.tile_compression)


# --- vector tiles ------------------------------------------------------------------------

def _value(buf):
    for field, wire, v in _fields(buf):
        if field == 1:
            return v.decode('utf-8', 'replace')
        if field == 2:
            return struct.unpack('<f', v)[0]
        if field == 3:
            return struct.unpack('<d', v)[0]
        if field in (4, 5):
            return v
        if field == 6:
            return _zigzag(v)
        if field == 7:
            return bool(v)
    return None


def _lines(geometry):
    """Decode a feature's command stream into lists of (x, y) in tile units."""
    out, cur = [], None
    x = y = i = 0
    n = len(geometry)
    while i < n:
        cmd = geometry[i]
        i += 1
        op, count = cmd & 7, cmd >> 3
        if op == 7:                               # ClosePath
            if cur:
                cur.append(cur[0])
            continue
        for _ in range(count):
            x += _zigzag(geometry[i])
            y += _zigzag(geometry[i + 1])
            i += 2
            if op == 1:                           # MoveTo starts a new part
                if cur and len(cur) > 1:
                    out.append(cur)
                cur = [(x, y)]
            else:                                 # LineTo
                cur.append((x, y))
    if cur and len(cur) > 1:
        out.append(cur)
    return out


def _clip_to_square(pts, extent):
    """
    Cut a polyline to the tile's own square, [0, extent] on both axes.

    The archive draws each tile with a buffer past its edges, so neighbouring tiles
    overlap. Clipping both to the shared edge makes their pieces end on the same line,
    which is what lets them be stitched back into one course.
    """
    out, cur = [], []

    def inside(p):
        return 0 <= p[0] <= extent and 0 <= p[1] <= extent

    def cross(a, b):
        # The point where a->b meets the square's boundary, taking the nearest crossing.
        best = None
        for axis, edge in ((0, 0), (0, extent), (1, 0), (1, extent)):
            d = b[axis] - a[axis]
            if d == 0:
                continue
            t = (edge - a[axis]) / d
            if 0 <= t <= 1:
                p = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                if -1e-9 <= p[0] <= extent + 1e-9 and -1e-9 <= p[1] <= extent + 1e-9:
                    if best is None or t < best[0]:
                        best = (t, p)
        return best

    for k, p in enumerate(pts):
        if k == 0:
            if inside(p):
                cur = [p]
            continue
        a, b = pts[k - 1], p
        ia, ib = inside(a), inside(b)
        if ia and ib:
            cur.append(b)
        elif ia and not ib:
            hit = cross(b, a)
            if hit:
                cur.append(hit[1])
            if len(cur) > 1:
                out.append(cur)
            cur = []
        elif not ia and ib:
            hit = cross(a, b)
            cur = [hit[1], b] if hit else [b]
        else:
            # Both outside: the segment may still pass through a corner of the square.
            first = cross(a, b)
            last = cross(b, a)
            if first and last and first[1] != last[1]:
                out.append([first[1], last[1]])
    if len(cur) > 1:
        out.append(cur)
    return out


def features(archive, zoom, layer=None, polygons=False):
    """
    Every line feature of one zoom -- or every polygon, with `polygons` -- as
    (properties, [(n, 2) lon/lat arrays]).

    A line is clipped to each tile's own square before it leaves, so a feature that
    crosses tiles arrives as several pieces meeting exactly on the tile edges. A polygon
    is left as the tile drew it, buffer and all: each tile's piece is the polygon cut to
    a box, the union of the pieces is the polygon, and anything that fills them -- a
    raster -- fills the overlaps with the same id twice and loses nothing.

    Rings come out wound the way a shapefile winds them (outer clockwise in lon/lat, holes
    the other way) without being touched, so the polygon reader that already knows
    shapefiles knows these.
    """
    for z, tx, ty, data in archive.tiles(zoom):
        scale = 2 ** z
        for field, _, lbuf in _fields(data):
            if field != 3:
                continue
            name, keys, values, extent, feats = None, [], [], 4096, []
            for f2, _, v in _fields(lbuf):
                if f2 == 1:
                    name = v.decode('utf-8', 'replace')
                elif f2 == 2:
                    feats.append(v)
                elif f2 == 3:
                    keys.append(v.decode('utf-8', 'replace'))
                elif f2 == 4:
                    values.append(_value(v))
                elif f2 == 5:
                    extent = v
            if layer and name != layer:
                continue
            for fbuf in feats:
                tags, gtype, geom = [], 0, []
                for f3, _, v in _fields(fbuf):
                    if f3 == 2:
                        tags = _packed(v)
                    elif f3 == 3:
                        gtype = v
                    elif f3 == 4:
                        geom = _packed(v)
                if gtype != (3 if polygons else 2):
                    continue
                props = {keys[tags[k]]: values[tags[k + 1]] for k in range(0, len(tags) - 1, 2)}
                parts = []
                for line in _lines(geom):
                    # A vector tile's outer ring has a positive area with y pointing down;
                    # turned into latitude, which points up, that is clockwise -- already the
                    # way a shapefile winds it, so a polygon passes through as it is.
                    pieces = [line] if polygons else _clip_to_square(line, extent)
                    for piece in pieces:
                        a = np.asarray(piece, dtype=np.float64)
                        lon = (tx + a[:, 0] / extent) / scale * 360.0 - 180.0
                        yy = (ty + a[:, 1] / extent) / scale
                        lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * yy))))
                        parts.append(np.column_stack([lon, lat]))
                if parts:
                    yield props, parts
