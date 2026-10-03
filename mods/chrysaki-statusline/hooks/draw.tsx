// Builds the band's tree from the collected values. No I/O happens here.

import type { ElementConstructor, Elements, RasterProps, RenderElement } from 'claude-code'

import type { StatuslineGit, StatuslineIdentity, StatuslineRemote, StatuslineUsage } from '../types'
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

function bar(T: Table, Raster: ElementConstructor<RasterProps> | undefined, key: string, pct: number, color: string, d: BandData): RenderElement {
  const cells = barCells(pct, d.barStyle, d.phase % 4)
  if (Raster !== undefined) return <Raster key={key} columns={8} rows={1} cells={barRaster(cells, color, ROLE.hexEmpty)} />
  const { Text } = T
  const on = cells.filter(c => c.isFilled).map(c => c.glyph).join('')
  const off = cells.filter(c => !c.isFilled).map(c => c.glyph).join('')
  return <Text><Text color={color}>{on}</Text><Text color={ROLE.hexEmpty}>{off}</Text></Text>
}

function sep(T: Table): RenderElement {
  const { Text } = T
  return <Text color={CORE.border}>{SEP}</Text>
}

// Line 1: the brand bar. Model badge, version and CWD as zigzag segments,
// then the flowing tri-primary bridge, then the account email.
function brandLine(T: Table, Raster: ElementConstructor<RasterProps> | undefined, d: BandData): RenderElement {
  const { Box, Text } = T
  const id = d.identity
  const badge = d.phase % 2 === 0 ? '⬢' : '⬡'
  const segs: Seg[] = [
    { text: `${badge} ${modelLabel(id?.model ?? '')}`, bg: CORE.emerald, fg: ROLE.text, bold: true },
    ...(d.columns >= NARROW_COLUMNS && id?.version ? [{ text: `v${id.version}`, bg: CORE.blueLight, fg: ROLE.text }] : []),
    { text: smartCwd(id?.cwd ?? '', d.home), bg: CORE.amethystLight, fg: ROLE.text, bold: true },
  ]
  const email = d.columns >= NARROW_COLUMNS ? id?.email ?? '' : ''
  const room = d.columns - zigzagWidth(segs) - email.length - 3
  const fill = Raster !== undefined && room >= 4
    ? <Raster key="bridge" columns={room} rows={1} cells={bridgeCells(room, BRAND_STOPS, d.phase)} />
    : room >= 4 ? <Text color={JEWELS_DIM[d.phase % JEWELS_DIM.length]}>{'━'.repeat(room)}</Text> : null
  return (
    <Box>
      {hoverGroup(T, 'brand', `${id?.model ?? 'model unknown'} · Claude Code ${id?.version ?? '?'} · ${id?.cwd ?? ''}`, zigzag(T, segs))}
      {fill === null ? <Text> </Text> : <Box marginLeft={1}>{fill}</Box>}
      {email.length > 0 ? <Text color={id?.isWorkAccount ? ROLE.orange : ROLE.emeraldLt}>{` ${email}`}</Text> : <Text />}
    </Box>
  )
}

function windowGroup(T: Table, R: ElementConstructor<RasterProps> | undefined, label: string, w: { percent: number; resetsAt?: number }, color: string, showReset: boolean, d: BandData): RenderElement {
  const { Text } = T
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  return hoverGroup(T, `win-${label}`, `${label} window · ${w.percent}% used · ${when}`, [
    <Text color={color}>{`${marker(w.percent, 50, 75)} ${label}  `}</Text>,
    bar(T, R, `bar-${label}`, w.percent, color, d),
    <Text color={color}>{` ${String(w.percent).padStart(3)}%`}</Text>,
    showReset && reset !== '' ? <Text color={ROLE.muted}>{` (${reset})`}</Text> : <Text />,
  ])
}

// Line 2: 5h and 7d rate-limit windows, cost and the session clock.
function usageLine(T: Table, R: ElementConstructor<RasterProps> | undefined, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const u = d.usage
  if (u === null) return null
  const showReset = (u.ctxPercent ?? 0) < 60
  const parts: RenderElement[] = []
  if (u.fiveHour !== undefined) parts.push(windowGroup(T, R, '5h', u.fiveHour, fiveHourColor(u.fiveHour.percent), showReset, d))
  if (u.sevenDay !== undefined) {
    if (parts.length > 0) parts.push(sep(T))
    parts.push(windowGroup(T, R, '7d', u.sevenDay, sevenDayColor(u.sevenDay.percent), showReset, d))
  }
  if (u.costUsd !== undefined) {
    if (parts.length > 0) parts.push(sep(T))
    parts.push(hoverGroup(T, 'cost', `US$${u.costUsd.toFixed(2)} this session`, [<Text color={ROLE.sec}>{`$${costSgd(u.costUsd, d.usdToSgd)}`}</Text>]))
  }
  if (u.startedAt !== undefined) {
    parts.push(sep(T))
    parts.push(<Text color={ROLE.muted}>{sessionClock(d.now - u.startedAt)}</Text>)
  }
  return parts.length === 0 ? null : <Box>{parts}</Box>
}

