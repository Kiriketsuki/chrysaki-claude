// Chrysaki tokens and glyphs for the lag pane. The hex values mirror
// chrysaki-core, as the other mods do. Mods do not import across folders.
// Royal Blue and Amethyst are fill colours only, so this file lists no text
// accent for them.

import type { Level } from '../types'

export const C = {
  abyss: '#0f1117',
  surface: '#1c1f2b',
  raised: '#252836',
  border: '#363a4f',
  emerald: '#14664e',
  emeraldLt: '#1a8a6a',
  teal: '#197278',
  tealLt: '#20969c',
  blonde: '#fbb13c',
  blondeLt: '#fcc96a',
  error: '#8c2f39',
  errorLt: '#b53f4a',
  text: '#e0e2ea',
  text2: '#a0a4b8',
  muted: '#6a6e82',
} as const

export const LEVEL_COLOR: Record<Level, string> = { calm: C.emeraldLt, busy: C.blondeLt, laggy: C.errorLt }
export const LEVEL_FILL: Record<Level, string> = { calm: C.emerald, busy: C.blonde, laggy: C.error }

export const HEX = '⬢'
export const HEX_HOLLOW = '⬡'
export const RISE = '▲'
export const WARN = '⚠'
export const EDGE = ''
export const BAR_FULL = '━'
export const BAR_EMPTY = '─'
