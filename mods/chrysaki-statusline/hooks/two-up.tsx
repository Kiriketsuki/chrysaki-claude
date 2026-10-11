// The desktop's two-up ledger. It sets usage beside context, and the 5h and
// 7d cells above the ctx and cache cells, so the ledger is four rows tall:
// [5h | ctx], [7d | cache], then git and diff each on a full-width row. A
// half-line dashed rule parts the rows, and it crosses the column line where
// they meet. The width picks the geometry: the bar, the spark, and below the
// full width, narrower fixed fields. Both columns keep their edges across the
// rows. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { BandData } from './draw'
import { BAR_LONG, DESKTOP_FIT, TWO_UP_FIT, sepOf } from './grid'
import { SPARK_CELLS } from './history'
import { cacheCell, contextCell, contextWidth, fitOf, gitCells, usageWidth, windowCell } from './ledger'
import type { Geom } from './ledger'
import type { Table } from './prims'
import { primsFor } from './prims-for'
import type { RuleSpec } from './rules'
import { halfRule } from './stack'

// The narrowest bar the two-up ledger draws beside a spark, and without one.
const BAR_WITH_SPARK = 7
const BAR_ALONE = 6
const SPARKS = [SPARK_CELLS, 6, 4] as const

const range = (from: number, to: number): number[] => Array.from({ length: from - to + 1 }, (_, i) => from - i)

// The geometries to try, best first. The full one keeps the roomy fields. The
// rest use the trimmed fields. The spark goes before the long bar, as on the
// terminal, and a spark keeps a bar of at least BAR_WITH_SPARK cells.
export const TWO_UP_GEOMS: readonly Geom[] = [
  { bar: BAR_LONG, spark: SPARK_CELLS, fit: DESKTOP_FIT },
  ...SPARKS.flatMap(spark => range(BAR_LONG, BAR_WITH_SPARK).map((bar): Geom => ({ bar, spark, fit: TWO_UP_FIT }))),
  ...range(BAR_LONG, BAR_ALONE).map((bar): Geom => ({ bar, spark: 0, fit: TWO_UP_FIT })),
]

// The cells of a pair of columns, the separator between them included.
export function pairWidth(g: Geom): number {
  return usageWidth(g) + sepOf(fitOf(g)) + contextWidth(g)
}

// The band width from which the desktop sets the two-up ledger. A narrower
// band stacks the cells. The narrowest geometry fits here, with cells to spare.
export const TWO_UP_MIN = 80

// The first geometry whose pair of columns fits the band, after one cell of
// padding. A band narrower than all of them takes the last, and its cells clip.
export function planTwoUp(inner: number): Geom {
  const room = inner - 1
  return TWO_UP_GEOMS.find(g => pairWidth(g) <= room) ?? (TWO_UP_GEOMS[TWO_UP_GEOMS.length - 1] as Geom)
}

// The three rules between the four rows, top to bottom. Each rule starts under
// the row padding, so its cell 0 is the row's cell 0. The column line runs
// through the first rule and ends on the second, which closes it with a tee.
export function twoUpRules(inner: number): RuleSpec[] {
  const g = planTwoUp(inner)
  const at = usageWidth(g) + Math.floor(sepOf(fitOf(g)) / 2)
  const width = inner - 1
  return [
    { key: 'row-rule-1', width, crosses: [{ at, glyph: '┼' }] },
    { key: 'row-rule-2', width, crosses: [{ at, glyph: '┴' }] },
    { key: 'row-rule-3', width, crosses: [] },
  ]
}

// The rows of the two-up ledger for a band `inner` cells wide. A folder with
// no repository has no diff row on the desktop, so the last rule leaves too.
// A diff row that runs over hands the pull request and the issues to a row
// under the diff badge, and a count of zero leaves the diff row.
export function twoUpRows(T: Table, d: BandData, inner: number): RenderElement[] {
  const { Box } = T
  const P = primsFor(T, d)
  const g = planTwoUp(inner)
  const u = d.usage
  const sep = P.vsep(sepOf(fitOf(g)))
  const git = gitCells(T, P, d, inner - 1, { splitTail: true, badge: fitOf(g).git, isTrimmed: true })
  const rules = twoUpRules(inner)
  const row = (key: string, children: RenderElement[]) => <Box key={key} paddingLeft={1}>{children}</Box>
  const rule = (i: number) => halfRule(T, P, rules[i] as RuleSpec)
  return [
    row('row-0', [windowCell(T, P, d, '5h', u?.fiveHour, g), sep, contextCell(T, P, d, g)]),
    rule(0),
    row('row-1', [windowCell(T, P, d, '7d', u?.sevenDay, g), sep, cacheCell(T, P, d, g)]),
    rule(1),
    row('row-2', [git.a]),
    ...(git.b === null ? [] : [rule(2), row('row-3', [git.b])]),
    ...(git.c === null ? [] : [row('row-4', [git.c])]),
  ]
}
