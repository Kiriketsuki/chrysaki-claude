// The ledger under the header: two rows on a grid of three columns, usage,
// context and git. Each column takes the width its figures need. Git takes
// the rest, so the row ends at the band's edge. A `│` with two cells of
// padding parts the columns, and the dashed rule between rows crosses it.
// Each cell opens with a hexagon gem badge whose ground runs across a facet:
// 5h Emerald, 7d Teal, ctx Royal Blue, cache Amethyst, git and diff
// Rhodolite. Cell bodies have no ground. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { StatuslineWindow } from '../types'
import { cacheCard, toneColor } from './cache'
import type { BandData } from './draw'
import type { BarStyle } from './format'
import { CTX_AMBER_TOKENS, CTX_RED_TOKENS, barCells, isHandoffDue, kilo, smoothCells, untilReset, usageColor } from './format'
import { GEMS, facet } from './gem'
import { AMOUNT, BAR_LONG, BAR_SHORT, DESKTOP_FIT, FIG, GIT_MIN, RESET, SEP, SOCKET, TERMINAL_FIT } from './grid'
import type { Fit } from './grid'
import { mixHex } from './gradient'
import { CORE, ROLE } from './palette'
import { hoverGroup, truncate } from './prims'
import type { Prims, Table } from './prims'
import { isDesktop, primsFor } from './prims-for'
import type { Paint } from './raster'
import { SWEEP_FRAMES, dashes, isRuleLive, ruleFrame, ruleText, rulePaints } from './rules'
import type { Cross, RuleSpec } from './rules'
import { FIVE_HOURS_MS, SEVEN_DAYS_MS, SPARK_CELLS, recentTokens, windowBuckets } from './history'

export { GEMS, facet, SEP, SWEEP_FRAMES, dashes, isRuleLive, ruleFrame, ruleText, rulePaints }
export type { Cross, RuleSpec }
export { paintRow } from './prims-terminal'

// --- Bars ------------------------------------------------------------------------

// A colour zone of a bar: cells up to `until` percent of its length.
export type Zone = { until: number; color: string }

// How a bar colours a place along it, in percent of its length, and the
// colour of its calm first zone. A percent in the calm zone keeps the text
// colour.
export type Scale = { at: (position: number, length: number) => string; calm: string }

const USAGE_SCALE: Scale = { at: p => usageColor(p), calm: ROLE.emeraldLt }

export function zoneScale(zones: readonly Zone[]): Scale {
  return { at: (p, length) => blendZones(zones, p, length), calm: zones[0]?.color ?? ROLE.text }
}

// The context zones sit at fixed token counts, so they move with the window.
function contextZones(window: number): Zone[] {
  const at = (tokens: number) => (tokens / Math.max(1, window)) * 100
  return [
    { until: at(CTX_AMBER_TOKENS), color: ROLE.emeraldLt },
    { until: at(CTX_RED_TOKENS), color: ROLE.blondeLt },
    { until: Infinity, color: ROLE.error },
  ]
}

function zoneAt(zones: readonly Zone[], position: number): string {
  return zones.find(z => position <= z.until)?.color ?? ROLE.error
}

type Bar = { el: RenderElement; reached: string }

// A smooth bar mixes each zone colour into the next across this many cells
// around the zone boundary, in OKLab, so the bar never passes through grey.
const BLEND_CELLS = 1.5

// The colour at `position` percent of a bar `length` cells long.
export function blendZones(zones: readonly Zone[], position: number, length: number): string {
  const half = (BLEND_CELLS * 100) / Math.max(1, length) / 2
  for (let k = 0; k < zones.length - 1; k++) {
    const zone = zones[k] as Zone
    const next = zones[k + 1] as Zone
    if (Math.abs(position - zone.until) < half) return mixHex(zone.color, next.color, (position - zone.until + half) / (2 * half))
  }
  return zoneAt(zones, position)
}

