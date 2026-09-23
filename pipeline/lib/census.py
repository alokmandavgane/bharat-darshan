"""India's 2011 districts: the census's own table and the polygons it was counted in.

A district choropleth has to be drawn on the districts its numbers were counted in. The
785 polygons the district layer draws are the Local Government Directory's of 2024, and
145 of them did not exist in 2011; the other 640 carry a 2011 code, but a split district's
surviving polygon is what is left after the split, not the district the census counted
(PLAN.md section 7, "District boundaries"). So the census maps draw the census's own
640 districts, from DataMeet's `Census_2011` layer, keyed by the 2011 code the table is
keyed by: the numbers and the shapes are the same vintage and meet on a code, not a name.

The table is the Primary Census Abstract for India, states and districts
(`DDW_PCA0000_2011_Indiastatedist.xlsx`), the Registrar General's own spreadsheet. Its
address on censusindia.gov.in went dead when the site was rebuilt, so it is fetched from
the Internet Archive's copy of that address: the same file, byte for byte, and the one
place it can still be had without a browser session. An .xlsx is a zip of XML, which the
standard library reads.
"""
import os
import re
import xml.etree.ElementTree as ET
import zipfile

import numpy as np

from . import fetch, grid, raster, shapefile

PCA_URL = ('https://web.archive.org/web/20210129220021id_/'
           'https://www.censusindia.gov.in/pca/DDW_PCA0000_2011_Indiastatedist.xlsx')
DISTRICTS_URL = 'https://raw.githubusercontent.com/datameet/maps/master/Districts/Census_2011/2011_Dist'
RAW = os.path.join(fetch.RAW, 'census-2011')

_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def _sheet_rows(path):
    """Every row of the workbook's first sheet as {column letter: text}."""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(_NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(_NS + 't')))
    for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(_NS + 'row'):
        out = {}
        for c in row.iter(_NS + 'c'):
            v = c.find(_NS + 'v')
            if v is None:
                continue
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            out[col] = shared[int(v.text)] if c.get('t') == 's' else v.text
        yield out


def pca_districts():
    """
    The abstract's district rows, totals only: {2011 district code: {column: int}}, with
    `Name` and `State` (the state's 2011 code) kept as they are.
    """
    path = os.path.join(RAW, 'DDW_PCA0000_2011_Indiastatedist.xlsx')
    fetch.download(PCA_URL, path, quiet=True)
    rows = _sheet_rows(path)
    head = next(rows)
    out = {}
    for r in rows:
        rec = {head[k]: v for k, v in r.items() if k in head}
        if rec.get('Level') != 'DISTRICT' or rec.get('TRU') != 'Total':
            continue
        code = int(rec['District'])
        out[code] = {k: (v if k in ('Name', 'Level', 'TRU') else int(float(v))) for k, v in rec.items()}
        out[code]['State'] = int(rec['State'])
    return out


def measure(row, spec):
    """
    One number from a district's row: the sum of the numerator's columns over the sum of
    the denominator's, times `per`. A column written `-P_06` is subtracted, which is how
    the census's effective literacy rate leaves out the children under seven.
    """
    def total(cols):
        return sum(-row[c[1:]] if c.startswith('-') else row[c] for c in cols)
    den = total(spec['denominator'])
    if den <= 0:
        return None
    digits = spec.get('digits', 0)
    value = round(total(spec['numerator']) / den * spec.get('per', 1), digits)
    return int(value) if digits == 0 else value


def district_polygons():
    """
    The census's 640 districts, [(2011 code, name, state name, tagged rings)], and the
    one polygon it could not count.
    """
    base = os.path.join(RAW, '2011_Dist')
    for ext in ('shp', 'shx', 'dbf'):
        fetch.download(f'{DISTRICTS_URL}.{ext}', f'{base}.{ext}', quiet=True)
    out, uncounted = [], []
    for row, rings in shapefile.read_features(base + '.shp', base + '.dbf'):
        # One polygon has code 0 and is named "Data Not Available": Pakistan-occupied
        # Kashmir, which the census could not count. It gets no id, so it stays clay.
        if int(row['censuscode'] or 0):
            out.append((int(row['censuscode']), row['DISTRICT'], row['ST_NM'], rings))
        else:
            uncounted.extend(rings)
    return out, uncounted


def district_raster(width, height, inside):
    """
    The 2011 districts as one uint16 id raster, each pixel its district's 2011 code (0 for
    none), cut to `inside` -- India's own outline, so the Survey's boundary is the one that
    shows. Biggest first, so an enclave drawn later sits on top of the district around it.
    """
    polys, uncounted = district_polygons()
    px = lambda r: np.column_stack(grid.lonlat_to_pixel(r[:, 0], r[:, 1], width, height))  # noqa: E731
    shapes = []
    for code, _name, _state, rings in polys:
        shapes.append((code, [(px(r), hole) for r, hole in rings]))
    shapes.sort(key=lambda s: -sum(abs(shapefile.signed_area(r)) for r, hole in s[1] if not hole))
    ids = raster.rasterise(shapes, width, height)
    blank = raster.rasterise([(1, [(px(r), hole) for r, hole in uncounted])], width, height) > 0
    # One survey's coast never quite meets another's: the slivers inside India that no
    # district reached take the nearest district's id rather than showing as clay specks.
    # Never inside the uncounted polygon, which is meant to stay blank.
    ids = raster.fill_nearest(ids, inside & ~blank, max_iter=8)
    ids[blank] = 0
    return np.where(inside, ids, 0).astype(np.uint16), polys
