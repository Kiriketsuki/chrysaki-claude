// Builds the band's tree from the collected values. No I/O happens here.

import type { ElementConstructor, Elements, RasterProps, RenderElement } from 'claude-code'

import type { CacheView, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineRemote, StatuslineUsage } from '../types'
import { cacheCard, toneColor } from './cache'
import {
  barCells, ctxColor, ctxMarker, fiveHourColor, isHandoffDue, kilo, marker, modelLabel, rightEdge,
  sessionClock, costSgd, sevenDayColor, smartCwd, untilReset,
} from './format'
import type { BarStyle } from './format'
import { CORE, JEWELS, JEWELS_DIM, ROLE } from './palette'
import { barRaster, bridgeCells } from './raster'

export type Table = Elements[keyof Elements]

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
}

const HOURGLASS = '\u29d7'

// The prompt cache segment: hourglass and time left, or "cold".
function cacheSegment(T: Table, d: BandData): RenderElement | null {
  const { Text } = T
  if (d.cache === null || d.cacheView === null) return null
  const color = toneColor(d.cacheView.tone)
  return hoverGroup(T, 'cache', cacheCard(d.cache, d.cacheView), [
    <Text color={color}>{`${HOURGLASS} ${d.cacheView.label}`}</Text>,
  ])
}

// Below this width the band folds its four lines into two.
export const NARROW_COLUMNS = 100
const SEP = '  ◆  '
const BRAND_STOPS = [CORE.emeraldLight, CORE.blueLight, CORE.amethystLight]

type Seg = { text: string; bg: string; fg: string; bold?: boolean }

// One zigzag-alt run: each segment, then the glyph that joins it to the next,
// drawn in this segment's colour on the next segment's background.
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

