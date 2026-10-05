// Builds the band's tree from the collected values. No I/O happens here.
//
// The band is one more ruled section of the prompt box. Its rules and column
// dividers take the theme colour of the prompt's own rules (`promptBorder`).
// The header rule carries the brand segments on the left and their mirror on
// the right. Below it, a grid of cells spans the full width.

import type { ElementConstructor, Elements, RasterProps, RenderElement } from 'claude-code'

import type { CacheView, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineRemote, StatuslineUsage } from '../types'
import { cacheCard, toneColor } from './cache'
import {
  barCells, costSgd, ctxColor, ctxMarker, fiveHourColor, isHandoffDue, kilo, leftEdge, marker, modelLabel,
  rightEdge, sessionClock, sevenDayColor, smartCwd, untilReset,
} from './format'
import type { BarStyle } from './format'
import { CORE, JEWELS, ROLE } from './palette'
import { barRaster } from './raster'

export type Table = Elements[keyof Elements]
type RasterEl = ElementConstructor<RasterProps> | undefined

export type BandData = {
  usage: StatuslineUsage | null
  identity: StatuslineIdentity | null
  git: StatuslineGit | null
  remote: StatuslineRemote | null
  inbox: number
  phase: number
  now: number
  home: string
  columns: number
  barStyle: BarStyle
  usdToSgd: number
  onContext: () => void
  cache: StatuslineCache | null
  cacheView: CacheView | null
  hasGitCommand: boolean
  onGit: () => void
  // True while a handoff the band started is still being written.
  isHandingOff: boolean
  onHandoff: () => void
}

// Below this width the band folds to the header and one line.
export const NARROW_COLUMNS = 100
// At this width and above, git gets a third column. Below it, git takes
// full-width rows under the two bar columns.
export const WIDE_COLUMNS = 150
// The engine draws its collapse mark `[-]` over the last cells of the band's
// first row. The band stops short of it.
const RESERVE = 4
const RULE = '─'
// The theme key of the prompt's rules. Text colours take a theme key.
const RULE_COLOR = 'promptBorder'
const HOURGLASS = '⧗'
const GAP = 3
const BAR_MIN = 12
const BAR_MAX = 40
const GIT_MIN = 60

// --- Primitives ----------------------------------------------------------------

type Seg = { text: string; bg: string; fg: string; bold?: boolean }

function segWidth(segs: readonly Seg[]): number {
  return segs.reduce((n, s) => n + s.text.length + 3, 0)
}

// A zigzag-alt run read left to right: each segment, then the glyph that
// joins it to the next, in this segment's colour on the next one's ground.
function zigzag(T: Table, segs: readonly Seg[]): RenderElement[] {
  const { Text } = T
  return segs.flatMap((s, i) => {
    const next = segs[i + 1]
    const edge = rightEdge(i, segs.length)
    return [
      <Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{` ${s.text} `}</Text>,
      next === undefined ? <Text color={s.bg}>{edge}</Text> : <Text color={s.bg} backgroundColor={next.bg}>{edge}</Text>,
    ]
  })
}

// The mirror run, read right to left: the glyph before each segment, in that
// segment's colour on the previous one's ground, then the segment.
function mirrored(T: Table, segs: readonly Seg[]): RenderElement[] {
  const { Text } = T
  return segs.flatMap((s, j) => {
    const prev = segs[j - 1]
    const edge = leftEdge(j, segs.length)
    return [
      prev === undefined ? <Text color={s.bg}>{edge}</Text> : <Text color={s.bg} backgroundColor={prev.bg}>{edge}</Text>,
      <Text backgroundColor={s.bg} color={s.fg} bold={s.bold}>{` ${s.text} `}</Text>,
    ]
  })
}

