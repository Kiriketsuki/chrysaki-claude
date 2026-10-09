// Raster cells for the terminal. A Raster packs each cell as three
// little-endian u32 words: code point, foreground and background, base64
// encoded. No I/O happens here.

import type { Table } from './prims'

// Bit 24 alone: the terminal's own colour.
export const DEFAULT_COLOR = 0x01000000

export type Cell = { codePoint: number; fg: number; bg: number }

// A cell as the band builds it: one glyph and two colours, each a hex string
// or null for the terminal's own colour.
export type Paint = { glyph: string; fg: string | null; bg: string | null }

// Only the terminal paints a Raster. Another surface's table can hold the
// name too, but there it draws an empty fragment, so the surface decides.
export function hasRaster<T extends Table>(T: T, surface: string): T is Extract<T, { Raster: unknown }> {
  return surface === 'terminal' && 'Raster' in T
}

export function hexToInt(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16)
}

function colorWord(hex: string | null): number {
  return hex === null ? DEFAULT_COLOR : hexToInt(hex)
}

export function paintCells(paints: readonly Paint[]): Cell[] {
  return paints.map(p => ({ codePoint: p.glyph.codePointAt(0) ?? 0x20, fg: colorWord(p.fg), bg: colorWord(p.bg) }))
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

export function unpackCells(packed: string): Cell[] {
  const bytes = fromBase64(packed)
  const view = new DataView(bytes.buffer)
  return Array.from({ length: Math.floor(bytes.length / 12) }, (_, i) => ({
    codePoint: view.getUint32(i * 12, true),
    fg: view.getUint32(i * 12 + 4, true),
    bg: view.getUint32(i * 12 + 8, true),
  }))
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

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let j = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[j++] = (acc >> bits) & 255
    }
  }
  return out
}
