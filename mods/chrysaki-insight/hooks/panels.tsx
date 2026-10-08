// The three tab bodies. Pure functions of the model, like git-pane's view.

import type { Elements } from 'claude-code'

import type { InsightContext, InsightTurn } from '../types'
import { barCells, clock, duration, padEnd, padStart, percentOf, tokens, truncate, usd } from './format'
import { activityRows, cacheHit, contextBars, hasRunning } from './records'
import type { Model } from './view'
import { BAR_COLORS, BAR_EMPTY, BAR_FULL, C, CROSS, GLYPH, HEX, HEX_HOLLOW, TICK } from './theme'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

function empty(ui: Ui, glyph: string, text: string) {
  const { Text } = ui
  return <Text color={C.muted}>{glyph} {text}</Text>
}

// --- context ------------------------------------------------------------------

const LABEL_WIDTH = 22
const NUMBER_WIDTH = 7

export function contextBody(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const ctx = m.context
  if (ctx === null) return empty(ui, GLYPH.context, 'Reading the context window…')
  const bars = contextBars(ctx)
  // The bar takes what the label, two numbers and the gaps leave.
  const room = m.columns - 4 - LABEL_WIDTH - NUMBER_WIDTH * 2 - 4
  const width = Math.min(40, Math.max(8, room))
  let usedIndex = 0
  return (
    <Box flexDirection="column">
      {summaryLine(ui, ctx)}
      {bars.map(b => {
        const isUsed = b.kind === 'used'
        const color = isUsed ? BAR_COLORS[usedIndex++ % BAR_COLORS.length] ?? C.text2 : C.muted
        const cells = barCells(ctx.windowTokens > 0 ? b.tokens / ctx.windowTokens : 0, width)
        return (
          <Box key={`ctx-${b.kind}-${b.name}`} gap={1}>
            <Text color={isUsed ? C.text : C.muted}>{padEnd(b.name, LABEL_WIDTH)}</Text>
            <Text color={color}>{BAR_FULL.repeat(cells.filled)}</Text>
            <Text color={C.border}>{BAR_EMPTY.repeat(cells.empty)}</Text>
            <Text color={C.text2}>{padStart(tokens(b.tokens), NUMBER_WIDTH - 1)}</Text>
            <Text color={color}>{padStart(percentOf(b.tokens, ctx.windowTokens), NUMBER_WIDTH - 3)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function summaryLine(ui: Ui, ctx: InsightContext) {
  const { Box, Text } = ui
  return (
    <Box gap={1}>
      <Text color={C.emeraldLt} bold>{GLYPH.context} {tokens(ctx.totalTokens)}</Text>
      <Text color={C.muted}>of {tokens(ctx.windowTokens)}</Text>
      <Text color={ctx.percent >= 80 ? C.errorLt : ctx.percent >= 60 ? C.blonde : C.tealLt}>{Math.round(ctx.percent)}%</Text>
      <Text color={C.muted}>{truncate(ctx.model, 28)}</Text>
    </Box>
  )
}

// --- turns --------------------------------------------------------------------

const COLUMNS = { time: 8, num: 7, hit: 5 } as const

function hitColor(hit: number | null): string {
  if (hit === null) return C.muted
  return hit >= 80 ? C.emeraldLt : hit >= 40 ? C.blondeLt : C.errorLt
}

export function turnsBody(ui: Ui, m: Model) {
  const { Box, Text } = ui
  if (m.turns.length === 0) return empty(ui, GLYPH.turns, 'No model request yet. Rows appear after the next step.')
  const newest = [...m.turns].reverse()
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={C.muted}>{padEnd(`${GLYPH.clock} time`, COLUMNS.time)}</Text>
        <Text color={C.muted}>{padStart('in', COLUMNS.num)}</Text>
        <Text color={C.muted}>{padStart('out', COLUMNS.num)}</Text>
        <Text color={C.muted}>{padStart('read', COLUMNS.num)}</Text>
        <Text color={C.muted}>{padStart('write', COLUMNS.num)}</Text>
        <Text color={C.muted}>{padStart('hit', COLUMNS.hit)}</Text>
      </Box>
      {newest.map(t => turnRow(ui, t))}
      {totalsLine(ui, m)}
    </Box>
  )
}

function turnRow(ui: Ui, t: InsightTurn) {
  const { Box, Text } = ui
  const hit = cacheHit(t)
  return (
    <Box key={`turn-${t.id}`} gap={1}>
      <Text color={C.text2}>{padEnd(clock(t.at), COLUMNS.time)}</Text>
      <Text color={C.tealLt}>{padStart(tokens(t.input), COLUMNS.num)}</Text>
      <Text color={C.blondeLt}>{padStart(tokens(t.output), COLUMNS.num)}</Text>
      <Text color={C.emeraldLt}>{padStart(tokens(t.cacheRead), COLUMNS.num)}</Text>
      <Text color={C.teal}>{padStart(tokens(t.cacheWrite), COLUMNS.num)}</Text>
      <Text color={hitColor(hit)}>{padStart(hit === null ? '-' : `${hit}%`, COLUMNS.hit)}</Text>
    </Box>
  )
}

// The API reports no price per request, so cost shows once, as the session total.
function totalsLine(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const sum = (pick: (t: InsightTurn) => number): number => m.turns.reduce((n, t) => n + pick(t), 0)
  return (
    <Box gap={1} marginTop={1}>
      <Text color={C.text2}>{GLYPH.turns} {m.turns.length} requests</Text>
      <Text color={C.tealLt}>in {tokens(sum(t => t.input))}</Text>
      <Text color={C.blondeLt}>out {tokens(sum(t => t.output))}</Text>
      {m.cost !== null ? <Text color={C.blondeLt}>{GLYPH.cost} {usd(m.cost)} session</Text> : null}
    </Box>
  )
}

// --- activity -------------------------------------------------------------------

export function activityBody(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const rows = activityRows(m.tools, m.agents, m.now)
  if (rows.length === 0) return empty(ui, GLYPH.activity, 'No tool call yet.')
  // Two frames, one per second, so that a running item reads as alive.
  const spin = Math.floor(m.now / 1000) % 2 === 0 ? HEX : HEX_HOLLOW
  const detailRoom = Math.max(10, m.columns - 4 - 8 - 12 - 9 - 10)
  return (
    <Box flexDirection="column">
      {hasRunning(m.tools, m.agents) ? <Text color={C.blondeLt}>{spin} running items first</Text> : null}
      {rows.map(r => {
        const mark = r.isRunning ? spin : r.isFailed ? CROSS : TICK
        const markColor = r.isRunning ? C.blonde : r.isFailed ? C.errorLt : C.emeraldLt
        const glyph = r.kind === 'agent' ? GLYPH.agent : GLYPH.tool
        return (
          <Box key={r.key} gap={1}>
            <Text color={markColor}>{mark}</Text>
            <Text color={C.muted}>{clock(r.start)}</Text>
            <Text color={r.kind === 'agent' ? C.tealLt : C.emeraldLt} bold>{glyph} {padEnd(r.title, 10)}</Text>
            <Text color={C.text2}>{padStart(duration(r.elapsedMs), 7)}</Text>
            {r.tokens !== null ? <Text color={C.blondeLt}>{padStart(`${tokens(r.tokens)} tok`, 8)}</Text> : null}
            <Text color={r.isFailed ? C.errorLt : C.text2}>{truncate(r.detail, detailRoom)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
