// The desktop band. It never folds to a line of figures: the desktop draws
// drawings, so it keeps the terminal header, bars, sparks, rules and column
// lines at every width. The width picks the tier. A narrow band stacks the
// ledger cells one above the other. A wider one sets the terminal two-up
// ledger, and a very wide one its three columns. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { accountLines, accountRows } from './dropdown'
import { desktopHeaderRows } from './header'
import { desktopPlanOpts, ledgerRows, planLedger } from './ledger'
import type { Table } from './prims'
import { stackRows } from './stack'
import { TWO_UP_MIN, twoUpRows } from './two-up'

// The most lines the desktop gives the band. A taller tree scrolls.
export const MAX_ROWS = 12
// The height of the shortest gap under the header, in lines.
const GAP_HALF = 0.5

export type DesktopTier = 'stack' | 'two-up' | 'inline'

// The inline tier needs room for the full geometry and for the widest git row
// on one line, so it starts well past the two-up tier. The desktop wraps what
// does not fit, so a git cell that is too short would clip its figures. The
// two-up tier starts where its narrowest geometry fits.
export function desktopTier(inner: number, d: BandData): DesktopTier {
  if (planLedger(inner, desktopPlanOpts(d)).isInline) return 'inline'
  return inner >= TWO_UP_MIN ? 'two-up' : 'stack'
}

// The lines a row takes. A row with no height of its own takes one line.
function lineOf(el: RenderElement): number {
  const height = (el as { props?: { height?: unknown } }).props?.height
  return typeof height === 'number' ? height : 1
}

const linesOf = (rows: readonly RenderElement[]): number => rows.reduce((sum, el) => sum + lineOf(el), 0)

// True for a rule row of the ledger. Every rule key ends in `rule` or `rule-N`.
function isRule(el: RenderElement): boolean {
  const key = (el as { props?: { key?: unknown } }).props?.key
  return typeof key === 'string' && /rule(-\d+)?$/.test(key)
}

// The rows that fit `room` lines, cut from the bottom. A rule never ends the
// list, because it would close a block that is no longer there.
export function cutRows(rows: readonly RenderElement[], room: number): RenderElement[] {
  const kept = [...rows]
  while (kept.length > 0 && (linesOf(kept) > room || isRule(kept[kept.length - 1] as RenderElement))) kept.pop()
  return kept
}

// The whole band. The card around the band pads its own top and bottom, so
// the column has no margin of its own. The band spends its lines in this
// order: the header, the ledger, the half-line rules inside the stacked
// blocks, then the gap under the header. A rule set that does not fit whole
// is left out whole, so the blocks never keep different rhythms. The gap
// under the header holds the account dropdown, or an empty row that grows
// from half a line to a line as the band has room. The two-up tier keeps the
// half line, so its four rows stay close under the header. The dropdown counts
// as its real rows. When the header and the dropdown leave too little room,
// the ledger gives up its bottom rows, so the dropdown never scrolls out of
// sight.
export function drawDesktopBand(T: Table, d: BandData): RenderElement {
  const { Box } = T
  const inner = Math.max(20, d.columns)
  const tier = desktopTier(inner, d)
  const head = desktopHeaderRows(T, d, inner)
  const menu = accountRows(T, d)
  const plain = tier === 'stack' ? stackRows(T, d, inner) : tier === 'two-up' ? twoUpRows(T, d, inner) : ledgerRows(T, d, inner)
  const paired = tier === 'stack' ? stackRows(T, d, inner, true) : plain
  const fixed = linesOf(head) + accountLines(d)
  const whole = fixed + linesOf(paired) <= MAX_ROWS ? paired : plain
  const ledger = fixed + linesOf(whole) <= MAX_ROWS ? whole : cutRows(whole, MAX_ROWS - fixed)
  const used = fixed + linesOf(ledger)
  const gap = (tier === 'two-up' ? [GAP_HALF] : [1, GAP_HALF]).find(n => used + n <= MAX_ROWS)
  const slot = menu.length > 0 ? menu : gap === undefined ? [] : [<Box key="drawer" height={gap} />]
  return <Box flexDirection="column">{[...head, ...slot, ...ledger]}</Box>
}