export function zigzagWidth(segs: readonly Seg[]): number {
  return segs.reduce((n, s) => n + s.text.length + 3, 0)
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

function bar(T: Table, Raster: ElementConstructor<RasterProps> | undefined, key: string, pct: number, color: string, d: BandData, length = 8): RenderElement {
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  if (Raster !== undefined) return <Raster key={key} columns={length} rows={1} cells={barRaster(cells, color, ROLE.hexEmpty)} />
  const { Text } = T
  const on = cells.filter(c => c.isFilled).map(c => c.glyph).join('')
  const off = cells.filter(c => !c.isFilled).map(c => c.glyph).join('')
  return <Text><Text color={color}>{on}</Text><Text color={ROLE.hexEmpty}>{off}</Text></Text>
}

function sep(T: Table): RenderElement {
  const { Text } = T
  return <Text color={CORE.border}>{SEP}</Text>
}

// --- Layout ------------------------------------------------------------------
//
// The band is a chamfered frame that sits on the prompt. The header is a thin
// rule with cut corners (╱ ╲) that carries the brand segments. Below it, a
// grid of cells spans the full width between │ edges. The prompt's own ─ rule
// closes the frame from below, so the band and the prompt read as one block.

// The engine draws its collapse mark `[-]` over the last cells of the band's
// first row. The frame stops short of it.
const RESERVE = 4
// At this width and above, the grid has three columns. Below it, two.
export const WIDE_COLUMNS = 150
const RULE = '─'

// What fills a cell between its left and right groups: a bar stretched to
// the free width, or a dotted leader, as a table of contents aligns a page
// number. Widths are in terminal cells.
type Fill = { kind: 'bar'; key: string; pct: number; color: string } | { kind: 'leader' }

type Cell = {
  key: string
  left: RenderElement[]
  leftWidth: number
  right: RenderElement[]
  rightWidth: number
  fill: Fill
}

const MIN_FILL = 3

function frameColor(d: BandData): string {
  // The frame warms to Blonde inside the cache warning lead, so the alert
  // also shows in the shape of the band.
  return d.cacheView?.tone === 'warning' ? ROLE.warn : CORE.border
}

function fillElement(T: Table, R: ElementConstructor<RasterProps> | undefined, f: Fill, length: number, d: BandData): RenderElement {
  const { Text } = T
  if (f.kind === 'bar') return bar(T, R, f.key, f.pct, f.color, d, length)
  return <Text color={CORE.border}>{'┄'.repeat(length)}</Text>
}

// One grid cell: the left group, the fill, then the right group flush right.
function cell(T: Table, R: ElementConstructor<RasterProps> | undefined, c: Cell, width: number, d: BandData): RenderElement {
  const { Box } = T
  const free = width - 2 - c.leftWidth - c.rightWidth - 2
  return (
    <Box key={`cell-${c.key}`} width={width} paddingX={1} justifyContent="space-between" overflow="hidden">
      <Box flexShrink={1} overflow="hidden">{c.left}</Box>
      {free >= MIN_FILL ? <Box marginX={1}>{fillElement(T, R, c.fill, free, d)}</Box> : null}
      <Box flexShrink={0}>{c.right}</Box>
    </Box>
  )
}

// One grid row: cells of equal width between │ edges. The last cell takes the
// columns left over from the division.
function row(T: Table, R: ElementConstructor<RasterProps> | undefined, key: string, cells: readonly Cell[], inner: number, d: BandData): RenderElement {
  const { Box, Text } = T
  const edge = frameColor(d)
  const room = inner - 2 - (cells.length - 1)
  const base = Math.floor(room / cells.length)
  const parts: RenderElement[] = [<Text color={edge}>│</Text>]
  cells.forEach((c, i) => {
    const width = i === cells.length - 1 ? room - base * (cells.length - 1) : base
    parts.push(cell(T, R, c, width, d))
    parts.push(<Text color={edge}>│</Text>)
  })
  return <Box key={`row-${key}`}>{parts}</Box>
}

function muted(T: Table, text: string): RenderElement {
  const { Text } = T
  return <Text color={ROLE.muted}>{text}</Text>
}

// The header: ╱─ brand segments ─── gradient rule ─── cost · clock · email ─╲
function header(T: Table, Raster: ElementConstructor<RasterProps> | undefined, d: BandData, inner: number): RenderElement {
  const { Box, Text } = T
  const id = d.identity
  const u = d.usage
  const edge = frameColor(d)
  const badge = d.phase % 2 === 0 ? '⬢' : '⬡'
  const segs: Seg[] = [
    { text: `${badge} ${modelLabel(id?.model ?? '')}`, bg: CORE.emerald, fg: ROLE.text, bold: true },
    ...(id?.version ? [{ text: `v${id.version}`, bg: CORE.blueLight, fg: ROLE.text }] : []),
    { text: smartCwd(id?.cwd ?? '', d.home), bg: CORE.amethystLight, fg: ROLE.text, bold: true },
  ]
  const cost = u?.costUsd === undefined ? '' : `$${costSgd(u.costUsd, d.usdToSgd)}`
  const clock = u?.startedAt === undefined ? '' : sessionClock(d.now - u.startedAt)
  const email = id?.email ?? ''
  const inbox = d.inbox > 0 ? `◇ inbox ${d.inbox}` : ''
  const tail = [inbox, cost, clock].filter(s => s.length > 0).join('  ◆  ')
  const tailWidth = (tail.length > 0 ? tail.length + 2 : 0) + (email.length > 0 ? email.length + 2 : 0)
  // Corner, rule, segments, rule fill, tail, rule, corner.
  const room = inner - 2 - 2 - zigzagWidth(segs) - 1 - tailWidth - 1
  const fill = room < 1
    ? null
    : Raster !== undefined
      ? <Raster key="bridge" columns={room} rows={1} cells={bridgeCells(room, BRAND_STOPS, d.phase, 0x2500)} />
      : <Text color={JEWELS_DIM[d.phase % JEWELS_DIM.length]}>{RULE.repeat(room)}</Text>
  return (
    <Box key="header">
      <Text color={edge}>{`╱${RULE}`}</Text>
      {hoverGroup(T, 'brand', `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`, zigzag(T, segs))}
      <Text color={edge}>{RULE}</Text>
      {fill ?? <Text />}
      {tail.length > 0 ? hoverGroup(T, 'cost', u?.costUsd === undefined ? 'session' : `US$${u.costUsd.toFixed(2)} this session`, [<Text color={ROLE.sec}>{` ${tail} `}</Text>]) : <Text />}
      {email.length > 0 ? <Text color={id?.isWorkAccount ? ROLE.orange : ROLE.emeraldLt}>{` ${email} `}</Text> : <Text />}
      <Text color={edge}>{`${RULE}╲`}</Text>
    </Box>
  )
}

function windowCell(T: Table, label: string, w: { percent: number; resetsAt?: number }, color: string, d: BandData): Cell {
  const { Text } = T
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  const head = `${marker(w.percent, 50, 75)} ${label.padEnd(3)}`
  const pct = `${String(w.percent).padStart(3)}%`
  const tail = reset === '' ? '' : `   ↻ ${reset.padStart(6)}`
  return {
    key: label,
    left: [hoverGroup(T, `win-${label}`, `${label} window · ${w.percent}% used · ${when}`, [<Text color={color}>{head}</Text>])],
    leftWidth: head.length,
    right: [<Text color={color}>{pct}</Text>, ...(tail ? [muted(T, tail)] : [])],
    rightWidth: pct.length + tail.length,
    fill: { kind: 'bar', key: `bar-${label}`, pct: w.percent, color },
  }
}

function emptyCell(T: Table, key: string, label: string): Cell {
  return { key, left: [muted(T, label)], leftWidth: label.length, right: [], rightWidth: 0, fill: { kind: 'leader' } }
}

function usageCells(T: Table, d: BandData): [Cell, Cell] {
  const u = d.usage
  const five = u?.fiveHour === undefined ? emptyCell(T, '5h', '▰ 5h') : windowCell(T, '5h', u.fiveHour, fiveHourColor(u.fiveHour.percent), d)
  const seven = u?.sevenDay === undefined ? emptyCell(T, '7d', '▰ 7d') : windowCell(T, '7d', u.sevenDay, sevenDayColor(u.sevenDay.percent), d)
  return [five, seven]
}

function contextCell(T: Table, d: BandData): Cell {
  const { Text, Button } = T
  const u = d.usage
  if (u?.ctxPercent === undefined) return emptyCell(T, 'ctx', '▰ ctx')
  const pct = u.ctxPercent
  const color = ctxColor(pct, u.ctxTokens)
  const mark = `${ctxMarker(pct, u.ctxTokens)} `
  const figure = `${String(pct).padStart(3)}%`
  const tokens = u.ctxTokens === undefined ? '' : `   ${kilo(u.ctxTokens)} / ${kilo(u.ctxWindow)}`
  const due = isHandoffDue(u.ctxTokens)
  const handoff = due ? '   ⬢ handoff' : ''
  return {
    key: 'ctx',
    left: [hoverGroup(T, 'ctx', `context ${pct}% · ${u.ctxTokens ?? '?'} of ${u.ctxWindow} tokens · handoff at 100k · press ctx for the breakdown`, [
      <Text color={color}>{mark}</Text>,
      <Button key="ctx-detail" label="ctx" plain onPress={d.onContext} />,
    ])],
    leftWidth: mark.length + 3,
    right: [
      <Text color={color}>{figure}</Text>,
      muted(T, tokens),
      due ? <Text color={ROLE.warn} bold={d.phase % 2 === 0}>{handoff}</Text> : <Text />,
    ],
    rightWidth: figure.length + tokens.length + handoff.length,
    fill: { kind: 'bar', key: 'bar-ctx', pct, color },
  }
}

// The cache cell drains as the cache cools: its bar shows the share of the
// TTL that is left.
function cacheCell(T: Table, d: BandData): Cell {
  const { Text } = T
  const head = `${HOURGLASS} cache`
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) return { ...emptyCell(T, 'cache', head), right: [muted(T, '…')], rightWidth: 1 }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  const label = `${v.label} / ${c.ttl}`
  return {
    key: 'cache',
    left: [hoverGroup(T, 'cache', cacheCard(c, v), [<Text color={color}>{head}</Text>])],
    leftWidth: head.length,
    right: [<Text color={color}>{label}</Text>],
    rightWidth: label.length,
    fill: { kind: 'bar', key: 'bar-cache', pct, color },
  }
}

