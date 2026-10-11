// SVG markup for the pieces of the band the desktop cannot draw as text: the
// chamfer caps of the header, the hexagon gem badges, the bars, the rules and
// the column line. The desktop draws Text in a proportional face and has no
// Nerd Font, so each piece is a drawing that fills a Box of fixed cell width.
// Every shape is a polygon, a rect or a line, with no radius. No I/O happens
// here.

import { CORE } from './palette'
import type { Paint } from './raster'

// A drawing is much wider than any Box. The surface takes the width of the
// markup "up to the slot", and the viewBox then stretches to that slot.
export const SVG_SPAN = 4096

// Adjacent cells overlap by a hair, so no seam shows between them.
const OVERLAP = 0.02

// The six Powerline Extra edges, as points on a 1 by 1 cell.
const RIGHT_ARROW = '\ue0b0'
const LEFT_ARROW = '\ue0b2'
const UPPER_LEFT = '\ue0bc'
const LOWER_LEFT = '\ue0b8'
const UPPER_RIGHT = '\ue0be'
const LOWER_RIGHT = '\ue0ba'

export const CAP_POINTS: Readonly<Record<string, string>> = {
  [RIGHT_ARROW]: '0,0 1,0.5 0,1',
  [LEFT_ARROW]: '1,0 0,0.5 1,1',
  [UPPER_LEFT]: '0,0 1,0 0,1',
  [LOWER_LEFT]: '0,0 1,1 0,1',
  [UPPER_RIGHT]: '0,0 1,0 1,1',
  [LOWER_RIGHT]: '1,0 1,1 0,1',
}

const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const
const BRAILLE_FIRST = 0x2800
const BRAILLE_LAST = 0x28ff
// The braille dot bits, as [column, row] on the 2 by 4 grid of a cell.
const DOTS: readonly (readonly [number, number, number])[] = [
  [0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2], [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2], [0x40, 0, 3], [0x80, 1, 3],
]

const DRAWN: ReadonlySet<string> = new Set([' ', '─', '━', '╸', '┼', '┴', '█', '░', ...EIGHTHS])

function isBraille(glyph: string): boolean {
  const c = glyph.codePointAt(0) ?? 0
  return c >= BRAILLE_FIRST && c <= BRAILLE_LAST
}

// The glyphs `paintSvg` draws: the rules, the eighth blocks, the shades, the
// space and the braille cells.
export function isDrawn(glyph: string): boolean {
  return DRAWN.has(glyph) || isBraille(glyph)
}

function num(x: number): string {
  return String(Number(x.toFixed(3)))
}

// A colour inside markup. Every colour comes from the palette, so a value
// that is not a hex colour falls back to the Abyss rather than reach the markup.
function hex(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : CORE.abyss
}

function doc(vbW: number, vbH: number, rowPx: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SPAN}" height="${rowPx}" viewBox="0 0 ${num(vbW)} ${num(vbH)}" preserveAspectRatio="none">${body}</svg>`
}

// A pill is a cap, a gem or an edge. It is drawn inset: the viewBox is taller
// than the shape by `PAD` above and below, so the shape stands a little shorter
// than the line. Two pills on two stacked lines then leave a gap between them,
// and their chamfers never interlock.
export const PAD = 0.15
// The height of a pill in lines, so a Box that holds a pill's ground matches it.
export const PILL_LINES = 1 / (1 + 2 * PAD)

// A ledger gem is inset more than a header pill. Ledger rows stand on adjacent
// lines, and some have no rule between them, so each gem needs a clear band of
// card above and below to read as its own jewel.
export const GEM_PAD = 0.26

function pillDoc(vbW: number, rowPx: number, body: string, pad = PAD): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SPAN}" height="${rowPx}" viewBox="0 ${-pad} ${num(vbW)} ${num(1 + 2 * pad)}" preserveAspectRatio="none">${body}</svg>`
}

// A fill is a palette colour or a reference to a gradient of this document.
function paint(fill: string): string {
  return /^url\(#[a-z0-9]+\)$/.test(fill) ? fill : hex(fill)
}

function rect(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${paint(fill)}" shape-rendering="crispEdges"${extra}/>`
}

// A horizontal gradient from `x1` to `x2` in viewBox units, with one stop at
// the centre of each cell. The terminal steps its colour cell by cell. A
// drawing blends the same colours, so no band shows between two cells.
function gradient(id: string, colors: readonly string[], x1: number, x2: number): string {
  const n = colors.length
  const stops = colors.map((c, i) => `<stop offset="${num((i + 0.5) / n)}" stop-color="${hex(c)}"/>`).join('')
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(x1)}" y1="0" x2="${num(x2)}" y2="0">${stops}</linearGradient></defs>`
}

function isUniform(colors: readonly string[]): boolean {
  return colors.every(c => c === colors[0])
}

