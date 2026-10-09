#!/usr/bin/env python3
"""Builds hooks/emblem.ts: the Chrysaki mark as terminal mosaic cells.

The mark is a regular flat-top hexagon of three faces, as in
chrysaki-mark.svg. Terminal cells are about 2.5 times taller than wide, so
this script works out the hexagon's true shape in cell units: two rows tall,
six equal sides. It rasterizes that shape onto a fine sample grid, then picks
for each cell the glyph and the two colours that match it best. The diagonal
wedges of the legacy computing block draw the slanted edges.

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

ROWS = 2
COLS = 6


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


def regular(palette, aspect, masks, cols=COLS, rows=ROWS, scale=6):
    """The mark as a regular flat-top hexagon with six equal sides, fitted to
    the cell shape: `rows` rows tall, centred in `cols` columns. The three
    faces meet at the centre as in cube(): the top face upper left, the left
    face lower left, the right face on the right. The glyph matcher picks the
    diagonal wedges that draw each slanted edge."""
    px_w, px_h = cols * MW, rows * MH
    pw, ph = aspect / MW, 1 / MH  # one sample, in cell heights
    H = rows * 1.0  # cell heights
    s = H / 3 ** 0.5
    W = 2 * s
    m = (cols * aspect - W) / 2
    L, UL, UR = (m, H / 2), (m + s / 2, 0), (m + 1.5 * s, 0)
    R, LR, LL = (m + 2 * s, H / 2), (m + 1.5 * s, H), (m + s / 2, H)
    C = (m + s, H / 2)
    faces = [('top', [C, L, UL, UR]), ('left', [C, LR, LL, L]), ('right', [C, UR, R, LR])]
    img = Image.new('RGB', (px_w * scale, px_h * scale), (0, 0, 0))
    d = ImageDraw.Draw(img)
    keys = {}
    for i, (name, poly) in enumerate(faces):
        colour = (i + 1, 0, 0)
        keys[colour] = name
        d.polygon([(x / pw * scale, y / ph * scale) for x, y in poly], fill=colour)
    grid = []
    for py in range(px_h):
        row = []
        for px in range(px_w):
            votes = Counter(img.getpixel((px * scale + sx, py * scale + sy)) for sx in range(scale) for sy in range(scale))
            name = keys.get(votes.most_common(1)[0][0])
            row.append(palette[name] if name else None)
        grid.append(row)
    return cells(grid, masks)


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
    built = {f'hex-{name}': regular(p, aspect, masks) for name, p in PALETTES.items()}
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