// A group that shows a card one row above it while hovered.
function hoverGroup(T: Table, key: string, card: string, children: RenderElement[]): RenderElement {
  const { Box, Text } = T
  return (
    <Box key={key}>
      {children}
      <Box position="absolute" top={-1} left={0} display="none" hover={{ display: 'flex' }} backgroundColor={CORE.elevated} paddingX={1}>
        <Text color={ROLE.text}>{card}</Text>
      </Box>
    </Box>
  )
}

function spaces(T: Table, n: number): RenderElement {
  const { Text } = T
  return <Text>{' '.repeat(Math.max(0, n))}</Text>
}

function bar(T: Table, R: RasterEl, key: string, pct: number, color: string, d: BandData, length: number): RenderElement {
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  const isLine = d.barStyle === 'line'
  if (R !== undefined && !isLine) return <R key={key} columns={length} rows={1} cells={barRaster(cells, color, ROLE.hexEmpty)} />
  const { Text } = T
  const on = cells.filter(c => c.isFilled).map(c => c.glyph).join('')
  const off = cells.filter(c => !c.isFilled).map(c => c.glyph).join('')
  return <Text><Text color={color}>{on}</Text><Text color={isLine ? RULE_COLOR : ROLE.hexEmpty}>{off}</Text></Text>
}

function frameColor(d: BandData): string {
  // The rules warm to Blonde inside the cache warning lead, so the alert also
  // shows in the shape of the band.
  return d.cacheView?.tone === 'warning' ? ROLE.warn : RULE_COLOR
}

function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}

// --- Header --------------------------------------------------------------------

// The header: brand segments, a rule in the prompt's colour, then the mirror
// run with cost, session time and account.
function header(T: Table, d: BandData, inner: number, isCompact: boolean): RenderElement {
  const { Box, Text } = T
  const id = d.identity
  const u = d.usage
  const left: Seg[] = [
    { text: `⬢ ${modelLabel(id?.model ?? '')}`, bg: CORE.emerald, fg: ROLE.text, bold: true },
    ...(id?.version && !isCompact ? [{ text: `v${id.version}`, bg: CORE.blueLight, fg: ROLE.text }] : []),
    { text: smartCwd(id?.cwd ?? '', d.home), bg: CORE.amethystLight, fg: ROLE.text, bold: true },
  ]
  // The mirror of the left run: Amethyst, Royal Blue, then Emerald at the edge.
  const email = id?.email ?? ''
  const right: Seg[] = [
    ...(u?.costUsd === undefined ? [] : [{ text: `$${costSgd(u.costUsd, d.usdToSgd)}`, bg: CORE.amethystLight, fg: ROLE.text, bold: true }]),
    ...(u?.startedAt === undefined ? [] : [{ text: `◷ ${sessionClock(d.now - u.startedAt)}`, bg: CORE.blueLight, fg: ROLE.text }]),
    ...(email && !isCompact ? [{ text: email, bg: id?.isWorkAccount ? CORE.topaz : CORE.emerald, fg: ROLE.text, bold: true }] : []),
  ]
  const inbox = d.inbox > 0 ? `◇ inbox ${d.inbox} ` : ''
  const room = Math.max(0, inner - segWidth(left) - segWidth(right) - inbox.length - 2)
  return (
    <Box key="header">
      {hoverGroup(T, 'brand', `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`, zigzag(T, left))}
      <Text color={frameColor(d)}>{` ${RULE.repeat(room)} `}</Text>
      {inbox ? <Text color={ROLE.emeraldLt}>{inbox}</Text> : <Text />}
      {right.length > 0
        ? hoverGroup(T, 'cost', u?.costUsd === undefined ? 'session' : `US$${u.costUsd.toFixed(2)} this session`, mirrored(T, right))
        : <Text />}
    </Box>
  )
}

// --- Bar cells -----------------------------------------------------------------

// One figure in a cell's right-hand table. Slots line up down a column:
// each slot index takes the width of its widest entry.
type Slot = {
  text: string
  color: string
  bold?: boolean
  isRight?: boolean
  // A pressable slot: a coloured glyph, then a plain Button. `text` holds the
  // whole drawn width, glyph and hotkey included, for the column measure.
  press?: { key: string; glyph: string; label: string; hotkey: string; onPress: () => void }
}

