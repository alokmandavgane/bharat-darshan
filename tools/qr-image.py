#!/usr/bin/env python3
"""Renders the QR codes under public/share/ that point at the live site.

    python3 tools/qr-image.py

Like tools/share-image.mjs, this is a tool rather than a project dependency: it needs
Pillow (built with libraqm, for Devanagari shaping) and the `qrcode` package, neither
of which appears in package.json or the pipeline's requirements.

    pip install pillow qrcode

The title is set in Yatra One, the same face the site self-hosts as
public/fonts/yatra-one.woff2; Pillow cannot read woff2, so the TrueType build sits in
tools/fonts/ under the SIL Open Font License already recorded in
public/fonts/YatraOne-OFL.txt. The Open Graph cards are not made here: tools/
share-image.mjs renders those from the app itself, which is why they always match it.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'tools', 'fonts', 'YatraOne-Regular.ttf')
OUT = os.path.join(ROOT, 'public', 'share')

URL = os.environ.get('SITE_URL', 'https://darshan.alokm.com')
TITLE_HI = 'भारत दर्शन'
TITLE_EN = 'BHARAT DARSHAN'

INK = (31, 26, 23)
TERRA = (217, 84, 30)
SAFFRON = (255, 153, 51)
GREEN = (19, 136, 8)
BOX = 40
BORDER = 4


def tint(colour, amount):
    return tuple(int(255 + (v - 255) * amount) for v in colour)


def tricolour(width, height, blur, amount=0.16):
    """Three soft bands: a wash, deliberately not a rendering of the flag."""
    img = Image.new('RGB', (width, height), 'white')
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, width, height / 3), fill=tint(SAFFRON, amount))
    d.rectangle((0, 2 * height / 3, width, height), fill=tint(GREEN, amount))
    return img.filter(ImageFilter.GaussianBlur(blur))


def draw_title(d, baseline, width, size_hi, size_en, tracking):
    hi = ImageFont.truetype(FONT, size_hi)
    en = ImageFont.truetype(FONT, size_en)
    bb = d.textbbox((0, 0), TITLE_HI, font=hi, language='hi')
    d.text(((width - (bb[2] - bb[0])) // 2 - bb[0], baseline - bb[1]), TITLE_HI,
           font=hi, fill=INK, language='hi')
    y = baseline + (bb[3] - bb[1]) + 34
    d.rectangle(((width - 180) // 2, y, (width + 180) // 2, y + 6), fill=TERRA)
    y += 34
    bb2 = d.textbbox((0, 0), TITLE_EN, font=en)
    x = (width - (bb2[2] - bb2[0]) - tracking * (len(TITLE_EN) - 1)) // 2
    for ch in TITLE_EN:
        d.text((x, y - bb2[1]), ch, font=en, fill=INK)
        x += d.textlength(ch, font=en) + tracking


def main():
    try:
        import qrcode
    except ImportError:
        sys.exit('needs the qrcode package: pip install qrcode')

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,
                       box_size=1, border=BORDER)
    qr.add_data(URL)
    qr.make(fit=True)
    side = (qr.modules_count + 2 * BORDER) * BOX
    modules = (qr.make_image(fill_color='black', back_color='white').convert('L')
               .resize((side, side), Image.NEAREST).point(lambda v: 255 if v < 128 else 0))

    os.makedirs(OUT, exist_ok=True)

    plain = tricolour(side, side, BOX * 0.6)
    plain.paste(INK, (0, 0), modules)
    plain.resize((800, 800), Image.LANCZOS).save(os.path.join(OUT, 'qr-plain-800.png'), optimize=True)

    height = side + 460 - BORDER * BOX // 2
    titled = tricolour(side, height, BOX * 0.6)
    titled.paste(INK, (0, 0), modules)
    draw_title(ImageDraw.Draw(titled), side - BORDER * BOX // 2 - 10, side, 190, 74, 10)
    titled.save(os.path.join(OUT, 'qr.png'), optimize=True)
    titled.resize((800, round(800 * height / side)), Image.LANCZOS).save(
        os.path.join(OUT, 'qr-800.png'), optimize=True)

    for name in ('qr.png', 'qr-800.png', 'qr-plain-800.png'):
        p = os.path.join(OUT, name)
        print(f'wrote public/share/{name}  {os.path.getsize(p) // 1024} KB  {Image.open(p).size}')


if __name__ == '__main__':
    main()
