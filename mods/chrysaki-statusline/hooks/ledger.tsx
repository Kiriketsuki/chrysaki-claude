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
import { CTX_AMBER_TOKENS, CTX_RED_TOKENS, barCells, isHandoffDue, kilo, smoothCells, untilReset, usageColor } from './format'
import { loopSampler, mixHex } from './gradient'
import { CORE, ROLE } from './palette'
import { frameColor, hoverGroup, spaces, truncate } from './prims'
import type { Table } from './prims'
import { hasRaster, packCells, paintCells } from './raster'
import type { Paint } from './raster'

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

// The caps that make a badge a flat hexagon: ◀ body ▶.
const CAP_LEFT = '\ue0b2'
const CAP_RIGHT = '\ue0b0'

type Badge = {
  key: string
  text: string
  gem: Gem
  // The badge's cells, its left cap included. The right cap and one space follow.
  width: number
  press?: { label: string; hotkey?: string; onPress: () => void }
}

function center(text: string, width: number): string {
  const room = Math.max(0, width - text.length)
  const left = Math.floor(room / 2)
  return ' '.repeat(left) + text + ' '.repeat(room - left)
}

// A hexagon gem badge: the left cap, a body whose ground runs across the
// facet cell by cell, the right cap, and one space. A pressable badge draws
// its cells as the children of a plain Button.
function badge(T: Table, b: Badge): RenderElement[] {
  const { Box, Text, Button } = T
  const inner = b.width - 1
  const at = (i: number) => facet(b.gem, i / Math.max(1, inner - 1))
  const cells = (text: string, offset: number) => [...text].map((ch, i) => <Text backgroundColor={at(i + offset)} color={ROLE.text} bold>{ch}</Text>)
  const mark = b.press?.hotkey === undefined ? 0 : 3
  const body = b.press === undefined
    ? <Text>{cells(center(b.text, inner), 0)}</Text>
    : (
      <Box key={`badge-${b.key}`} width={inner} backgroundColor={at(1)}>
        <Button key={b.key} hotkey={b.press.hotkey} plain onPress={b.press.onPress}>{cells(center(b.press.label, inner - mark), mark)}</Button>
      </Box>
    )
  return [<Text color={at(0)}>{CAP_LEFT}</Text>, body, <Text color={at(inner - 1)}>{CAP_RIGHT}</Text>, <Text> </Text>]
}

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

// One row of cells: a Raster on the terminal, runs of Text elsewhere.
export function paintRow(T: Table, surface: string, key: string, paints: readonly Paint[]): RenderElement {
  if (hasRaster(T, surface)) {
    const { Raster } = T
    return <Raster key={key} columns={paints.length} rows={1} cells={packCells(paintCells(paints))} />
  }
  const { Text } = T
  const runs: { fg: string | null; bg: string | null; text: string }[] = []
  for (const p of paints) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.fg === p.fg && last.bg === p.bg) last.text += p.glyph
    else runs.push({ fg: p.fg, bg: p.bg, text: p.glyph })
  }
  return (
    <Text key={key}>
      {runs.map(r => <Text {...(r.fg === null ? {} : { color: r.fg })} {...(r.bg === null ? {} : { backgroundColor: r.bg })}>{r.text}</Text>)}
    </Text>
  )
}

// A bar coloured by its scale at each cell. `reached` is the colour at the
// percent, or the text colour while the bar stays in its calm zone.
function zoneBar(T: Table, d: BandData, key: string, pct: number, scale: Scale, length: number): Bar {
  const { Text } = T
  const top = scale.at(pct, length)
  if (d.barStyle === 'smooth') {
    const paints = smoothPaints(pct, scale, length)
    const isEmpty = paints.every(p => p.fg === null)
    return { el: paintRow(T, d.surface, `bar-${key}`, paints), reached: isEmpty || top === scale.calm ? ROLE.text : top }
  }
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  const colors = cells.map((c, i) => (c.isFilled ? scale.at(((i + 0.5) / length) * 100, length) : SOCKET))
  const runs: { color: string; text: string }[] = []
  cells.forEach((c, i) => {
    const color = colors[i] ?? SOCKET
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === color) last.text += c.glyph
    else runs.push({ color, text: c.glyph })
  })
  const isEmpty = cells.every(c => !c.isFilled)
  return { el: <Text>{runs.map(r => <Text color={r.color}>{r.text}</Text>)}</Text>, reached: isEmpty || top === scale.calm ? ROLE.text : top }
}

