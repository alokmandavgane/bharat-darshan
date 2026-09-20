"""A minimal ESRI shapefile reader: polygons (types 5, 15, 25) plus the .dbf attributes.

Enough for the boundary files we consume; not a general library. Returns rings as
numpy arrays of (lon, lat) in the file's own CRS (the files we use are WGS 84 degrees).
Exterior rings are clockwise in shapefiles, holes counter-clockwise.
"""
import struct

import numpy as np

POLYGON_TYPES = (5, 15, 25)


def read_dbf(path, encoding='latin-1'):
    b = open(path, 'rb').read()
    nrec, = struct.unpack('<I', b[4:8])
    hlen, rlen = struct.unpack('<HH', b[8:12])
    fields = []
    p = 32
    while b[p] != 0x0D:
        name = b[p:p + 11].split(b'\0')[0].decode('ascii')
        typ = chr(b[p + 11])
        flen = b[p + 16]
        fields.append((name, typ, flen))
        p += 32
    rows = []
    for i in range(nrec):
        rec = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        q = 1  # deletion flag
        row = {}
        for name, typ, flen in fields:
            raw = rec[q:q + flen].decode(encoding, 'replace').strip()
            q += flen
            if typ in ('N', 'F') and raw:
                try:
                    raw = int(raw) if '.' not in raw else float(raw)
                except ValueError:
                    pass
            row[name] = raw
        rows.append(row)
    return fields, rows


def read_polygons(shp_path):
    """Yield (record_number, [ring arrays]) for every polygon record; null shapes give []."""
    b = open(shp_path, 'rb').read()
    shape_type, = struct.unpack('<i', b[32:36])
    if shape_type not in POLYGON_TYPES:
        raise ValueError(f'{shp_path}: shape type {shape_type} is not a polygon type')
    pos = 100
    while pos < len(b):
        num, content_len = struct.unpack('>ii', b[pos:pos + 8])
        pos += 8
        end = pos + content_len * 2
        st, = struct.unpack('<i', b[pos:pos + 4])
        rings = []
        if st in POLYGON_TYPES:
            nparts, npts = struct.unpack('<ii', b[pos + 36:pos + 44])
            parts = np.frombuffer(b, dtype='<i4', count=nparts, offset=pos + 44)
            pts = np.frombuffer(b, dtype='<f8', count=npts * 2, offset=pos + 44 + nparts * 4).reshape(npts, 2)
            bounds = list(parts) + [npts]
            for i in range(nparts):
                ring = pts[bounds[i]:bounds[i + 1]]
                if len(ring) >= 4:
                    rings.append(np.array(ring))
        yield num, rings
        pos = end


def signed_area(ring):
    """Shoelace area with y up: negative = clockwise = exterior ring (shapefile convention)."""
    x, y = ring[:, 0], ring[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def read_features(shp_path, dbf_path):
    """List of (attributes, rings) with rings tagged: [(ring, is_hole), ...]."""
    _, rows = read_dbf(dbf_path)
    feats = []
    for (num, rings), row in zip(read_polygons(shp_path), rows):
        tagged = [(r, signed_area(r) > 0) for r in rings]
        feats.append((row, tagged))
    return feats