type BarCell = {
  key: string
  label: RenderElement[]
  labelWidth: number
  bar: { key: string; pct: number; color: string } | null
  slots: Slot[]
}

function windowCell(T: Table, label: string, w: { percent: number; resetsAt?: number } | undefined, color: (p: number) => string, d: BandData): BarCell {
  const { Text } = T
  const head = `${marker(w?.percent ?? 0, 50, 75)} ${label.padEnd(3)}`
  if (w === undefined) return { key: label, label: [<Text color={ROLE.muted}>{head}</Text>], labelWidth: head.length, bar: null, slots: [] }
  const c = color(w.percent)
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  return {
    key: label,
    label: [hoverGroup(T, `win-${label}`, `${label} window · ${w.percent}% used · ${when}`, [<Text color={c}>{head}</Text>])],
    labelWidth: head.length,
    bar: { key: `bar-${label}`, pct: w.percent, color: c },
    slots: [
      { text: `${w.percent}%`, color: c, isRight: true },
      { text: reset === '' ? '' : `↻ ${reset}`, color: ROLE.muted },
    ],
  }
}

function contextCell(T: Table, d: BandData): BarCell {
  const { Text, Button } = T
  const u = d.usage
  if (u?.ctxPercent === undefined) {
    return { key: 'ctx', label: [<Text color={ROLE.muted}>{'▰ ctx  '}</Text>], labelWidth: 7, bar: null, slots: [] }
  }
  const pct = u.ctxPercent
  const color = ctxColor(pct, u.ctxTokens)
  return {
    key: 'ctx',
    label: [hoverGroup(T, 'ctx', `context ${pct}% · ${u.ctxTokens ?? '?'} of ${u.ctxWindow} tokens · handoff at 100k · press ctx for the breakdown`, [
      <Text color={color}>{`${ctxMarker(pct, u.ctxTokens)} `}</Text>,
      <Button key="ctx-detail" label="ctx" plain onPress={d.onContext} />,
    ])],
    labelWidth: 5,
    bar: { key: 'bar-ctx', pct, color },
    slots: [
      { text: `${pct}%`, color, isRight: true },
      { text: u.ctxTokens === undefined ? '' : `${kilo(u.ctxTokens)} / ${kilo(u.ctxWindow)}`, color: ROLE.muted },
      handoffSlot(u.ctxTokens, d),
    ],
  }
}

// The handoff slot. Past the handoff threshold it is a button: h, or a
// click, sends /context-handoff and copies the handoff path when it is done.
function handoffSlot(tokens: number | undefined, d: BandData): Slot {
  if (d.isHandingOff) return { text: '◐ handing off', color: ROLE.warn, bold: true }
  if (!isHandoffDue(tokens)) return { text: '◇ fresh', color: ROLE.emeraldLt }
  return {
    text: '⬢ h: handoff',
    color: ROLE.warn,
    bold: true,
    press: { key: 'handoff', glyph: '⬢ ', label: 'handoff', hotkey: 'h', onPress: d.onHandoff },
  }
}

const CACHE_STATE: Record<CacheView['tone'], { text: string; }> = {
  warm: { text: '● warm' },
  warning: { text: '◐ cooling' },
  cold: { text: '○ cold' },
}

// The cache cell drains as the cache cools: its bar shows the share of the
// TTL that is left.
function cacheCell(T: Table, d: BandData): BarCell {
  const { Text } = T
  const head = `${HOURGLASS} cache`
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) {
    return { key: 'cache', label: [<Text color={ROLE.muted}>{head}</Text>], labelWidth: head.length, bar: null, slots: [{ text: '…', color: ROLE.muted }] }
  }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  return {
    key: 'cache',
    label: [hoverGroup(T, 'cache', cacheCard(c, v), [<Text color={color}>{head}</Text>])],
    labelWidth: head.length,
    bar: { key: 'bar-cache', pct, color },
    slots: [
      { text: v.tone === 'cold' ? '0m' : v.label, color, isRight: true },
      { text: `ttl ${c.ttl}`, color: ROLE.muted },
      { text: CACHE_STATE[v.tone].text, color, bold: v.tone !== 'warm' },
    ],
  }
}