function vline(x: number, from: number, to: number, color: string): string {
  return `<line x1="${num(x)}" y1="${num(from)}" x2="${num(x)}" y2="${num(to)}" stroke="${hex(color)}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
}

// One edge glyph: the neighbour's ground, then the triangle in `fg`.
export function capSvg(glyph: string, fg: string, bg: string | undefined, rowPx: number): string {
  const ground = bg === undefined ? '' : `<rect x="0" y="0" width="1" height="1" fill="${hex(bg)}"/>`
  const points = CAP_POINTS[glyph]
  const shape = points === undefined ? '' : `<polygon points="${points}" fill="${hex(fg)}"/>`
  return pillDoc(1, rowPx, ground + shape)
}

// A hexagon gem badge: the left cap, a body that blends across the facet, and
// the right cap. `colors` holds one ground per body cell. The body is one rect
// on a gradient through those grounds, so the facet shows no band.
export function gemSvg(colors: readonly string[], rowPx: number, pad = GEM_PAD): string {
  const n = colors.length
  const first = colors[0] ?? CORE.abyss
  const last = colors[n - 1] ?? CORE.abyss
  const parts: string[] = [`<polygon points="${num(1 + OVERLAP)},0 0,0.5 ${num(1 + OVERLAP)},1" fill="${hex(first)}"/>`]
  if (n > 0) {
    const isFlat = isUniform(colors)
    if (!isFlat) parts.push(gradient('facet', colors, 1, n + 1))
    parts.push(rect(1, 0, n + OVERLAP, 1, isFlat ? first : 'url(#facet)'))
  }
  parts.push(`<polygon points="${num(n + 1 - OVERLAP)},0 ${n + 2},0.5 ${num(n + 1 - OVERLAP)},1" fill="${hex(last)}"/>`)
  return pillDoc(n + 2, rowPx, parts.join(''), pad)
}

function heavy(rowPx: number): number {
  return Math.max(2, Math.round(rowPx / 9))
}

// The shapes of one cell at column `x`, `w` cells wide. A run of equal cells
// shares one shape, so `w` is the length of the run.
function shapes(glyph: string, fg: string, x: number, w: number, rowPx: number): string {
  const mid = Math.floor(rowPx / 2)
  const wide = w + OVERLAP
  if (glyph === '─') return rect(x, mid, wide, 1, fg)
  if (glyph === '━') return rect(x, mid - Math.floor(heavy(rowPx) / 2), wide, heavy(rowPx), fg)
  if (glyph === '╸') return rect(x, mid - Math.floor(heavy(rowPx) / 2), 0.5, heavy(rowPx), fg)
  if (glyph === '█') return rect(x, 0, wide, rowPx, fg)
  if (glyph === '░') return rect(x, 0, wide, rowPx, fg, ' fill-opacity="0.35"')
  const k = (EIGHTHS as readonly string[]).indexOf(glyph)
  if (k >= 0) return rect(x, 0, w * ((k + 1) / 8), rowPx, fg)
  return ''
}

function cross(glyph: string, fg: string, x: number, rowPx: number): string {
  const mid = Math.floor(rowPx / 2)
  return rect(x, mid, 1 + OVERLAP, 1, fg) + vline(x + 0.5, 0, glyph === '┴' ? mid : rowPx, fg)
}

function braille(glyph: string, fg: string, x: number, rowPx: number): string {
  const bits = (glyph.codePointAt(0) ?? BRAILLE_FIRST) - BRAILLE_FIRST
  return DOTS.filter(([bit]) => (bits & bit) !== 0)
    .map(([, c, r]) => rect(x + 0.17 + c * 0.44, Math.round((rowPx * (r + 0.5)) / 4) - 1, 0.22, 2, fg))
    .join('')
}

// One row of cells as a drawing: each cell's ground, then its glyph. A run of
// equal rules or blocks shares one rect. `rowPx` is the height of the row.
export function paintSvg(paints: readonly Paint[], rowPx: number): string {
  const parts: string[] = []
  let i = 0
  while (i < paints.length) {
    const p = paints[i] as Paint
    let j = i + 1
    // Only a ground and the light rules, blocks and shades merge across cells.
    const isMerging = p.glyph === '─' || p.glyph === '━' || p.glyph === '█' || p.glyph === '░' || p.glyph === ' '
    // A rule also merges across a change of colour: the bars and the header
    // rule step through a gradient cell by cell, and the run blends it.
    const isRule = p.glyph === '─' || p.glyph === '━'
    while (isMerging && j < paints.length) {
      const q = paints[j] as Paint
      const isSameInk = q.fg === p.fg || (isRule && p.fg !== null && q.fg !== null)
      if (q.glyph !== p.glyph || q.bg !== p.bg || !isSameInk) break
      j++
    }
    if (p.bg !== null) parts.push(rect(i, 0, j - i + OVERLAP, rowPx, p.bg))
    if (p.fg !== null) {
      const inks = paints.slice(i, j).map(q => q.fg as string)
      if (p.glyph === '┼' || p.glyph === '┴') parts.push(cross(p.glyph, p.fg, i, rowPx))
      else if (isBraille(p.glyph)) parts.push(braille(p.glyph, p.fg, i, rowPx))
      else if (isRule && !isUniform(inks)) parts.push(gradient(`ink${i}`, inks, i, j) + shapes(p.glyph, `url(#ink${i})`, i, j - i, rowPx))
      else parts.push(shapes(p.glyph, p.fg, i, j - i, rowPx))
    }
    i = j
  }
  return doc(paints.length, rowPx, rowPx, parts.join(''))
}

// The column line: the `│` of a separator of `cells` cells, at its middle
// cell. The separator is five cells wide unless the ledger asks for less.
export function vsepSvg(color: string, rowPx: number, cells = 5): string {
  return doc(cells, rowPx, rowPx, vline(cells / 2, 0, rowPx, color))
}