// Line 3: context fill, the handoff marker and the vault inbox.
function contextLine(T: Table, R: ElementConstructor<RasterProps> | undefined, d: BandData): RenderElement | null {
  const { Box, Text, Button } = T
  const u = d.usage
  if (u === null || u.ctxPercent === undefined) return null
  const pct = u.ctxPercent
  const color = ctxColor(pct, u.ctxTokens)
  const tokens = u.ctxTokens === undefined ? '' : ` (${kilo(u.ctxTokens)}/${kilo(u.ctxWindow)})`
  const due = isHandoffDue(u.ctxTokens)
  return (
    <Box>
      {hoverGroup(T, 'ctx', `context ${pct}% · ${u.ctxTokens ?? '?'} of ${u.ctxWindow} tokens · handoff at 100k · press ctx for the breakdown`, [
        <Text color={color}>{`${ctxMarker(pct, u.ctxTokens)} `}</Text>,
        <Button key="ctx-detail" label="ctx" plain onPress={d.onContext} />,
        <Text>{' '}</Text>,
        bar(T, R, 'bar-ctx', pct, color, d),
        <Text color={color}>{` ${String(pct).padStart(3)}%`}</Text>,
        <Text color={ROLE.muted}>{tokens}</Text>,
      ])}
      {sep(T)}
      {due
        ? <Text color={ROLE.warn} bold={d.phase % 2 === 0}>{'⬢ → handoff'}</Text>
        : <Text color={ROLE.emeraldLt}>{'◇ no handoff'}</Text>}
      {d.inbox > 0 ? <Text color={ROLE.emeraldLt}>{`${SEP}◇ ${d.inbox}`}</Text> : <Text />}
    </Box>
  )
}

// Line 4: branch, ahead count, hash, line changes, file counts, worktree, PR and issues.
function gitLine(T: Table, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const g = d.git
  if (g === null) return null
  const jewel = JEWELS[d.phase % JEWELS.length] ?? ROLE.emeraldLt
  const r = d.remote
  const pr = r?.prNumber == null ? '' : `PR #${r.prNumber}${r.prTitle ? ': ' + (r.prTitle.length > 15 ? r.prTitle.slice(0, 15) + '…' : r.prTitle) : ''}`
  return (
    <Box>
      {hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} at ${g.hash} · ${g.ahead} unpushed`, [
        <Text color={jewel} bold>{`⎇ ${g.branch}`}</Text>,
        g.ahead > 0 ? <Text color={ROLE.blondeLt}>{`  ↑${g.ahead}`}</Text> : <Text />,
      ])}
      {sep(T)}
      <Text color={ROLE.muted}>{`⊙ ${g.hash}`}</Text>
      {sep(T)}
      <Text color={g.insertions + g.deletions === 0 ? ROLE.muted : ROLE.green}>{`+${g.insertions}`}</Text>
      <Text color={g.insertions + g.deletions === 0 ? ROLE.muted : ROLE.red}>{` -${g.deletions}`}</Text>
      {sep(T)}
      {g.staged > 0 ? <Text color={ROLE.green}>{`${g.staged} staged `}</Text> : <Text />}
      <Text color={ROLE.orange}>{`${g.unstaged} unstaged`}</Text>
      {g.worktree ? <Text color={ROLE.sec}>{`${SEP}worktree:${g.worktree}`}</Text> : <Text />}
      {pr ? <Text color={ROLE.teal}>{`${SEP}${pr}`}</Text> : <Text />}
      {r?.issues ? <Text color={ROLE.teal}>{`${SEP}◈ ${r.issues} issues`}</Text> : <Text />}
    </Box>
  )
}

// The folded form under NARROW_COLUMNS: brand, then one line of the key figures.
function compactLine(T: Table, d: BandData): RenderElement | null {
  const { Box, Text } = T
  const u = d.usage
  const g = d.git
  const bits: RenderElement[] = []
  const add = (el: RenderElement) => { if (bits.length > 0) bits.push(sep(T)); bits.push(el) }
  if (u?.fiveHour) add(<Text color={fiveHourColor(u.fiveHour.percent)}>{`5h ${u.fiveHour.percent}%`}</Text>)
  if (u?.sevenDay) add(<Text color={sevenDayColor(u.sevenDay.percent)}>{`7d ${u.sevenDay.percent}%`}</Text>)
  if (u?.ctxPercent !== undefined) add(<Text color={ctxColor(u.ctxPercent, u.ctxTokens)}>{`ctx ${u.ctxPercent}%${isHandoffDue(u.ctxTokens) ? ' ⬢' : ''}`}</Text>)
  if (g) add(<Text color={ROLE.emeraldLt}>{`⎇ ${g.branch} +${g.insertions} -${g.deletions}`}</Text>)
  return bits.length === 0 ? null : <Box>{bits}</Box>
}

export function drawBand(T: Table, Raster: ElementConstructor<RasterProps> | undefined, d: BandData): RenderElement {
  const { Box } = T
  const lines = d.columns < NARROW_COLUMNS
    ? [brandLine(T, Raster, d), compactLine(T, d)]
    : [brandLine(T, Raster, d), usageLine(T, Raster, d), contextLine(T, Raster, d), gitLine(T, d)]
  return <Box flexDirection="column">{lines.filter((l): l is RenderElement => l !== null)}</Box>
}