// The cells of a smooth bar. The track is a Border ground under every cell,
// so the empty part of a partial cell shows as track. A filled part takes the
// colour at its own middle.
export function smoothPaints(pct: number, scale: Scale, length: number): Paint[] {
  return smoothCells(pct, length).map((c, i) => ({
    glyph: c.glyph,
    fg: c.fill === 0 ? null : scale.at(((i + c.fill / 2) / length) * 100, length),
    bg: SOCKET,
  }))
}

// The cells of a bar that draws discrete glyphs: each filled cell takes the
// colour of its own place on the scale, each empty one the socket.
export function barPaints(pct: number, style: BarStyle, shift: number, scale: Scale, length: number): Paint[] {
  return barCells(pct, style, shift, length).map((c, i) => ({
    glyph: c.glyph,
    fg: c.isFilled ? scale.at(((i + 0.5) / length) * 100, length) : SOCKET,
    bg: null,
  }))
}

// A bar coloured by its scale at each cell. `reached` is the colour at the
// percent, or the text colour while the bar stays in its calm zone.
function zoneBar(P: Prims, d: BandData, key: string, pct: number, scale: Scale, length: number): Bar {
  const top = scale.at(pct, length)
  if (d.barStyle === 'smooth') {
    const paints = smoothPaints(pct, scale, length)
    const isEmpty = paints.every(p => p.fg === null)
    return { el: P.row(`bar-${key}`, paints), reached: isEmpty || top === scale.calm ? ROLE.text : top }
  }
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  const isEmpty = cells.every(c => !c.isFilled)
  return { el: P.textBar(barPaints(pct, d.barStyle, d.phase % 4, scale, length)), reached: isEmpty || top === scale.calm ? ROLE.text : top }
}

// A bar in one colour, for the cache that drains as it cools.
function plainBar(P: Prims, d: BandData, key: string, pct: number, color: string, length: number): RenderElement {
  return zoneBar(P, d, key, pct, { at: () => color, calm: color }, length).el
}

// A bar with no figure yet: the bare track.
function emptyBar(P: Prims, d: BandData, key: string, length: number): RenderElement {
  if (d.barStyle === 'smooth') return P.row(`bar-${key}`, smoothPaints(0, USAGE_SCALE, length))
  return P.emptyLine(length)
}

// --- Cells -----------------------------------------------------------------------

// The bar length and the spark length of a band. A spark of 0 draws none. The
// `fit` holds the widths that change with the surface. The terminal sets none.
export type Geom = { bar: number; spark: number; fit?: Fit }

export const fitOf = (g: Geom): Fit => g.fit ?? TERMINAL_FIT

// The cells a spark takes, its trailing space included.
function sparkRoom(g: Geom): number {
  return g.spark === 0 ? 0 : g.spark + 1
}

// badge 6, cap and space 2, bar, 1, percent 4, 1, spark, reset 8.
export function usageWidth(g: Geom): number {
  return fitOf(g).usage + 2 + g.bar + 1 + FIG + 1 + sparkRoom(g) + RESET
}

// badge 9, cap and space 2, bar, 1, figure 4, 1, spark, amount 10, 1, key 12.
export function contextWidth(g: Geom): number {
  return fitOf(g).ctx + 2 + g.bar + 1 + FIG + 1 + sparkRoom(g) + AMOUNT + 1 + fitOf(g).key
}

// --- Sparks ----------------------------------------------------------------------

// Eight braille heights, from one dot to a full cell.
const SPARK_GLYPHS = ['⡀', '⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿'] as const

// The cells of a braille spark. `level` maps a value to 0 to 100 for its
// height. A null bucket is still ahead in the window, or before the first
// reading: one dim dot in the Border colour.
export function sparkPaints(values: readonly (number | null)[], level: (v: number) => number, color: (v: number) => string): Paint[] {
  return values.map(v => {
    if (v === null) return { glyph: SPARK_GLYPHS[0], fg: CORE.border, bg: null }
    const i = Math.max(0, Math.min(7, Math.floor(level(v) / 12.5)))
    return { glyph: SPARK_GLYPHS[i] ?? '⡀', fg: color(v), bg: null }
  })
}