function gitCells(T: Table, d: BandData): [Cell, Cell] {
  const { Text, Button } = T
  const g = d.git
  if (g === null) return [emptyCell(T, 'git', '⎇ no git repository'), emptyCell(T, 'changes', '')]
  const jewel = JEWELS[d.phase % JEWELS.length] ?? ROLE.emeraldLt
  const r = d.remote
  const key = d.hasGitCommand ? 'g: git ' : ''
  const name = `⎇ ${g.branch}`
  const ahead = g.ahead > 0 ? `  ↑${g.ahead}` : ''
  const tree = g.worktree ? `  worktree:${g.worktree}` : ''
  const hash = `⊙ ${g.hash}`
  const branch: Cell = {
    key: 'git',
    left: [
      ...(d.hasGitCommand ? [<Button key="git-pane" label="git" hotkey="g" plain onPress={d.onGit} />, <Text>{' '}</Text>] : []),
      hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} at ${g.hash} · ${g.ahead} unpushed`, [
        <Text color={jewel} bold>{name}</Text>,
        ahead ? <Text color={ROLE.blondeLt}>{ahead}</Text> : <Text />,
      ]),
      tree ? <Text color={ROLE.sec}>{tree}</Text> : <Text />,
    ],
    leftWidth: key.length + name.length + ahead.length + tree.length,
    right: [muted(T, hash)],
    rightWidth: hash.length,
    fill: { kind: 'leader' },
  }
  const isClean = g.insertions + g.deletions === 0
  const plus = `+${g.insertions}`
  const minus = ` -${g.deletions}`
  const staged = g.staged > 0 ? `  ${g.staged} staged` : ''
  const unstaged = `  ${g.unstaged} unstaged`
  const pr = r?.prNumber == null ? '' : `PR #${r.prNumber}`
  const issues = r?.issues ? `◈ ${r.issues}` : ''
  const joiner = pr && issues ? '  ◆  ' : ''
  const changes: Cell = {
    key: 'changes',
    left: [
      <Text color={isClean ? ROLE.muted : ROLE.green}>{plus}</Text>,
      <Text color={isClean ? ROLE.muted : ROLE.red}>{minus}</Text>,
      staged ? <Text color={ROLE.green}>{staged}</Text> : <Text />,
      <Text color={g.unstaged > 0 ? ROLE.orange : ROLE.muted}>{unstaged}</Text>,
    ],
    leftWidth: plus.length + minus.length + staged.length + unstaged.length,
    right: [
      pr ? hoverGroup(T, 'pr', r?.prTitle ?? pr, [<Text color={ROLE.teal}>{pr}</Text>]) : <Text />,
      joiner ? <Text color={CORE.border}>{joiner}</Text> : <Text />,
      issues ? <Text color={ROLE.teal}>{issues}</Text> : <Text />,
    ],
    rightWidth: pr.length + joiner.length + issues.length,
    fill: { kind: 'leader' },
  }
  return [branch, changes]
}

// The folded form under NARROW_COLUMNS: one line of the key figures.
function compactLine(T: Table, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const u = d.usage
  const g = d.git
  const bits: RenderElement[] = []
  const add = (el: RenderElement) => { if (bits.length > 0) bits.push(sep(T)); bits.push(el) }
  if (u?.fiveHour) add(<Text color={fiveHourColor(u.fiveHour.percent)}>{`5h ${u.fiveHour.percent}%`}</Text>)
  if (u?.sevenDay) add(<Text color={sevenDayColor(u.sevenDay.percent)}>{`7d ${u.sevenDay.percent}%`}</Text>)
  if (u?.ctxPercent !== undefined) add(<Text color={ctxColor(u.ctxPercent, u.ctxTokens)}>{`ctx ${u.ctxPercent}%${isHandoffDue(u.ctxTokens) ? ' ⬢' : ''}`}</Text>)
  if (d.cacheView) add(<Text color={toneColor(d.cacheView.tone)}>{`${HOURGLASS} ${d.cacheView.label}`}</Text>)
  if (g) add(<Text color={ROLE.emeraldLt}>{`⎇ ${g.branch} +${g.insertions} -${g.deletions}`}</Text>)
  return bits.length === 0 ? null : <Box>{bits}</Box>
}

export function drawBand(T: Table, Raster: ElementConstructor<RasterProps> | undefined, d: BandData): RenderElement {
  const { Box } = T
  const inner = Math.max(20, d.columns - RESERVE)
  if (d.columns < NARROW_COLUMNS) {
    const lines = [header(T, Raster, { ...d, identity: d.identity === null ? null : { ...d.identity, email: '' } }, inner), compactLine(T, d)]
    return <Box flexDirection="column">{lines.filter((l): l is RenderElement => l !== null)}</Box>
  }
  const [five, seven] = usageCells(T, d)
  const ctx = contextCell(T, d)
  const cache = cacheCell(T, d)
  const [branch, changes] = gitCells(T, d)
  const rows = d.columns >= WIDE_COLUMNS
    ? [row(T, Raster, 'a', [five, ctx, branch], inner, d), row(T, Raster, 'b', [seven, cache, changes], inner, d)]
    : [row(T, Raster, 'a', [five, ctx], inner, d), row(T, Raster, 'b', [seven, cache], inner, d), row(T, Raster, 'c', [branch, changes], inner, d)]
  return <Box flexDirection="column">{[header(T, Raster, d, inner), ...rows]}</Box>
}
