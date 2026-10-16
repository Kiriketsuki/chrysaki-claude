// Chrysaki tokens for stretch text. The hex values mirror chrysaki-core, as
// the other mods do. Mods do not import across folders.

export const C = {
  tealLt: '#20969c',
  blondeLt: '#fcc96a',
  muted: '#6a6e82',
} as const

// A link marks what a press acts on. Code takes Blonde Lt so that it never
// reads as a link.
export const LINK = C.tealLt
export const CODE = C.blondeLt
export const DIM = C.muted