function sparkRow(P: Prims, key: string, paints: readonly Paint[]): RenderElement[] {
  return [P.row(`spark-${key}`, paints), P.gap(1)]
}

// The context colour of a token count: the token zones of the ctx bar.
function tokenColor(tokens: number): string {
  if (tokens >= CTX_RED_TOKENS) return ROLE.error
  if (tokens >= CTX_AMBER_TOKENS) return ROLE.blondeLt
  return ROLE.emeraldLt
}

// The model-scoped weekly limits, for the 7d card.
function scopedText(d: BandData): string {
  const list = d.usage?.scoped ?? []
  return list.map(s => ` · ${s.label} ${s.percent}%`).join('')
}

export function windowCell(T: Table, P: Prims, d: BandData, label: string, w: StatuslineWindow | undefined, g: Geom): RenderElement {
  const pct = w?.percent ?? 0
  const head = P.badge({ key: label, text: label, gem: label === '5h' ? GEMS.emerald : GEMS.teal, width: fitOf(g).usage })
  if (w === undefined) {
    return P.cell(`cell-${label}`, usageWidth(g), [...head, emptyBar(P, d, label, g.bar), P.gap(1 + FIG + 1 + sparkRoom(g)), P.resetKey(label, 'read')])
  }
  const b = zoneBar(P, d, label, pct, USAGE_SCALE, g.bar)
  const samples = label === '5h' ? d.history.fiveHour : d.history.sevenDay
  const span = label === '5h' ? FIVE_HOURS_MS : SEVEN_DAYS_MS
  const spark = g.spark === 0 ? [] : sparkRow(P, label, sparkPaints(windowBuckets(samples, w.resetsAt, span, d.now, g.spark), v => v, usageColor))
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  const extra = label === '7d' ? scopedText(d) : ''
  return P.cell(`cell-${label}`, usageWidth(g), [
    ...head,
    hoverGroup(T, `win-${label}`, `${label} window · ${pct}% used · ${when}${extra} · the spark shows the window so far · press the reset time to read usage now`, [
      b.el,
      P.gap(1),
      P.fig(`${pct}%`, FIG, b.reached, { bold: true, right: true }),
      P.gap(1),
      ...spark,
      P.resetKey(label, reset === '' ? 'read' : reset),
    ]),
  ])
}

// The key at the end of the context row: handoff past 100k, resume in a
// fresh session with a handoff path on the clipboard, else fresh.
function contextKey(P: Prims, d: BandData, tokens: number | undefined, key: number): RenderElement {
  if (d.isHandingOff) return P.fig('◐ writing', key, ROLE.warn, { bold: true })
  if (tokens === undefined && d.resumePath !== null) return P.pressKey('resume-key', 'resume', 'resume', 'r', d.onResume, key)
  if (!isHandoffDue(tokens)) return P.fig('◇ fresh', key, ROLE.emeraldLt)
  return P.pressKey('handoff-key', 'handoff', 'handoff', 'h', d.onHandoff, key)
}

