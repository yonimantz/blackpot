"""Build the Windows icon from the SpotOn SVG mark.

Run this only when the mark or the colours below change; the generated .ico is
committed so a normal build does not need an SVG renderer.

    python packaging/make_icon.py

The source SVG is a traced black shape on transparency. It is rasterized on
white, turned back into an alpha mask, tinted, and centred on a rounded square
so the icon stays legible on both light and dark Windows backgrounds.
"""

import os
import sys

from PIL import Image, ImageDraw
from reportlab.graphics import renderPM
from svglib.svglib import svg2rlg

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATH = os.path.join(REPO_ROOT, 'frontend', 'src', 'assets', 'SpotOn-Icon.svg')
ICO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SpotOn.ico')
PREVIEW_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SpotOn-icon-preview.png')

# Matches --bg-panel and --accent in frontend/src/App.css.
BACKGROUND = (99, 102, 241, 255)
MARK = (255, 255, 255, 255)

CANVAS = 1024
CORNER_RADIUS = 0.22  # share of canvas width
MARK_SCALE = 0.62  # share of canvas the mark's longest side occupies
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def render_mark_mask() -> Image.Image:
    """Rasterize the SVG and return its coverage as a trimmed alpha mask."""
    drawing = svg2rlg(SVG_PATH)
    if drawing is None:
        raise SystemExit(f'Could not parse {SVG_PATH}')
    scale = CANVAS / max(drawing.width, drawing.height)
    drawing.scale(scale, scale)
    drawing.width *= scale
    drawing.height *= scale

    rendered = renderPM.drawToPIL(drawing, bg=0xFFFFFF).convert('L')
    # Black artwork on a white page inverts straight into coverage.
    mask = Image.eval(rendered, lambda v: 255 - v)
    bbox = mask.getbbox()
    if bbox is None:
        raise SystemExit('The rendered SVG was blank.')
    return mask.crop(bbox)


def build_icon() -> Image.Image:
    mask = render_mark_mask()

    target = int(CANVAS * MARK_SCALE)
    ratio = target / max(mask.size)
    mark_size = (max(1, round(mask.width * ratio)), max(1, round(mask.height * ratio)))
    mask = mask.resize(mark_size, Image.LANCZOS)

    icon = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(icon).rounded_rectangle(
        (0, 0, CANVAS - 1, CANVAS - 1),
        radius=int(CANVAS * CORNER_RADIUS),
        fill=BACKGROUND,
    )

    mark = Image.new('RGBA', mark_size, MARK)
    icon.paste(
        mark,
        ((CANVAS - mark_size[0]) // 2, (CANVAS - mark_size[1]) // 2),
        mask,
    )
    return icon


def main() -> None:
    icon = build_icon()
    icon.save(PREVIEW_PATH, format='PNG')
    icon.save(ICO_PATH, format='ICO', sizes=[(s, s) for s in ICO_SIZES])
    print(f'wrote {ICO_PATH} ({os.path.getsize(ICO_PATH) // 1024} KB)')
    print(f'wrote {PREVIEW_PATH}')


if __name__ == '__main__':
    sys.exit(main())
