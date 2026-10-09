#!/usr/bin/env python3
"""Builds hooks/emblem.ts: the Chrysaki mark as terminal mosaic cells.

The mark is the pointy-top hexagon of chrysaki-mark.svg: three rhombus faces
around a centre, and a Blonde diamond at the centre. This script rasterizes
that geometry onto a fine sample grid, then picks for each cell the glyph and
the two colours that match it best. The flat-top cube marks it draws by hand.
The band uses a cube: its steep sides suit cells taller than wide.

It learns each block glyph's shape from the font itself, so it needs no
Unicode 16 data: it renders the glyph and samples it.

Usage:
  python3 tools/emblem.py [--font PATH] [--preview out.png]
"""
import argparse
import json
import os
from collections import Counter

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'hooks', 'emblem.ts')
FONT = '/usr/share/fonts/TTF/IosevkaTermSlabNerdFontMono-Regular.ttf'

# The mark's geometry, in its 64 by 64 viewBox.
HEX = [(32, 4), (56.25, 18), (56.25, 46), (32, 60), (7.75, 46), (7.75, 18)]
TOP = [(32, 32), (7.75, 18), (32, 4), (56.25, 18)]
RIGHT = [(32, 32), (56.25, 18), (56.25, 46), (32, 60)]
LEFT = [(32, 32), (32, 60), (7.75, 46), (7.75, 18)]
# This script draws the core larger than the mark's own, so it survives at
# 2 rows.
CORE = [(32, 23), (40, 32), (32, 41), (24, 32)]

# Palettes: one colour per face, then the core. Each face keeps one flat
# colour, so the mark reads the same at every size.
PALETTES = {
    # One hue: three Emerald tones and the Blonde core.
    'emerald': {'top': '#1a8a6a', 'right': '#14664e', 'left': '#0e4a38', 'core': '#fbb13c'},
    # The mark's own tri-primary faces, at their light tones for a dark ground.
    'tri': {'top': '#1a8a6a', 'right': '#583090', 'left': '#1c3d7a', 'core': '#fbb13c'},
    # A single colour, the core only for contrast.
    'mono': {'top': '#1a8a6a', 'right': '#1a8a6a', 'left': '#1a8a6a', 'core': '#fbb13c'},
}

import os as _os
ROWS = int(_os.environ.get('EMBLEM_ROWS', '2'))
COLS = int(_os.environ.get('EMBLEM_COLS', '4'))


MW, MH = 8, 20  # mask resolution per cell


def glyph_masks(font_path):
    """Each candidate glyph as a coverage mask of MW by MH, from the font."""
    size = 160
    font = ImageFont.truetype(font_path, size)
    ascent, descent = font.getmetrics()
    width = round(font.getlength('M'))
    height = ascent + descent
    ranges = [(0x2580, 0x25A0), (0x25E2, 0x25E6), (0x1FB00, 0x1FB8C), (0x1CD00, 0x1CDE6), (0xE0B8, 0xE0C0)]
    candidates = [' '] + [chr(c) for a, b in ranges for c in range(a, b)]
    masks = {}
    for ch in candidates:
        img = Image.new('L', (width, height), 0)
        ImageDraw.Draw(img).text((0, 0), ch, font=font, fill=255)
        small = img.resize((MW, MH), Image.BOX)
        mask = tuple(1 if small.getpixel((x, y)) > 127 else 0 for y in range(MH) for x in range(MW))
        masks.setdefault(mask, ch)
    return [(m, ch) for m, ch in masks.items()]


def cell_aspect(font_path):
    font = ImageFont.truetype(font_path, 100)
    ascent, descent = font.getmetrics()
    return font.getlength('M') / (ascent + descent)


def rasterize(palette, aspect, scale=6):
    """The mark on a grid of MW by MH samples per cell. A sample the hexagon
    does not cover is None."""
    px_w, px_h = COLS * MW, ROWS * MH
    # One sample is (cell width / MW) by (cell height / MH), in cell heights.
    pw, ph = aspect / MW, 1 / MH
    unit = (px_h * ph) / 56.0
    # Fit the width when the grid is narrower than the mark wants.
    unit = min(unit, (px_w * pw) / 48.5)
    off_x = (px_w * pw - 48.5 * unit) / 2 - 7.75 * unit
    off_y = (px_h * ph - 56 * unit) / 2 - 4 * unit
    W, H = px_w * scale, px_h * scale
    img = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)

    def pts(poly):
        return [((x * unit + off_x) / pw * scale, (y * unit + off_y) / ph * scale) for x, y in poly]

    keys = {}
    for i, (name, poly) in enumerate([('top', TOP), ('right', RIGHT), ('left', LEFT), ('core', CORE)]):
        colour = (i + 1, 0, 0)
        keys[colour] = name
        d.polygon(pts(poly), fill=colour)
    grid = []
    for py in range(px_h):
        row = []
        for px in range(px_w):
            votes = Counter(img.getpixel((px * scale + sx, py * scale + sy)) for sx in range(scale) for sy in range(scale))
            colour, _ = votes.most_common(1)[0]
            name = keys.get(colour)
            row.append(palette[name] if name else None)
        grid.append(row)
    return grid