export function contextCell(T: Table, P: Prims, d: BandData, g: Geom): RenderElement {
  const u = d.usage
  const tokens = u?.ctxTokens
  const head = P.badge({ key: 'ctx-detail', text: '', gem: GEMS.blue, width: fitOf(g).ctx, press: { label: 'ctx', onPress: d.onContext } })
  if (u?.ctxPercent === undefined) {
    const name = d.resumePath === null ? 'no context yet' : d.resumePath.slice(d.resumePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
    return P.cell('cell-ctx', contextWidth(g), [
      ...head, emptyBar(P, d, 'ctx', g.bar), P.gap(1 + FIG + 1 + sparkRoom(g)), P.fig(name, AMOUNT, ROLE.muted), P.gap(1), contextKey(P, d, undefined, fitOf(g).key),
    ])
  }
  const b = zoneBar(P, d, 'ctx', u.ctxPercent, zoneScale(contextZones(u.ctxWindow)), g.bar)
  // The context spark: the last token counts, full height at the amber line.
  const spark = g.spark === 0 ? [] : sparkRow(P, 'ctx', sparkPaints(recentTokens(d.ctxHistory, g.spark), v => (v / CTX_AMBER_TOKENS) * 100, tokenColor))
  const used = tokens === undefined ? '' : kilo(tokens)
  const of = `/${kilo(u.ctxWindow)}`
  return P.cell('cell-ctx', contextWidth(g), [
    ...head,
    hoverGroup(T, 'ctx', `context ${u.ctxPercent}% · ${tokens ?? '?'} of ${u.ctxWindow} tokens · amber from 250k, red from 500k · handoff at 100k · the spark shows the last turns · press ctx for the breakdown`, [
      b.el,
      P.gap(1),
      P.fig(`${u.ctxPercent}%`, FIG, b.reached, { bold: true, right: true }),
      P.gap(1),
      ...spark,
      P.amount(used, of, AMOUNT),
      P.gap(1),
      contextKey(P, d, tokens, fitOf(g).key),
    ]),
  ])
}

const CACHE_STATE = { warm: '● warm', warning: '◐ cooling', cold: '○ cold' } as const

export function cacheCell(T: Table, P: Prims, d: BandData, g: Geom): RenderElement {
  const head = P.badge({ key: 'cache', text: '⧗ cache', gem: GEMS.amethyst, width: fitOf(g).ctx })
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) {
    return P.cell('cell-cache', contextWidth(g), [...head, emptyBar(P, d, 'cache', g.bar), P.gap(1), P.fig('…', FIG, ROLE.muted, { right: true })])
  }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  return P.cell('cell-cache', contextWidth(g), [
    ...head,
    hoverGroup(T, 'cache', cacheCard(c, v), [
      plainBar(P, d, 'cache', pct, color, g.bar),
      P.gap(1),
      P.fig(v.tone === 'cold' ? '0m' : v.label, FIG, ROLE.text, { bold: true, right: true }),
      P.gap(1 + sparkRoom(g)),
      P.fig(`ttl ${c.ttl}`, AMOUNT, ROLE.sec),
      P.gap(1),
      P.fig(CACHE_STATE[v.tone], fitOf(g).key, v.tone === 'cold' ? ROLE.muted : color, { bold: v.tone !== 'warm' }),
    ]),
  ])
}

// --- Git -------------------------------------------------------------------------

// One count: a zero dims the whole item, a count above zero lights its icon.
function count(T: Table, icon: string, n: number, word: string, color: string): RenderElement {
  const { Text } = T
  if (n === 0) return <Text color={ROLE.muted}>{`${icon} 0 ${word}`}</Text>
  return <Text><Text color={color}>{icon}</Text><Text color={ROLE.text} bold>{` ${n}`}</Text><Text color={ROLE.sec}>{` ${word}`}</Text></Text>
}

// The text of one count, as `count` draws it.
function countText(icon: string, n: number, word: string): string {
  return `${icon} ${n} ${word}`
}

// The git cells: row one is the branch, ahead and behind, then the commit at
// HEAD. Row two is the diff, the file counts, then the pull request and
// issues when there are any. With `splitTail`, a row two wider than its cell
// hands the pull request and the issues to a third row, under the diff badge.
// Without the option the cells are the two the terminal draws.
// The desktop draws no diff row for a folder with no repository, so `b` is
// null there. The terminal keeps the bare badge row.
export type GitCells = { a: RenderElement; b: RenderElement | null; c: RenderElement | null }

