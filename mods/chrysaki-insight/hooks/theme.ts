// Chrysaki tokens and glyphs for the insight pane. The hex values mirror
// chrysaki-core, as the git-pane copy does. Mods do not import across folders.
// Royal Blue and Amethyst are fill colours only. This file lists no text
// accent for them on purpose.

export const C = {
  abyss: '#0f1117',
  base: '#161821',
  surface: '#1c1f2b',
  raised: '#252836',
  elevated: '#2e3142',
  border: '#363a4f',
  emeraldLt: '#1a8a6a',
  teal: '#197278',
  tealLt: '#20969c',
  blonde: '#fbb13c',
  blondeLt: '#fcc96a',
  errorLt: '#b53f4a',
  text: '#e0e2ea',
  text2: '#a0a4b8',
  muted: '#6a6e82',
} as const

// Powerline edges, as the tmux window list uses them. See chrysaki/TILING.md.
export const EDGE = {
  back: '',
  forward: '',
  end: '',
} as const

export const HEX = '⬢'
export const HEX_HOLLOW = '⬡'
export const DIAMOND = '◆'
export const TICK = '✓'
export const CROSS = '✗'
export const BAR_FULL = '█'
export const BAR_EMPTY = '░'

// Nerd Font glyphs, one per label. Escapes keep the source plain ASCII.
export const GLYPH = {
  context: '',
  turns: '',
  activity: '',
  tool: '',
  agent: '',
  cost: '',
  clock: '',
} as const

// Bar colours cycle through the safe text accents, largest category first.
export const BAR_COLORS = [C.emeraldLt, C.tealLt, C.blondeLt, C.teal, C.blonde, C.text2] as const