// The shared measures of one grid column of bar cells.
type ColumnFit = { labelWidth: number; slotWidths: number[]; figuresWidth: number }

function fitColumn(cells: readonly BarCell[]): ColumnFit {
  const labelWidth = Math.max(0, ...cells.map(c => c.labelWidth))
  const count = Math.max(0, ...cells.map(c => c.slots.length))
  const slotWidths = Array.from({ length: count }, (_, i) => Math.max(0, ...cells.map(c => c.slots[i]?.text.length ?? 0)))
  const figuresWidth = slotWidths.reduce((n, w) => n + w, 0) + GAP * Math.max(0, count - 1)
  return { labelWidth, slotWidths, figuresWidth }
}

// The width a bar column needs for a bar of `barLength`: padding, label, a
// space, the bar, a gap, then the figures.
function columnNeed(f: ColumnFit, barLength: number): number {
  return 1 + f.labelWidth + 1 + barLength + 2 + f.figuresWidth + 1
}

function barCell(T: Table, R: RasterEl, c: BarCell, f: ColumnFit, barLength: number, width: number, d: BandData): RenderElement {
  const { Box, Text, Button } = T
  const figures: RenderElement[] = []
  f.slotWidths.forEach((w, i) => {
    const s = c.slots[i]
    if (i > 0) figures.push(spaces(T, GAP))
    if (s === undefined || s.text === '') {
      figures.push(spaces(T, w))
      return
    }
    if (s.press !== undefined) {
      figures.push(<Text color={s.color} bold={s.bold}>{s.press.glyph}</Text>)
      figures.push(<Button key={s.press.key} label={s.press.label} hotkey={s.press.hotkey} plain onPress={s.press.onPress} />)
      figures.push(spaces(T, w - s.text.length))
      return
    }
    const padded = s.isRight ? s.text.padStart(w) : s.text.padEnd(w)
    figures.push(<Text color={s.color} bold={s.bold}>{padded}</Text>)
  })
  const barEl = c.bar === null
    ? <Text color={RULE_COLOR}>{'┄'.repeat(barLength)}</Text>
    : bar(T, R, c.bar.key, c.bar.pct, c.bar.color, d, barLength)
  return (
    <Box key={`cell-${c.key}`} width={width} paddingX={1} overflow="hidden">
      <Box flexShrink={0}>{c.label}</Box>
      {spaces(T, f.labelWidth - c.labelWidth + 1)}
      {barEl}
      {spaces(T, 2)}
      {figures}
    </Box>
  )
}

// --- Git cells -----------------------------------------------------------------