// What a git row needs besides its badge. The terminal and the desktop read the
// same numbers, so the layout asks for the row's width before it picks a tier.
// With `isTrimmed` a count of zero leaves the diff row, so the row is shorter.
type GitOpts = { splitTail?: boolean; badge?: number; isTrimmed?: boolean }

// The counts of row two, in order, each with its icon and word. With
// `isTrimmed` a count of zero leaves the row.
function fileCounts(g: NonNullable<BandData['git']>, isTrimmed: boolean) {
  const all = [
    { icon: '●', n: g.staged, word: 'staged', color: ROLE.emeraldLt },
    { icon: '◆', n: g.unstaged, word: 'unstaged', color: ROLE.blondeLt },
    { icon: '?', n: g.untracked, word: 'untracked', color: ROLE.teal },
  ]
  return isTrimmed ? all.filter(c => c.n > 0) : all
}

// The cells of the diff counts of row two, the badge included, before the tail.
function diffWidth(g: NonNullable<BandData['git']>, badge: number, isTrimmed: boolean): number {
  return badge + 2 + `+${g.insertions}`.length + ` -${g.deletions}`.length
    + fileCounts(g, isTrimmed).reduce((sum, c) => sum + 2 + countText(c.icon, c.n, c.word).length, 0)
}

// The cells of the pull request and the issues, with the gap before each.
function tailWidth(r: BandData['remote']): number {
  const pr = r?.prNumber == null ? 0 : 2 + `⇄ PR #${r.prNumber}`.length
  const issues = r?.issues ? 2 + `◌ ${r.issues} issues`.length : 0
  return pr + issues
}

// The width the widest git row needs to show all its items on one line. A
// repository with no git has a short row, so the answer is 0. With `isTrimmed`
// the counts of zero take no room.
export function gitRowWidth(d: BandData, badge: number, isTrimmed = false): number {
  return d.git === null ? 0 : diffWidth(d.git, badge, isTrimmed) + tailWidth(d.remote)
}

