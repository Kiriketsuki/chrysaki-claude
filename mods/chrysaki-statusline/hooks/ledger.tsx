// The ledger under the header: two rows on a grid of three columns, usage,
// context and git. Each column takes the width its figures need. Git takes
// the rest, so the row ends at the band's edge. A `│` with two cells of
// padding parts the columns, and the dashed rule between rows crosses it.
// Each cell opens with a filled jewel badge that ends in a powerline edge:
// 5h Emerald, 7d Teal, ctx Royal Blue Lt, cache Amethyst Lt, git and diff
// Rhodolite. Cell bodies have no ground. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { StatuslineWindow } from '../types'
import { cacheCard, toneColor } from './cache'
import type { BandData } from './draw'
import { CTX_AMBER_TOKENS, CTX_RED_TOKENS, barCells, isHandoffDue, kilo, marker, untilReset } from './format'
import { sampleLoop } from './gradient'
import { CORE, ROLE } from './palette'
import { frameColor, hoverGroup, spaces, truncate } from './prims'
import type { Table } from './prims'

const EDGE = ''
// Empty bar cells: dim sockets in the Border colour.
const SOCKET = CORE.border
// The column separator: two cells of padding on each side of the bar.
export const SEP = '  │  '
// The bar length when the band has room, and when it is tight.
const BAR_LONG = 16
const BAR_SHORT = 12
// Git needs at least this many cells to share the rows of usage and context.
// Below it, git takes two rows of its own.
const GIT_MIN = 56
// The fixed fields of the context and cache cells: figure, amount, key.
// KEY fits `⬢ h: handoff`: the painter adds the `h: ` hotkey mark.
const FIG = 4
const AMOUNT = 10
const KEY = 12

// --- Badges ----------------------------------------------------------------------

type Badge = {
  key: string
  text: string
  bg: string
  width: number
  press?: { label: string; hotkey?: string; onPress: () => void }
}

// The badge, its edge in the badge colour on no ground, and one space.
function badge(T: Table, b: Badge): RenderElement[] {
  const { Box, Text, Button } = T
  const body = b.press === undefined
    ? <Text backgroundColor={b.bg} color={ROLE.text} bold>{` ${b.text}`.padEnd(b.width)}</Text>
    : (
      <Box key={`badge-${b.key}`} width={b.width} backgroundColor={b.bg}>
        <Text backgroundColor={b.bg}> </Text>
        <Button key={b.key} label={b.press.label} hotkey={b.press.hotkey} plain onPress={b.press.onPress} />
      </Box>
    )
  return [body, <Text color={b.bg}>{EDGE}</Text>, <Text> </Text>]
}

// --- Bars ------------------------------------------------------------------------

// A colour zone of a bar: cells up to `until` percent of its length.
type Zone = { until: number; color: string }

const USAGE_ZONES: readonly Zone[] = [
  { until: 50, color: ROLE.emeraldLt },
  { until: 75, color: ROLE.teal },
  { until: 90, color: ROLE.blondeLt },
  { until: Infinity, color: ROLE.error },
]

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

// A bar coloured by the zone each cell sits in. `reached` is the colour of the
// last filled cell, or the text colour while the bar stays in its first zone.
function zoneBar(T: Table, d: BandData, pct: number, zones: readonly Zone[], length: number): Bar {
  const { Text } = T
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  const colors = cells.map((c, i) => (c.isFilled ? zoneAt(zones, ((i + 1) / length) * 100) : SOCKET))
  const runs: { color: string; text: string }[] = []
  cells.forEach((c, i) => {
    const color = colors[i] ?? SOCKET
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === color) last.text += c.glyph
    else runs.push({ color, text: c.glyph })
  })
  const filled = cells.filter(c => c.isFilled).length
  const top = filled === 0 ? undefined : colors[filled - 1]
  const reached = top === undefined || top === zones[0]?.color ? ROLE.text : top
  return { el: <Text>{runs.map(r => <Text color={r.color}>{r.text}</Text>)}</Text>, reached }
}

