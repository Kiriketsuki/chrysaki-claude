// The jewels behind the ledger badges. A badge's ground runs across a facet.
// No I/O happens here.

import { mixHex, readableGround } from './gradient'
import { CORE, ROLE } from './palette'

// A jewel for a badge: its dim edge and its light catch.
export type Gem = { dim: string; light: string }

export const GEMS = {
  emerald: { dim: CORE.emeraldDim, light: CORE.emeraldLight },
  teal: { dim: CORE.tealDim, light: CORE.tealLight },
  blue: { dim: CORE.blueDim, light: CORE.blueLight },
  amethyst: { dim: CORE.amethystDim, light: CORE.amethystLight },
  rhodolite: { dim: mixHex(CORE.rhodolite, CORE.abyss, 0.4), light: mixHex(CORE.rhodolite, CORE.textPrimary, 0.2) },
} as const

// The ground at place `t` (0 to 1) across a gem badge. The light catches a
// little left of centre and falls to the dim edge on both sides, like a cut
// facet.
export function facet(g: Gem, t: number): string {
  return mixHex(g.dim, g.light, Math.max(0, 1 - Math.abs(t - 0.38) * 2.2))
}

// The ground of cell `i` of a badge body `inner` cells wide, held to 4.5:1
// under the badge lettering.
export function gemColor(g: Gem, inner: number, i: number): string {
  return readableGround(facet(g, i / Math.max(1, inner - 1)), ROLE.text)
}

// The ground of every body cell, left to right.
export function gemColors(g: Gem, inner: number): string[] {
  return Array.from({ length: Math.max(0, inner) }, (_, i) => gemColor(g, inner, i))
}