export function gitCells(T: Table, P: Prims, d: BandData, width: number, opts: GitOpts = {}): GitCells {
  const { Text } = T
  const g = d.git
  const badge = opts.badge ?? TERMINAL_FIT.git
  const hold = P.hold
  const key = d.hasGitCommand
    ? P.badge({ key: 'git-pane', text: '', gem: GEMS.rhodolite, width: badge, press: { label: 'git', hotkey: 'g', onPress: d.onGit } })
    : P.badge({ key: 'git', text: '⎇ git', gem: GEMS.rhodolite, width: badge })
  const diff = P.badge({ key: 'diff', text: '± diff', gem: GEMS.rhodolite, width: badge })
  const body = width - (badge + 2)
  if (g === null) {
    const none = P.cell('git-a', width, [...key, hold(<Text color={ROLE.muted}>no git repository</Text>)])
    return { a: none, b: isDesktop(T, d) ? null : P.cell('git-b', width, [...diff]), c: null }
  }
  const r = d.remote
  const tree = g.worktree ? ` ⌥ ${g.worktree}` : ''
  const sync = g.upstream ? [`↑${g.ahead}`, `↓${g.behind}`] : ['no upstream']
  const head = `⎇ ${g.branch}${tree}  ${sync.join(' ')}  ⊙ ${g.hash} `
  const age = g.age ? `  ${g.age}` : ''
  const subject = truncate(g.subject, body - head.length - age.length)
  // The subject pads out to the age, so the age sits at the column's end.
  const fill = Math.max(0, body - head.length - age.length - subject.length)
  const rowA = P.cell('git-a', width, [
    ...key,
    hold(hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} → ${g.upstream || 'no upstream'} · ${g.ahead} ahead, ${g.behind} behind`, [
      <Text color={ROLE.teal}>⎇ </Text>,
      <Text color={ROLE.text} bold>{g.branch}</Text>,
      <Text color={ROLE.sec}>{tree}</Text>,
    ])),
    P.gap(2),
    ...(g.upstream
      ? [
        hold(<Text color={g.ahead > 0 ? ROLE.emeraldLt : ROLE.muted}>{`↑${g.ahead}`}</Text>),
        hold(<Text color={g.behind > 0 ? ROLE.blondeLt : ROLE.muted}>{` ↓${g.behind}`}</Text>),
      ]
      : [hold(<Text color={ROLE.muted}>no upstream</Text>)]),
    P.gap(2),
    hold(<Text color={ROLE.teal}>{`⊙ ${g.hash} `}</Text>),
    hold(hoverGroup(T, 'subject', g.subject, [<Text color={ROLE.text}>{subject}</Text>])),
    P.fill(fill),
    hold(<Text color={ROLE.muted}>{age}</Text>),
  ])
  const isClean = g.insertions + g.deletions === 0
  const pr = r?.prNumber == null ? null : r
  const issues = r?.issues ? r.issues : 0
  const prItems: RenderElement[] = pr === null ? [] : [
    hold(hoverGroup(T, 'pr', pr.prTitle || `PR #${pr.prNumber}`, [<Text color={ROLE.teal}>⇄ </Text>, <Text color={ROLE.text}>{`PR #${pr.prNumber}`}</Text>])),
  ]
  const issueItems: RenderElement[] = issues > 0 ? [hold(<Text color={ROLE.blondeLt}>◌ </Text>), hold(<Text color={ROLE.sec}>{`${issues} issues`}</Text>)] : []
  const isTrimmed = opts.isTrimmed === true
  const isSplit = opts.splitTail === true && (pr !== null || issues > 0) && gitRowWidth(d, badge, isTrimmed) > width
  const rowBItems: RenderElement[] = [
    ...diff,
    hold(<Text color={isClean ? ROLE.muted : ROLE.emeraldLt}>{`+${g.insertions}`}</Text>),
    hold(<Text color={isClean ? ROLE.muted : ROLE.error}>{` -${g.deletions}`}</Text>),
    ...fileCounts(g, isTrimmed).flatMap(c => [P.gap(2), hold(count(T, c.icon, c.n, c.word, c.color))]),
  ]
  if (!isSplit) {
    const tail = [...(pr === null ? [] : [P.gap(2), ...prItems]), ...(issues > 0 ? [P.gap(2), ...issueItems] : [])]
    return { a: rowA, b: P.cell('git-b', width, [...rowBItems, ...tail]), c: null }
  }
  // The third row lines the tail up under the diff counts, past the badge.
  const tailRow = [P.gap(badge + 2), ...prItems, ...(pr !== null && issues > 0 ? [P.gap(2)] : []), ...issueItems]
  return { a: rowA, b: P.cell('git-b', width, rowBItems), c: P.cell('git-c', width, tailRow) }
}

// --- Layout ----------------------------------------------------------------------

// The column plan for a band `inner` cells wide: the bar and spark lengths,
// whether git shares the rows, and the width git gets.
export type Plan = Geom & { isInline: boolean; gitWidth: number }

// The geometries to try, best first. The spark goes before the long bar.
const GEOMS: readonly Geom[] = [
  { bar: BAR_LONG, spark: SPARK_CELLS },
  { bar: BAR_SHORT, spark: SPARK_CELLS },
  { bar: BAR_LONG, spark: 0 },
  { bar: BAR_SHORT, spark: 0 },
]

// What a surface asks of the plan. `fit` swaps the surface's field widths.
// `gitMin` is the least width git needs to share the rows. `isFull` keeps only
// the first geometry, so a surface that clips nothing never draws a band with
// a short bar or no spark. The terminal passes none of these.
export type PlanOpts = { fit?: Fit; gitMin?: number; isFull?: boolean }

export function planLedger(inner: number, opts: PlanOpts = {}): Plan {
  // The row starts after one cell of padding.
  const room = inner - 1
  const gitMin = opts.gitMin ?? GIT_MIN
  const geoms = (opts.isFull === true ? GEOMS.slice(0, 1) : GEOMS).map((g): Geom => (opts.fit === undefined ? g : { ...g, fit: opts.fit }))
  const left = (g: Geom) => usageWidth(g) + SEP.length + contextWidth(g)
  for (const g of geoms) {
    const gitWidth = room - left(g) - SEP.length
    if (gitWidth >= gitMin) return { ...g, isInline: true, gitWidth }
  }
  const g = geoms.find(x => left(x) <= room) ?? (geoms[geoms.length - 1] as Geom)
  return { ...g, isInline: false, gitWidth: room }
}

// The plan options of the desktop: wider fields for the keycaps, the full
// geometry only, and git in the rows only when its widest row fits whole.
// The desktop wraps nothing, so a git cell that is too short has to clip.
export function desktopPlanOpts(d: BandData): PlanOpts {
  return { fit: DESKTOP_FIT, isFull: true, gitMin: Math.max(GIT_MIN, gitRowWidth(d, DESKTOP_FIT.git)) }
}

// The ledger rows for a band `inner` cells wide. With room, git shares the
// two rows as a third column. Without, git takes two rows of its own.
export function ledgerRows(T: Table, d: BandData, inner: number): RenderElement[] {
  const { Box } = T
  const P = primsFor(T, d)
  const opts = isDesktop(T, d) ? desktopPlanOpts(d) : {}
  const plan = planLedger(inner, opts)
  const u = d.usage
  const sep = P.vsep()
  const { a: gitA, b: gitB } = gitCells(T, P, d, plan.gitWidth, { badge: fitOf(plan).git })
  const usageRows = [
    [windowCell(T, P, d, '5h', u?.fiveHour, plan), sep, contextCell(T, P, d, plan)],
    [windowCell(T, P, d, '7d', u?.sevenDay, plan), sep, cacheCell(T, P, d, plan)],
  ]
  const row = (key: string, children: RenderElement[]) => <Box key={key} paddingLeft={1}>{children}</Box>
  const rules = ledgerRules(inner, opts, gitB !== null)
  const rule = (i: number) => {
    const spec = rules[i - 1] as RuleSpec
    return <Box key={`row-rule-${i}`} paddingLeft={1}>{P.dashRule(spec)}</Box>
  }
  if (plan.isInline) {
    // With no diff row the second row ends at its cache cell, and the column
    // line ends at the rule above it.
    return [
      row('row-0', [...(usageRows[0] ?? []), sep, gitA]),
      rule(1),
      row('row-1', gitB === null ? usageRows[1] ?? [] : [...(usageRows[1] ?? []), sep, gitB]),
    ]
  }
  return [
    row('row-0', usageRows[0] ?? []),
    rule(1),
    row('row-1', usageRows[1] ?? []),
    rule(2),
    row('row-2', [gitA]),
    ...(gitB === null ? [] : [rule(3), row('row-3', [gitB])]),
  ]
}

// The rules between ledger rows for a band `inner` cells wide, top to bottom.
// Each rule starts under the row padding, so its cell 0 is the row's cell 0.
// With `hasGitB` false the git column line ends at the first rule, and the
// rule closes it with a tee instead of a cross.
export function ledgerRules(inner: number, opts: PlanOpts = {}, hasGitB = true): RuleSpec[] {
  const plan = planLedger(inner, opts)
  const first = usageWidth(plan) + 2
  const second = first + SEP.length + contextWidth(plan)
  const width = inner - 1
  if (plan.isInline) return [{ key: 'rule-1', width, crosses: [{ at: first, glyph: '┼' }, { at: second, glyph: hasGitB ? '┼' : '┴' }] }]
  return [
    { key: 'rule-1', width, crosses: [{ at: first, glyph: '┼' }] },
    { key: 'rule-2', width, crosses: [{ at: first, glyph: '┴' }] },
    { key: 'rule-3', width, crosses: [] },
  ]
}