// A bar in one colour, for the cache that drains as it cools.
function plainBar(T: Table, d: BandData, pct: number, color: string, length: number): RenderElement {
  return zoneBar(T, d, pct, [{ until: Infinity, color }], length).el
}

function emptyBar(T: Table, length: number): RenderElement {
  const { Text } = T
  return <Text color={SOCKET}>{'─'.repeat(length)}</Text>
}

// --- Cells -----------------------------------------------------------------------

// A fixed-width figure, padded on the side away from its column edge.
function fig(T: Table, text: string, width: number, color: string, opts: { bold?: boolean; right?: boolean } = {}): RenderElement {
  const { Text } = T
  const padded = opts.right ? text.padStart(width) : text.padEnd(width)
  return <Text color={color} bold={opts.bold}>{truncate(padded, width)}</Text>
}

function cell(T: Table, key: string, width: number, children: RenderElement[]): RenderElement {
  const { Box } = T
  return <Box key={key} width={width} overflow="hidden">{children}</Box>
}

// badge 6, edge and space 2, bar, 1, percent 4, 1, reset 8.
export function usageWidth(bar: number): number {
  return 6 + 2 + bar + 1 + FIG + 1 + 8
}

// badge 9, edge and space 2, bar, 1, figure 4, 1, amount 10, 1, key 12.
export function contextWidth(bar: number): number {
  return 9 + 2 + bar + 1 + FIG + 1 + AMOUNT + 1 + KEY
}

// The reset figure. A press reads the usage endpoint now. The arrow turns
// into a half disc while the read is in flight.
function resetKey(T: Table, d: BandData, label: string, text: string): RenderElement {
  const { Box, Text, Button } = T
  return (
    <Box key={`reset-${label}`}>
      <Text color={d.isLimitsBusy ? ROLE.blondeLt : ROLE.teal}>{d.isLimitsBusy ? '◐' : '↻'}</Text>
      <Button key={`limits-${label}`} label={` ${text}`.padEnd(7)} plain dimColor onPress={d.onRefreshLimits} />
    </Box>
  )
}

// The model-scoped weekly limits, for the 7d card.
function scopedText(d: BandData): string {
  const list = d.usage?.scoped ?? []
  return list.map(s => ` · ${s.label} ${s.percent}%`).join('')
}

function windowCell(T: Table, d: BandData, label: string, w: StatuslineWindow | undefined, bar: number): RenderElement {
  const pct = w?.percent ?? 0
  const head = badge(T, { key: label, text: `${marker(pct, 50, 75)} ${label}`, bg: label === '5h' ? CORE.emerald : CORE.teal, width: 6 })
  if (w === undefined) {
    return cell(T, `cell-${label}`, usageWidth(bar), [...head, emptyBar(T, bar), spaces(T, 1 + FIG + 1), resetKey(T, d, label, 'read')])
  }
  const b = zoneBar(T, d, pct, USAGE_ZONES, bar)
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  const extra = label === '7d' ? scopedText(d) : ''
  return cell(T, `cell-${label}`, usageWidth(bar), [
    ...head,
    hoverGroup(T, `win-${label}`, `${label} window · ${pct}% used · ${when}${extra} · press the reset time to read usage now`, [
      b.el,
      spaces(T, 1),
      fig(T, `${pct}%`, FIG, b.reached, { bold: true, right: true }),
      spaces(T, 1),
      resetKey(T, d, label, reset === '' ? 'read' : reset),
    ]),
  ])
}

// The key at the end of the context row: handoff past 100k, resume in a
// fresh session with a handoff path on the clipboard, else fresh.
function contextKey(T: Table, d: BandData, tokens: number | undefined): RenderElement {
  const { Box, Text, Button } = T
  if (d.isHandingOff) return fig(T, '◐ writing', KEY, ROLE.warn, { bold: true })
  if (tokens === undefined && d.resumePath !== null) {
    return <Box key="resume-key" width={KEY} flexShrink={0} overflow="hidden"><Text color={ROLE.blondeLt} bold>⬢ </Text><Button key="resume" label="resume" hotkey="r" plain onPress={d.onResume} /></Box>
  }
  if (!isHandoffDue(tokens)) return fig(T, '◇ fresh', KEY, ROLE.emeraldLt)
  return <Box key="handoff-key" width={KEY} flexShrink={0} overflow="hidden"><Text color={ROLE.blondeLt} bold>⬢ </Text><Button key="handoff" label="handoff" hotkey="h" plain onPress={d.onHandoff} /></Box>
}

