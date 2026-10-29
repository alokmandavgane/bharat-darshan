#!/usr/bin/env python3
"""Draws the site's icons: भ in Yatra One, the wordmark's face, on a terracotta counter.

    python3 tools/favicon.py

Writes, into public/ (so they land at the site root):
  favicon.svg           what browsers use when they can (index.html links it first)
  favicon.ico           16, 32 and 48 px, for the rest and for a bare /favicon.ico
  apple-touch-icon.png  180 px and square, for an iPhone's home screen, which rounds
                        the corners itself

Like tools/qr-image.py, a tool rather than a project dependency: it needs fontTools (for
the glyph's outline, which an SVG favicon cannot borrow from a webfont), Pillow and numpy.

    pip install fonttools pillow numpy

The SVG is drawn from the outline and the bitmaps by FreeType from the same font, placed
by the same bounds, so they agree. The colours are style.css's --accent pair and
--accent-ink: the counter is lit from the upper left, as the map is.
"""
import os

import numpy as np
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'tools', 'fonts', 'YatraOne-Regular.ttf')
OUT = os.path.join(ROOT, 'public')

LETTER = 'भ'
BOX = 64           # the icon's own units
GLYPH = 40         # the letter fits a square this big, centred
RADIUS = 14        # the counter's corners
LIGHT, DEEP, INK = '#d66b3d', '#9a3d1a', '#fff6e8'


def rgb(hex_colour):
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))


def number(n):
    return f'{n:.2f}'.rstrip('0').rstrip('.')


def glyph():
    """The letter's glyph, its bounds in font units, and the font's units per em."""
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    g = glyphs[font.getBestCmap()[ord(LETTER)]]
    pen = BoundsPen(glyphs)
    g.draw(pen)
    return glyphs, g, pen.bounds, font['head'].unitsPerEm


def placement(bounds, scale, size):
    """Where the glyph's origin goes so its bounds sit centred in a `size` square, y down."""
    x0, y0, x1, y1 = bounds
    return size / 2 - scale * (x0 + x1) / 2, size / 2 + scale * (y0 + y1) / 2


def svg(glyphs, g, bounds):
    scale = GLYPH / max(bounds[2] - bounds[0], bounds[3] - bounds[1])
    x, y = placement(bounds, scale, BOX)
    path = SVGPathPen(glyphs, ntos=number)
    g.draw(TransformPen(path, (scale, 0, 0, -scale, x, y)))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BOX} {BOX}">'
        f'<defs><linearGradient id="clay" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{LIGHT}"/><stop offset="1" stop-color="{DEEP}"/>'
        f'</linearGradient></defs>'
        f'<rect width="{BOX}" height="{BOX}" rx="{RADIUS}" fill="url(#clay)"/>'
        f'<path fill="{INK}" d="{path.getCommands()}"/></svg>\n'
    )


def bitmap(bounds, upm, size, rounded):
    """The icon at `size` px, drawn four times larger and brought down for smooth edges."""
    big = size * 4
    t = np.add.outer(np.arange(big), np.arange(big)) / (2 * (big - 1))  # the SVG's diagonal
    clay = np.array(rgb(LIGHT)) * (1 - t[..., None]) + np.array(rgb(DEEP)) * t[..., None]
    im = Image.fromarray(clay.round().astype(np.uint8), 'RGB').convert('RGBA')
    px = round(GLYPH * big / BOX / max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * upm)
    x, y = placement(bounds, px / upm, big)
    ImageDraw.Draw(im).text((x, y), LETTER, font=ImageFont.truetype(FONT, px), fill=INK, anchor='ls')
    if rounded:
        mask = Image.new('L', (big, big))
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), RADIUS * big / BOX, fill=255)
        im.putalpha(mask)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def main():
    glyphs, g, bounds, upm = glyph()
    with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg(glyphs, g, bounds))
    bitmap(bounds, upm, 256, rounded=True).save(
        os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    bitmap(bounds, upm, 180, rounded=False).convert('RGB').save(
        os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
    for name in ('favicon.svg', 'favicon.ico', 'apple-touch-icon.png'):
        print(f'{name}: {os.path.getsize(os.path.join(OUT, name)):,} bytes')


if __name__ == '__main__':
    main()