// A bar in one colour, for the cache that drains as it cools.
function plainBar(T: Table, d: BandData, key: string, pct: number, color: string, length: number): RenderElement {
  return zoneBar(T, d, key, pct, { at: () => color, calm: color }, length).el
}

// A bar with no figure yet: the bare track.
function emptyBar(T: Table, d: BandData, key: string, length: number): RenderElement {
  const { Text } = T
  if (d.barStyle === 'smooth') return paintRow(T, d.surface, `bar-${key}`, smoothPaints(0, USAGE_SCALE, length))
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
  const head = badge(T, { key: label, text: label, gem: label === '5h' ? GEMS.emerald : GEMS.teal, width: 6 })
  if (w === undefined) {
    return cell(T, `cell-${label}`, usageWidth(bar), [...head, emptyBar(T, d, label, bar), spaces(T, 1 + FIG + 1), resetKey(T, d, label, 'read')])
  }
  const b = zoneBar(T, d, label, pct, USAGE_SCALE, bar)
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
  const head = badge(T, { key: 'ctx-detail', text: '', gem: GEMS.blue, width: 9, press: { label: 'ctx', onPress: d.onContext } })
  if (u?.ctxPercent === undefined) {
    const name = d.resumePath === null ? 'no context yet' : d.resumePath.slice(d.resumePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
    return cell(T, 'cell-ctx', contextWidth(bar), [
      ...head, emptyBar(T, d, 'ctx', bar), spaces(T, 1 + FIG + 1), fig(T, name, AMOUNT, ROLE.muted), spaces(T, 1), contextKey(T, d, undefined),
    ])
  }
  const b = zoneBar(T, d, 'ctx', u.ctxPercent, zoneScale(contextZones(u.ctxWindow)), bar)
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
  const head = badge(T, { key: 'cache', text: '⧗ cache', gem: GEMS.amethyst, width: 9 })
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) {
    return cell(T, 'cell-cache', contextWidth(bar), [...head, emptyBar(T, d, 'cache', bar), spaces(T, 1), fig(T, '…', FIG, ROLE.muted, { right: true })])
  }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  return cell(T, 'cell-cache', contextWidth(bar), [
    ...head,
    hoverGroup(T, 'cache', cacheCard(c, v), [
      plainBar(T, d, 'cache', pct, color, bar),
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
    ? badge(T, { key: 'git-pane', text: '', gem: GEMS.rhodolite, width: 8, press: { label: 'git', hotkey: 'g', onPress: d.onGit } })
    : badge(T, { key: 'git', text: '⎇ git', gem: GEMS.rhodolite, width: 8 })
  const diff = badge(T, { key: 'diff', text: '± diff', gem: GEMS.rhodolite, width: 8 })
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

// The animated rule: a gradient loop that travels one full cycle across the
// band in SWEEP_FRAMES steps. Only safe line accents take part: Royal Blue and
// Amethyst are fills alone.
export const SWEEP_FRAMES = 40
const SWEEP_STOPS = [ROLE.emeraldLt, ROLE.teal, CORE.cerulean, ROLE.teal] as const
const sweepAt = loopSampler(SWEEP_STOPS)

// The dashed rule between two ledger rows. A separator above and below it
// crosses it as `┼`. One above alone ends on it as `┴`. Animated, each dash
// takes its place on the gradient loop, shifted by the sweep frame. On the
// terminal the rule is a Raster, and the sweep clock repaints its cells with
// `$.ui.blit`, so the band does not draw again. Elsewhere the rule keeps the
// frame of its last draw. Inside the cache warning lead, or with the
// animation off, the rule takes the frame colour.
function dashRule(T: Table, d: BandData, spec: RuleSpec): RenderElement {
  const { Text } = T
  const base = frameColor(d)
  const text = ruleText(spec.width, spec.crosses)
  if (!d.isRuleAnimated || base !== 'promptBorder') return <Text color={base}>{text}</Text>
  if (hasRaster(T, d.surface)) return paintRow(T, d.surface, spec.key, rulePaints(spec, d.sweep))
  const unit = DASH + GAP_CELLS
  const parts: RenderElement[] = []
  for (let x = 0; x < spec.width; x += unit) {
    parts.push(<Text color={sweepAt(x / Math.max(1, spec.width) + d.sweep / SWEEP_FRAMES)}>{text.slice(x, x + unit)}</Text>)
  }
  return <Text>{parts}</Text>
}

// True when the band draws its rules as Rasters the sweep clock repaints.
export function isRuleLive(T: Table, d: BandData): boolean {
  return d.isRuleAnimated && frameColor(d) === 'promptBorder' && hasRaster(T, d.surface)
}

// One animated rule: its Raster key, its width and its crossings.
export type RuleSpec = { key: string; width: number; crosses: Cross[] }

// The cells of a rule at sweep frame `frame`. Each dash cell takes its own
// place on the gradient loop. Gaps take the terminal's colour.
export function rulePaints(spec: RuleSpec, frame: number): Paint[] {
  const width = Math.max(1, spec.width)
  return [...ruleText(spec.width, spec.crosses)].map((glyph, x) => ({
    glyph,
    fg: glyph === ' ' ? null : sweepAt(x / width + frame / SWEEP_FRAMES),
    bg: null,
  }))
}

// The packed cells a blit sends for a rule at sweep frame `frame`.
export function ruleFrame(spec: RuleSpec, frame: number): string {
  return packCells(paintCells(rulePaints(spec, frame)))
}

// A dash run of DASH cells, then GAP_CELLS blank cells, cut to `width`.
const DASH = 2
const GAP_CELLS = 1


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
  const rules = ledgerRules(inner)
  const rule = (i: number) => {
    const spec = rules[i - 1] as RuleSpec
    return <Box key={`row-rule-${i}`} paddingLeft={1}>{dashRule(T, d, spec)}</Box>
  }
  if (plan.isInline) {
    return [
      row('row-0', [...(usageRows[0] ?? []), sep, gitA]),
      rule(1),
      row('row-1', [...(usageRows[1] ?? []), sep, gitB]),
    ]
  }
  return [
    row('row-0', usageRows[0] ?? []),
    rule(1),
    row('row-1', usageRows[1] ?? []),
    rule(2),
    row('row-2', [gitA]),
    rule(3),
    row('row-3', [gitB]),
  ]
}

// The rules between ledger rows for a band `inner` cells wide, top to bottom.
// Each rule starts under the row padding, so its cell 0 is the row's cell 0.
export function ledgerRules(inner: number): RuleSpec[] {
  const plan = planLedger(inner)
  const first = usageWidth(plan.bar) + 2
  const second = first + SEP.length + contextWidth(plan.bar)
  const width = inner - 1
  if (plan.isInline) return [{ key: 'rule-1', width, crosses: [{ at: first, glyph: '┼' }, { at: second, glyph: '┼' }] }]
  return [
    { key: 'rule-1', width, crosses: [{ at: first, glyph: '┼' }] },
    { key: 'rule-2', width, crosses: [{ at: first, glyph: '┴' }] },
    { key: 'rule-3', width, crosses: [] },
  ]
}
