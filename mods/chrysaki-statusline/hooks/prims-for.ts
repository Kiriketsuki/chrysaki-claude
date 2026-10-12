// Picks the band's pieces for a surface. The desktop draws its own, because
// it has no Nerd Font and no Raster. Every other surface keeps the terminal's.
// No I/O happens here.

import type { BandData } from './draw'
import type { Prims, Table } from './prims'
import { desktopPrims } from './prims-desktop'
import type { DesktopTable } from './prims-desktop'
import { terminalPrims } from './prims-terminal'

// True when the band draws on the desktop with Svg pieces. The layout asks
// the same question as the pieces, so the two never disagree.
export function isDesktop(T: Table, d: BandData): T is DesktopTable {
  return d.surface === 'desktop' && 'Svg' in T
}

export function primsFor(T: Table, d: BandData): Prims {
  return isDesktop(T, d) ? desktopPrims(T, d) : terminalPrims(T, d)
}
