// Raster cells for the terminal: the tri-primary brand bridge and the bars.
// A Raster packs each cell as three little-endian u32 words: code point,
// foreground and background, base64 encoded.

import type { BarCell } from './format'

export const DEFAULT_COLOR = 0x01000000

export type Cell = { codePoint: number; fg: number; bg: number }

export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

export function packCells(cells: readonly Cell[]): string {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach((c, i) => {
    view.setUint32(i * 12, c.codePoint, true)
    view.setUint32(i * 12 + 4, c.fg, true)
    view.setUint32(i * 12 + 8, c.bg, true)
  })
  return toBase64(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The environment has no Buffer and the typings name no toBase64, so this
// module encodes by hand.
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

// OKLab mixing keeps jewel tones saturated between stops, where an sRGB mix
// passes through grey. This follows the Chrysaki OKLCH gradient rule.
type Lab = [number, number, number]

function toLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
}

function toOklab(rgb: number): Lab {
  const r = toLinear((rgb >> 16) & 255)
  const g = toLinear((rgb >> 8) & 255)
  const b = toLinear(rgb & 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([L, A, B]: Lab): number {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const r = fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const b = fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return (r << 16) | (g << 8) | b
}

// A colour at position t (0 to 1) along a looped list of stops.
export function loopGradient(stops: readonly string[], t: number): number {
  const labs = stops.map(s => toOklab(hexToInt(s)))
  const x = (((t % 1) + 1) % 1) * labs.length
  const i = Math.floor(x)
  const f = x - i
  const a = labs[i % labs.length] as Lab
  const b = labs[(i + 1) % labs.length] as Lab
  return fromOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
}

// The brand bridge: a row of heavy rules, its colour flowing along the loop
// Emerald, Royal Blue, Amethyst. `phase` moves it one step per tick.
export function bridgeCells(columns: number, stops: readonly string[], phase: number, codePoint = 0x2501): string {
  const cells = Array.from({ length: columns }, (_, i) => ({
    codePoint,
    fg: loopGradient(stops, i / Math.max(24, columns) - phase / 16),
    bg: DEFAULT_COLOR,
  }))
  return packCells(cells)
}

export function barRaster(cells: readonly BarCell[], fill: string, empty: string): string {
  return packCells(cells.map(c => ({
    codePoint: c.glyph.codePointAt(0) ?? 0x20,
    fg: hexToInt(c.isFilled ? fill : empty),
    bg: DEFAULT_COLOR,
  })))
}