def cells(grid, masks):
    """Per cell, the glyph and two colours that best match the samples."""
    out = []
    for r in range(ROWS):
        row = []
        for c in range(COLS):
            px = [grid[r * MH + y][c * MW + x] for y in range(MH) for x in range(MW)]
            present = [p for p, _ in Counter(px).most_common(3)]
            if present == [None]:
                row.append([' ', None, None])
                continue
            best = None
            pairs = [(a, b) for a in present for b in present if a != b and a is not None] + [(a, None) for a in present if a is not None]
            for fg, bg in pairs:
                for mask, ch in masks:
                    err = sum(1 for m, p in zip(mask, px) if (fg if m else bg) != p)
                    if best is None or err < best[0]:
                        best = (err, ch, fg, bg)
            _, ch, fg, bg = best
            row.append([ch, None if ch == ' ' else fg, bg])
        out.append(row)
    return out


def cube(palette, core=True):
    """The mark as a flat-top hexagon, 6 cells by 2 rows, drawn by hand.

    Terminal cells are about 2.5 times taller than wide, so a pointy-top
    hexagon's 30 degree edges come out as steps. A flat-top hexagon's sides
    are steep, and one triangle glyph per side draws each one cleanly. The
    three faces meet at the centre like the mark's: the top face upper left,
    the left face lower left, the right face on the right. The split between
    the two left faces falls on the row boundary.
    """
    t, l, r, k = palette['top'], palette['left'], palette['right'], palette['core']
    # Powerline slants fill the whole cell, in the font and in Ghostty's own
    # sprites. The geometric triangles (U+25E2) do not.
    lr, ll, ul, ur = '\ue0ba', '\ue0b8', '\ue0bc', '\ue0be'
    row0 = [[lr, t, None], ['█', t, None], [lr, k, t] if core else ['█', t, None], [lr, r, k if core else t], ['█', r, None], [ll, r, None]]
    row1 = [[ur, l, None], ['█', l, None], [ur, k, l] if core else ['█', l, None], [ur, r, k if core else l], ['█', r, None], [ul, r, None]]
    return [row0, row1]


def preview(all_cells, font_path, path):
    size = 48
    font = ImageFont.truetype(font_path, size)
    ascent, descent = font.getmetrics()
    cw, ch = round(font.getlength('M')), ascent + descent
    gap = 2
    W = (COLS + gap) * cw * len(all_cells) + cw * 2
    img = Image.new('RGB', (W, ROWS * ch + 2 * ch), (15, 17, 23))
    d = ImageDraw.Draw(img)
    for i, (name, cs) in enumerate(all_cells.items()):
        x0 = cw + i * (COLS + gap) * cw
        for r, row in enumerate(cs):
            for c, (g, fg, bg) in enumerate(row):
                x, y = x0 + c * cw, ch + r * ch
                if bg:
                    d.rectangle([x, y, x + cw - 1, y + ch - 1], fill=bg)
                if fg and g != ' ':
                    d.text((x, y), g, font=font, fill=fg)
        d.text((x0, ROWS * ch + ch + 4), name, font=ImageFont.truetype(font_path, 20), fill=(160, 164, 184))
    img.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', default=FONT)
    ap.add_argument('--preview')
    args = ap.parse_args()
    masks = glyph_masks(args.font)
    aspect = cell_aspect(args.font)
    built = {f'pointy-{name}': cells(rasterize(p, aspect), masks) for name, p in PALETTES.items()}
    built.update({f'cube-{name}': cube(p) for name, p in PALETTES.items()})
    built.update({f'cube-{name}-plain': cube(p, core=False) for name, p in PALETTES.items()})
    if args.preview:
        preview(built, args.font, args.preview)
    body = json.dumps(built, ensure_ascii=False, indent=2)
    ts = (
        '// Generated by tools/emblem.py from the Chrysaki mark. Do not edit by hand.\n'
        '// Each palette is two rows of cells: [glyph, foreground, background], a\n'
        '// null colour being the terminal\'s own. The glyphs are octant mosaics.\n\n'
        'export type EmblemCell = readonly [string, string | null, string | null]\n\n'
        f'export const EMBLEMS: Record<string, readonly (readonly EmblemCell[])[]> = {body}\n'
    )
    with open(OUT, 'w') as f:
        f.write(ts)
    print(f'{len(masks)} glyph masks, cell aspect {aspect:.3f}, wrote {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
