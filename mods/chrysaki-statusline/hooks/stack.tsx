// The desktop's narrow ledger. A chat column is rarely wide enough for the
// ledger's columns side by side, so the cells stack one above the other: usage,
// then context, then git. A full dashed rule parts the blocks. When the band
// has the lines to spare, a half-line rule also parts the two rows inside each
// block. Every badge takes one width, so the bar, the figure and the spark of
// each row start in the same column. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { BAR_LONG, BAR_SHORT, BAR_TINY, STACK_FIT } from './grid'
import { SPARK_CELLS } from './history'
import { cacheCell, contextCell, contextWidth, gitCells, windowCell } from './ledger'
import type { Geom } from './ledger'
import type { Prims, Table } from './prims'
import { primsFor } from './prims-for'
import type { RuleSpec } from './rules'

// The geometries to try, best first. The spark goes before the long bar, as
// on the terminal, and a tiny bar comes before the spark leaves.
export const STACK_GEOMS: readonly Geom[] = [
  { bar: BAR_LONG, spark: SPARK_CELLS, fit: STACK_FIT },
  { bar: BAR_SHORT, spark: SPARK_CELLS, fit: STACK_FIT },
  { bar: BAR_TINY, spark: SPARK_CELLS, fit: STACK_FIT },
  { bar: BAR_LONG, spark: 0, fit: STACK_FIT },
  { bar: BAR_SHORT, spark: 0, fit: STACK_FIT },
  { bar: BAR_TINY, spark: 0, fit: STACK_FIT },
]

// The first geometry whose widest cell fits the band, after one cell of
// padding. A band narrower than all of them takes the last, and its cells clip.
export function planStack(inner: number): Geom {
  const room = inner - 1
  return STACK_GEOMS.find(g => contextWidth(g) <= room) ?? (STACK_GEOMS[STACK_GEOMS.length - 1] as Geom)
}

// The two rules between the blocks. They cross no column line.
export function stackRules(inner: number): RuleSpec[] {
  return [
    { key: 'block-rule-1', width: inner - 1, crosses: [] },
    { key: 'block-rule-2', width: inner - 1, crosses: [] },
  ]
}

// The rules inside the three blocks, one between the two rows of each pair.
// They cross no column line.
export function pairRules(inner: number): RuleSpec[] {
  return [
    { key: 'usage-rule', width: inner - 1, crosses: [] },
    { key: 'context-rule', width: inner - 1, crosses: [] },
    { key: 'git-rule', width: inner - 1, crosses: [] },
  ]
}

// The height of a pair rule row, in lines. A rule parts two rows of one block,
// so it takes half a line. The drawing sits on the middle of the row.
export const PAIR_RULE_LINES = 0.5

// A dashed rule of half a line. The drawing is a full line tall and the row
// clips it to half a line, so the dashes stay at the middle.
export function halfRule(T: Table, P: Prims, spec: RuleSpec): RenderElement {
  const { Box } = T
  return <Box key={spec.key} paddingLeft={1} height={PAIR_RULE_LINES} overflow="hidden" alignItems="center">{P.dashRule(spec)}</Box>
}

// The rows of the stacked ledger for a band `inner` cells wide. With
// `hasPairRules` a dashed half-line rule parts the two rows of each block, so
// every pair keeps the same rhythm. The rules come as a set, never one alone.
export function stackRows(T: Table, d: BandData, inner: number, hasPairRules = false): RenderElement[] {
  const { Box } = T
  const P = primsFor(T, d)
  const g = planStack(inner)
  const u = d.usage
  const git = gitCells(T, P, d, inner - 1, { splitTail: true, badge: STACK_FIT.git, isTrimmed: true })
  const row = (key: string, cell: RenderElement) => <Box key={key} paddingLeft={1}>{cell}</Box>
  const blocks = stackRules(inner)
  const pairs = pairRules(inner)
  const rule = (spec: RuleSpec) => <Box key={spec.key} paddingLeft={1}>{P.dashRule(spec)}</Box>
  const slim = (spec: RuleSpec) => halfRule(T, P, spec)
  const pair = (i: number) => (hasPairRules ? [slim(pairs[i] as RuleSpec)] : [])
  return [
    row('row-5h', windowCell(T, P, d, '5h', u?.fiveHour, g)),
    ...pair(0),
    row('row-7d', windowCell(T, P, d, '7d', u?.sevenDay, g)),
    rule(blocks[0] as RuleSpec),
    row('row-ctx', contextCell(T, P, d, g)),
    ...pair(1),
    row('row-cache', cacheCell(T, P, d, g)),
    rule(blocks[1] as RuleSpec),
    row('row-git-a', git.a),
    ...(git.b === null ? [] : [...pair(2), row('row-git-b', git.b)]),
    ...(git.c === null ? [] : [row('row-git-c', git.c)]),
  ]
}