// Row one: the branch and its upstream, then the commit at HEAD. Row two: the
// changes, then pull request and issues flush right.
function gitRows(T: Table, d: BandData, width: number): [RenderElement, RenderElement] {
  const { Box, Text, Button } = T
  const g = d.git
  if (g === null) {
    const none = <Box key="git-a" width={width} paddingX={1}><Text color={ROLE.muted}>⎇ no git repository</Text></Box>
    return [none, <Box key="git-b" width={width} />]
  }
  const inner = width - 2
  const jewel = JEWELS[d.phase % JEWELS.length] ?? ROLE.emeraldLt
  const r = d.remote
  const key = d.hasGitCommand ? 'g: git  ' : ''
  const name = `⎇ ${g.branch}`
  const sync = g.upstream ? `  ↑${g.ahead} ↓${g.behind}` : '  no upstream'
  const tree = g.worktree ? `  worktree:${g.worktree}` : ''
  const headText = `⊙ ${g.hash}`
  const age = g.age ? `  · ${g.age}` : ''
  const used = key.length + name.length + sync.length + tree.length + GAP + headText.length + 1 + age.length
  const subject = truncate(g.subject, inner - used)
  const rowA = (
    <Box key="git-a" width={width} paddingX={1} overflow="hidden">
      {d.hasGitCommand ? <Button key="git-pane" label="git" hotkey="g" plain onPress={d.onGit} /> : <Text />}
      {d.hasGitCommand ? spaces(T, 2) : <Text />}
      {hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} → ${g.upstream || 'no upstream'} · ${g.ahead} ahead, ${g.behind} behind`, [
        <Text color={jewel} bold>{name}</Text>,
      ])}
      <Text color={g.ahead + g.behind > 0 ? ROLE.blondeLt : ROLE.muted}>{sync}</Text>
      {tree ? <Text color={ROLE.sec}>{tree}</Text> : <Text />}
      {spaces(T, GAP)}
      <Text color={ROLE.muted}>{headText}</Text>
      <Text color={ROLE.sec}>{` ${subject}`}</Text>
      <Text color={ROLE.muted}>{age}</Text>
    </Box>
  )
  const isClean = g.insertions + g.deletions === 0
  const counts = [
    { text: `● ${g.staged} staged`, color: g.staged > 0 ? ROLE.green : ROLE.muted },
    { text: `✚ ${g.unstaged} unstaged`, color: g.unstaged > 0 ? ROLE.orange : ROLE.muted },
    { text: `? ${g.untracked} untracked`, color: g.untracked > 0 ? ROLE.blondeLt : ROLE.muted },
  ]
  const pr = r?.prNumber == null ? '' : `PR #${r.prNumber}`
  const issues = r?.issues ? `◈ ${r.issues} issues` : ''
  const rightText = [pr, issues].filter(s => s).join('   ')
  const leftWidth = `+${g.insertions} -${g.deletions}`.length + counts.reduce((n, c) => n + GAP + c.text.length, 0)
  const rowB = (
    <Box key="git-b" width={width} paddingX={1} overflow="hidden">
      <Text color={isClean ? ROLE.muted : ROLE.green}>{`+${g.insertions}`}</Text>
      <Text color={isClean ? ROLE.muted : ROLE.red}>{` -${g.deletions}`}</Text>
      {counts.flatMap(c => [spaces(T, GAP), <Text color={c.color}>{c.text}</Text>])}
      {spaces(T, inner - leftWidth - rightText.length)}
      {pr ? hoverGroup(T, 'pr', r?.prTitle ?? pr, [<Text color={ROLE.teal}>{pr}</Text>]) : <Text />}
      {pr && issues ? spaces(T, GAP) : <Text />}
      {issues ? <Text color={ROLE.teal}>{issues}</Text> : <Text />}
    </Box>
  )
  return [rowA, rowB]
}

// --- Layout --------------------------------------------------------------------

function divider(T: Table, d: BandData): RenderElement {
  const { Text } = T
  return <Text color={frameColor(d)}>│</Text>
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// Wide: usage │ context │ git. The bar columns take what their content
// needs and git takes the rest, so no column carries empty space.
function wideRows(T: Table, R: RasterEl, d: BandData, inner: number, cols: [BarCell[], BarCell[]]): RenderElement[] | null {
  const { Box } = T
  const fits = cols.map(fitColumn) as [ColumnFit, ColumnFit]
  const fixed = fits.reduce((n, f) => n + columnNeed(f, 0), 0)
  const barLength = clamp(Math.floor((inner - 2 - GIT_MIN - fixed) / 2), 0, BAR_MAX)
  if (barLength < BAR_MIN) return null
  const widths = fits.map(f => columnNeed(f, barLength))
  const gitWidth = inner - 2 - widths.reduce((n, w) => n + w, 0)
  const [gitA, gitB] = gitRows(T, d, gitWidth)
  return [0, 1].map(i => (
    <Box key={`row-${i}`}>
      {barCell(T, R, cols[0][i] as BarCell, fits[0], barLength, widths[0] ?? 0, d)}
      {divider(T, d)}
      {barCell(T, R, cols[1][i] as BarCell, fits[1], barLength, widths[1] ?? 0, d)}
      {divider(T, d)}
      {i === 0 ? gitA : gitB}
    </Box>
  ))
}

// Medium: usage │ context over two rows, then git in two full-width rows.
function mediumRows(T: Table, R: RasterEl, d: BandData, inner: number, cols: [BarCell[], BarCell[]]): RenderElement[] {
  const { Box } = T
  const fits = cols.map(fitColumn) as [ColumnFit, ColumnFit]
  const half = Math.floor((inner - 1) / 2)
  const widths = [half, inner - 1 - half]
  const barLength = clamp(Math.min(...fits.map((f, j) => (widths[j] ?? 0) - columnNeed(f, 0))), 4, BAR_MAX)
  const [gitA, gitB] = gitRows(T, d, inner)
  const bars = [0, 1].map(i => (
    <Box key={`row-${i}`}>
      {barCell(T, R, cols[0][i] as BarCell, fits[0], barLength, widths[0] ?? 0, d)}
      {divider(T, d)}
      {barCell(T, R, cols[1][i] as BarCell, fits[1], barLength, widths[1] ?? 0, d)}
    </Box>
  ))
  return [...bars, gitA, gitB]
}

// The folded form under NARROW_COLUMNS: one line of the key figures.
function compactLine(T: Table, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const u = d.usage
  const g = d.git
  const bits: RenderElement[] = []
  const add = (el: RenderElement) => {
    if (bits.length > 0) bits.push(<Text color={RULE_COLOR}>{'  ◆  '}</Text>)
    bits.push(el)
  }
  if (u?.fiveHour) add(<Text color={fiveHourColor(u.fiveHour.percent)}>{`5h ${u.fiveHour.percent}%`}</Text>)
  if (u?.sevenDay) add(<Text color={sevenDayColor(u.sevenDay.percent)}>{`7d ${u.sevenDay.percent}%`}</Text>)
  if (u?.ctxPercent !== undefined) add(<Text color={ctxColor(u.ctxPercent, u.ctxTokens)}>{`ctx ${u.ctxPercent}%${isHandoffDue(u.ctxTokens) ? ' ⬢' : ''}`}</Text>)
  if (d.cacheView) add(<Text color={toneColor(d.cacheView.tone)}>{`${HOURGLASS} ${d.cacheView.label}`}</Text>)
  if (g) add(<Text color={ROLE.emeraldLt}>{`⎇ ${g.branch} +${g.insertions} -${g.deletions}`}</Text>)
  return bits.length === 0 ? null : <Box>{bits}</Box>
}

export function drawBand(T: Table, Raster: RasterEl, d: BandData): RenderElement {
  const { Box } = T
  const inner = Math.max(20, d.columns - RESERVE)
  if (d.columns < NARROW_COLUMNS) {
    const lines = [header(T, d, inner, true), compactLine(T, d)]
    return <Box flexDirection="column">{lines.filter((l): l is RenderElement => l !== null)}</Box>
  }
  const u = d.usage
  const cols: [BarCell[], BarCell[]] = [
    [windowCell(T, '5h', u?.fiveHour, fiveHourColor, d), windowCell(T, '7d', u?.sevenDay, sevenDayColor, d)],
    [contextCell(T, d), cacheCell(T, d)],
  ]
  const rows = (d.columns >= WIDE_COLUMNS ? wideRows(T, Raster, d, inner, cols) : null) ?? mediumRows(T, Raster, d, inner, cols)
  return <Box flexDirection="column">{[header(T, d, inner, false), ...rows]}</Box>
}
