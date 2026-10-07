// Draws the /lag pane: the verdict, the pressure bars, the swap line, one row
// per cause with its stop key, and the key line. Pure functions of the view.
// Every change goes through the handlers in `Act`, which register.tsx supplies.

import type { Elements, RenderElement } from 'claude-code'

import type { Cause, LagArmed, LagView, Level, Psi, Resource } from '../types'
import { BOUND_LABEL } from './pressure'
import type { Thresholds } from './pressure'
import { BAR_EMPTY, BAR_FULL, C, EDGE, HEX, HEX_HOLLOW, LEVEL_COLOR, LEVEL_FILL, RISE } from './theme'

type Table = Elements[keyof Elements]

export type Act = {
  press: (c: Cause) => void
  refresh: () => void
  close: () => void
}

export type Model = {
  view: LagView | null
  armed: LagArmed | null
  stopping: readonly string[]
  thresholds: Thresholds
  columns: number
  now: number
}

// A press on a stop key arms it for this long. A second press stops the cause.
export const CONFIRM_MS = 5000
const BAR = 16
const LABEL = 20
const KEY = 14

function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

function gib(kb: number): string {
  return (kb / (1024 * 1024)).toFixed(1)
}

// The level one resource alone would give.
function levelOf(r: Resource, p: Psi, t: Thresholds): Level {
  if (p.avg10 >= t[r]) return 'laggy'
  return p.avg10 >= t.busy ? 'busy' : 'calm'
}

function bar(T: Table, r: Resource, p: Psi, t: Thresholds): RenderElement {
  const { Box, Text } = T
  // The bar fills at the laggy threshold, so a full bar means laggy.
  const filled = Math.min(BAR, Math.round((p.avg10 / Math.max(1, t[r])) * BAR))
  const color = LEVEL_COLOR[levelOf(r, p, t)]
  return (
    <Box key={`bar-${r}`} marginRight={3}>
      <Text color={C.text2}>{`${r === 'memory' ? 'mem' : r} `.padEnd(5)}</Text>
      <Text color={color}>{BAR_FULL.repeat(filled)}</Text>
      <Text color={C.border}>{BAR_EMPTY.repeat(BAR - filled)}</Text>
      <Text color={color} bold>{`${p.avg10.toFixed(0)}%`.padStart(5)}</Text>
      <Text color={C.muted}>{` 1m ${p.avg60.toFixed(0)}%`}</Text>
    </Box>
  )
}

function header(T: Table, v: LagView, now: number): RenderElement {
  const { Box, Text } = T
  const fill = LEVEL_FILL[v.level]
  const words = v.level === 'calm' ? 'calm' : `${BOUND_LABEL[v.bound]} · ${v.level}`
  const age = Math.max(0, Math.round((now - v.at) / 1000))
  return (
    <Box key="verdict">
      <Text backgroundColor={fill} color={v.level === 'busy' ? C.abyss : C.text} bold>{` ${RISE} ${words} `}</Text>
      <Text color={fill}>{EDGE}</Text>
      <Text color={C.muted}>{`  sampled ${age} s ago`}</Text>
      {v.hasDocker ? <Text /> : <Text color={C.muted}>{'  · docker unavailable'}</Text>}
    </Box>
  )
}

function swapLine(T: Table, v: LagView): RenderElement {
  const { Box, Text } = T
  const s = v.swap
  const isZramFull = s.zramTotalKb > 0 && s.zramUsedKb / s.zramTotalKb >= 0.9
  const isSpilling = s.usedKb - s.zramUsedKb > 512 * 1024
  return (
    <Box key="swap">
      <Text color={C.text2}>{'swap '}</Text>
      <Text color={C.text} bold>{`${gib(s.usedKb)}/${gib(s.totalKb)}G`}</Text>
      {s.zramTotalKb > 0 ? <Text color={isZramFull ? C.blondeLt : C.text2}>{`   zram ${gib(s.zramUsedKb)}/${gib(s.zramTotalKb)}G`}</Text> : <Text />}
      {isZramFull && isSpilling ? <Text color={C.errorLt}>{'   ▸ full, pages spill to disk swap'}</Text> : <Text />}
    </Box>
  )
}

function keyLabel(c: Cause, armed: LagArmed | null, stopping: readonly string[], now: number): string {
  if (stopping.includes(c.key)) return '◐ stopping'
  if (armed?.key === c.key && now - armed.at < CONFIRM_MS) return 'confirm stop'
  return 'stop'
}

function causeRow(T: Table, m: Model, act: Act, c: Cause, i: number): RenderElement {
  const { Box, Text, Button } = T
  const isSystem = c.kind === 'system'
  const label = keyLabel(c, m.armed, m.stopping, m.now)
  const isArmed = label === 'confirm stop'
  const detailWidth = Math.max(10, m.columns - LABEL - KEY - 6)
  return (
    <Box key={`cause-${c.key}`}>
      <Text color={isSystem ? C.muted : c.kind === 'container' ? C.tealLt : C.emeraldLt}>{`${isSystem ? HEX_HOLLOW : HEX} `}</Text>
      <Text color={isSystem ? C.text2 : C.text} bold={!isSystem}>{truncate(c.label, LABEL - 1).padEnd(LABEL)}</Text>
      <Text color={C.text2}>{truncate(c.detail, detailWidth).padEnd(detailWidth)}</Text>
      <Text>{'  '}</Text>
      {isSystem
        ? <Text color={C.muted}>{'system'.padEnd(KEY)}</Text>
        : (
          <Box key={`stop-box-${c.key}`} width={KEY} backgroundColor={isArmed ? C.error : undefined}>
            <Button key={`stop-${c.key}`} label={label} hotkey={i < 9 ? String(i + 1) : undefined} plain onPress={() => act.press(c)} />
          </Box>
        )}
    </Box>
  )
}

export function lagPane(T: Table, m: Model, act: Act): RenderElement {
  const { Box, Text, Button } = T
  const v = m.view
  if (v === null) {
    return <Box key="lag" flexDirection="column"><Text color={C.muted}>Sampling the machine…</Text></Box>
  }
  const rule = <Text color={C.border}>{'─'.repeat(Math.max(10, m.columns - 2))}</Text>
  return (
    <Box key="lag" flexDirection="column">
      {header(T, v, m.now)}
      <Box key="bars" marginTop={1}>{(['io', 'memory', 'cpu'] as const).map(r => bar(T, r, v.pressure[r], m.thresholds))}</Box>
      {swapLine(T, v)}
      <Box key="rule-top" marginTop={1}>{rule}</Box>
      {v.causes.length === 0
        ? <Text key="none" color={C.muted}>No process or container stands out.</Text>
        : <Box key="causes" flexDirection="column">{v.causes.map((c, i) => causeRow(T, m, act, c, i))}</Box>}
      <Box key="rule-bottom">{rule}</Box>
      <Box key="keys">
        <Button key="lag-refresh" label="refresh" hotkey="r" plain onPress={act.refresh} />
        <Text>{'   '}</Text>
        <Button key="lag-close" label="close" hotkey="x" plain onPress={act.close} />
        <Text color={C.muted}>{'   a stop key asks once more before it stops'}</Text>
      </Box>
      {v.note === null ? <Text /> : <Text key="note" color={C.blondeLt}>{v.note}</Text>}
    </Box>
  )
}