function contextCell(T: Table, d: BandData, bar: number): RenderElement {
  const { Text } = T
  const u = d.usage
  const tokens = u?.ctxTokens
  const head = badge(T, { key: 'ctx-detail', text: '', bg: CORE.blueLight, width: 9, press: { label: `${marker(u?.ctxPercent ?? 0, 50, 75)} ctx`, onPress: d.onContext } })
  if (u?.ctxPercent === undefined) {
    const name = d.resumePath === null ? 'no context yet' : d.resumePath.slice(d.resumePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
    return cell(T, 'cell-ctx', contextWidth(bar), [
      ...head, emptyBar(T, bar), spaces(T, 1 + FIG + 1), fig(T, name, AMOUNT, ROLE.muted), spaces(T, 1), contextKey(T, d, undefined),
    ])
  }
  const b = zoneBar(T, d, u.ctxPercent, contextZones(u.ctxWindow), bar)
  const used = tokens === undefined ? '' : kilo(tokens)
  const of = `/${kilo(u.ctxWindow)}`
  return cell(T, 'cell-ctx', contextWidth(bar), [
    ...head,
    hoverGroup(T, 'ctx', `context ${u.ctxPercent}% · ${tokens ?? '?'} of ${u.ctxWindow} tokens · amber from 250k, red from 500k · handoff at 100k · press ctx for the breakdown`, [
      b.el,
      spaces(T, 1),
      fig(T, `${u.ctxPercent}%`, FIG, b.reached, { bold: true, right: true }),
      spaces(T, 1),
      <Text><Text color={ROLE.text} bold>{used}</Text><Text color={ROLE.sec}>{truncate(of, AMOUNT - used.length).padEnd(AMOUNT - used.length)}</Text></Text>,
      spaces(T, 1),
      contextKey(T, d, tokens),
    ]),
  ])
}

const CACHE_STATE = { warm: '● warm', warning: '◐ cooling', cold: '○ cold' } as const

function cacheCell(T: Table, d: BandData, bar: number): RenderElement {
  const head = badge(T, { key: 'cache', text: '⧗ cache', bg: CORE.amethystLight, width: 9 })
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) {
    return cell(T, 'cell-cache', contextWidth(bar), [...head, emptyBar(T, bar), spaces(T, 1), fig(T, '…', FIG, ROLE.muted, { right: true })])
  }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  return cell(T, 'cell-cache', contextWidth(bar), [
    ...head,
    hoverGroup(T, 'cache', cacheCard(c, v), [
      plainBar(T, d, pct, color, bar),
      spaces(T, 1),
      fig(T, v.tone === 'cold' ? '0m' : v.label, FIG, ROLE.text, { bold: true, right: true }),
      spaces(T, 1),
      fig(T, `ttl ${c.ttl}`, AMOUNT, ROLE.sec),
      spaces(T, 1),
      fig(T, CACHE_STATE[v.tone], KEY, v.tone === 'cold' ? ROLE.muted : color, { bold: v.tone !== 'warm' }),
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

// Row one: branch, ahead and behind, then the commit at HEAD. Row two: the
// diff, the file counts, then the pull request and issues when there are any.
function gitCells(T: Table, d: BandData, width: number): [RenderElement, RenderElement] {
  const { Text } = T
  const g = d.git
  const key = d.hasGitCommand
    ? badge(T, { key: 'git-pane', text: '', bg: CORE.rhodolite, width: 8, press: { label: 'git', hotkey: 'g', onPress: d.onGit } })
    : badge(T, { key: 'git', text: '⎇ git', bg: CORE.rhodolite, width: 8 })
  const diff = badge(T, { key: 'diff', text: '± diff', bg: CORE.rhodolite, width: 8 })
  const body = width - 10
  if (g === null) {
    return [cell(T, 'git-a', width, [...key, <Text color={ROLE.muted}>no git repository</Text>]), cell(T, 'git-b', width, [...diff])]
  }
  const r = d.remote
  const tree = g.worktree ? ` ⌥ ${g.worktree}` : ''
  const sync = g.upstream ? [`↑${g.ahead}`, `↓${g.behind}`] : ['no upstream']
  const head = `⎇ ${g.branch}${tree}  ${sync.join(' ')}  ⊙ ${g.hash} `
  const age = g.age ? `  ${g.age}` : ''
  const subject = truncate(g.subject, body - head.length - age.length)
  // The subject pads out to the age, so the age sits at the column's end.
  const fill = Math.max(0, body - head.length - age.length - subject.length)
  const rowA = cell(T, 'git-a', width, [
    ...key,
    hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} → ${g.upstream || 'no upstream'} · ${g.ahead} ahead, ${g.behind} behind`, [
      <Text color={ROLE.teal}>⎇ </Text>,
      <Text color={ROLE.text} bold>{g.branch}</Text>,
      <Text color={ROLE.sec}>{tree}</Text>,
    ]),
    spaces(T, 2),
    ...(g.upstream
      ? [
        <Text color={g.ahead > 0 ? ROLE.emeraldLt : ROLE.muted}>{`↑${g.ahead}`}</Text>,
        <Text color={g.behind > 0 ? ROLE.blondeLt : ROLE.muted}>{` ↓${g.behind}`}</Text>,
      ]
      : [<Text color={ROLE.muted}>no upstream</Text>]),
    spaces(T, 2),
    <Text color={ROLE.teal}>{`⊙ ${g.hash} `}</Text>,
    hoverGroup(T, 'subject', g.subject, [<Text color={ROLE.text}>{subject}</Text>]),
    spaces(T, fill),
    <Text color={ROLE.muted}>{age}</Text>,
  ])
  const isClean = g.insertions + g.deletions === 0
  const pr = r?.prNumber == null ? null : r
  const rowB = cell(T, 'git-b', width, [
    ...diff,
    <Text color={isClean ? ROLE.muted : ROLE.emeraldLt}>{`+${g.insertions}`}</Text>,
    <Text color={isClean ? ROLE.muted : ROLE.error}>{` -${g.deletions}`}</Text>,
    spaces(T, 2),
    count(T, '●', g.staged, 'staged', ROLE.emeraldLt),
    spaces(T, 2),
    count(T, '◆', g.unstaged, 'unstaged', ROLE.blondeLt),
    spaces(T, 2),
    count(T, '?', g.untracked, 'untracked', ROLE.teal),
    ...(pr === null ? [] : [
      spaces(T, 2),
      hoverGroup(T, 'pr', pr.prTitle || `PR #${pr.prNumber}`, [<Text color={ROLE.teal}>⇄ </Text>, <Text color={ROLE.text}>{`PR #${pr.prNumber}`}</Text>]),
    ]),
    ...(r?.issues ? [spaces(T, 2), <Text color={ROLE.blondeLt}>◌ </Text>, <Text color={ROLE.sec}>{`${r.issues} issues`}</Text>] : []),
  ])
  return [rowA, rowB]
}

// --- Layout ----------------------------------------------------------------------

// The dashed rule between two ledger rows. A separator above and below it
// crosses it as `┼`. One above alone ends on it as `┴`. Animated, each dash
// takes its place on the gradient loop, shifted by the sweep frame. Inside the
// cache warning lead, or with the animation off, the rule takes the frame
// colour.
function dashRule(T: Table, d: BandData, width: number, crosses: readonly Cross[]): RenderElement {
  const { Text } = T
  const base = frameColor(d)
  const text = ruleText(width, crosses)
  if (!d.isRuleAnimated || base !== 'promptBorder') return <Text color={base}>{text}</Text>
  const unit = DASH + GAP_CELLS
  const parts: RenderElement[] = []
  for (let x = 0; x < width; x += unit) {
    parts.push(<Text color={sampleLoop(SWEEP_STOPS, x / Math.max(1, width) + d.sweep / SWEEP_FRAMES)}>{text.slice(x, x + unit)}</Text>)
  }
  return <Text>{parts}</Text>
}

// A dash run of DASH cells, then GAP_CELLS blank cells, cut to `width`.
const DASH = 2
const GAP_CELLS = 1

// The animated rule: a gradient loop that travels one full cycle across the
// band in SWEEP_FRAMES steps. Only safe line accents take part: Royal Blue and
// Amethyst are fills alone.
export const SWEEP_FRAMES = 40
const SWEEP_STOPS = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean, ROLE.teal] as const

export function dashes(width: number): string {
  const unit = '─'.repeat(DASH) + ' '.repeat(GAP_CELLS)
  return unit.repeat(Math.ceil(Math.max(0, width) / unit.length)).slice(0, Math.max(0, width))
}

// Where a column separator meets the rule, and how.
export type Cross = { at: number; glyph: '┼' | '┴' }

// The dashes with each crossing drawn in. A crossing gets a dash cell on both
// sides, so it never floats in a gap.
export function ruleText(width: number, crosses: readonly Cross[]): string {
  const cells = [...dashes(width)]
  for (const c of crosses) {
    if (c.at < 0 || c.at >= width) continue
    cells[c.at] = c.glyph
    if (c.at > 0) cells[c.at - 1] = '─'
    if (c.at + 1 < width) cells[c.at + 1] = '─'
  }
  return cells.join('')
}

// The column plan for a band `inner` cells wide: the bar length, whether git
// shares the rows, and the width git gets.
export type Plan = { bar: number; isInline: boolean; gitWidth: number }

export function planLedger(inner: number): Plan {
  // The row starts after one cell of padding.
  const room = inner - 1
  const left = (bar: number) => usageWidth(bar) + SEP.length + contextWidth(bar)
  for (const bar of [BAR_LONG, BAR_SHORT]) {
    const gitWidth = room - left(bar) - SEP.length
    if (gitWidth >= GIT_MIN) return { bar, isInline: true, gitWidth }
  }
  const bar = left(BAR_LONG) <= room ? BAR_LONG : BAR_SHORT
  return { bar, isInline: false, gitWidth: room }
}

// The ledger rows for a band `inner` cells wide. With room, git shares the
// two rows as a third column. Without, git takes two rows of its own.
export function ledgerRows(T: Table, d: BandData, inner: number): RenderElement[] {
  const { Box, Text } = T
  const plan = planLedger(inner)
  const u = d.usage
  const sep = <Text color={frameColor(d)}>{SEP}</Text>
  const [gitA, gitB] = gitCells(T, d, plan.gitWidth)
  const usageRows = [
    [windowCell(T, d, '5h', u?.fiveHour, plan.bar), sep, contextCell(T, d, plan.bar)],
    [windowCell(T, d, '7d', u?.sevenDay, plan.bar), sep, cacheCell(T, d, plan.bar)],
  ]
  const row = (key: string, children: RenderElement[]) => <Box key={key} paddingLeft={1}>{children}</Box>
  // The rule starts under the row padding, so its cell 0 is the row's cell 0.
  const first = usageWidth(plan.bar) + 2
  const second = first + SEP.length + contextWidth(plan.bar)
  const width = inner - 1
  const rule = (i: number, crosses: Cross[]) => <Box key={`row-rule-${i}`} paddingLeft={1}>{dashRule(T, d, width, crosses)}</Box>
  if (plan.isInline) {
    return [
      row('row-0', [...(usageRows[0] ?? []), sep, gitA]),
      rule(1, [{ at: first, glyph: '┼' }, { at: second, glyph: '┼' }]),
      row('row-1', [...(usageRows[1] ?? []), sep, gitB]),
    ]
  }
  return [
    row('row-0', usageRows[0] ?? []),
    rule(1, [{ at: first, glyph: '┼' }]),
    row('row-1', usageRows[1] ?? []),
    rule(2, [{ at: first, glyph: '┴' }]),
    row('row-2', [gitA]),
    rule(3, []),
    row('row-3', [gitB]),
  ]
}
