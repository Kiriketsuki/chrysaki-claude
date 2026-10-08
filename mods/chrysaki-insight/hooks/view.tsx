// Draws the insight pane: the tab strip in the tmux window-list look, one
// double-bordered panel, and the options bar. Pure functions of the model.
// Every change goes through the handlers in `Act`, which register.tsx supplies.

import type { RenderChildren, RenderSurface } from 'claude-code'

import type { InsightAgent, InsightContext, InsightTab, InsightTool, InsightTurn } from '../types'
import { activityBody, contextBody, turnsBody } from './panels'
import type { Ui } from './panels'
import { C, EDGE, GLYPH, HEX } from './theme'

export type Model = {
  tab: InsightTab
  context: InsightContext | null
  turns: InsightTurn[]
  tools: InsightTool[]
  agents: InsightAgent[]
  cost: number | null
  note: string | null
  surface: RenderSurface
  columns: number
  // Milliseconds since the epoch. The render hook reads the clock so that the
  // elapsed time of a running item is a pure input here.
  now: number
}

export type Act = {
  tab: (tab: InsightTab) => void
  refresh: () => void
  close: () => void
}

export const TABS: readonly { tab: InsightTab; key: string; label: string; glyph: string }[] = [
  { tab: 'context', key: '1', label: 'context', glyph: GLYPH.context },
  { tab: 'turns', key: '2', label: 'turns', glyph: GLYPH.turns },
  { tab: 'activity', key: '3', label: 'activity', glyph: GLYPH.activity },
]

export function isTab(word: string): word is InsightTab {
  return TABS.some(t => t.tab === word)
}

const hasEdges = (m: Pick<Model, 'surface'>): boolean => m.surface === 'terminal'

// One island on the Abyss ground, edged the way the tmux window list is.
function island(ui: Ui, m: Model, index: number, isLast: boolean, bg: string, body: RenderChildren) {
  const { Box, Text } = ui
  if (!hasEdges(m)) return <Box backgroundColor={bg} paddingX={1}>{body}</Box>
  const isEven = index % 2 === 0
  const left = isEven ? EDGE.back : EDGE.forward
  const right = isLast ? EDGE.end : isEven ? EDGE.forward : EDGE.back
  return (
    <Box>
      <Text color={C.abyss} backgroundColor={bg}>{left}</Text>
      <Box backgroundColor={bg}>{body}</Box>
      <Text color={bg} backgroundColor={C.abyss}>{right}</Text>
    </Box>
  )
}

function badge(ui: Ui, m: Model) {
  const { Box, Text } = ui
  return (
    <Box>
      <Text color={C.text} backgroundColor={C.emeraldLt} bold> {HEX} insight </Text>
      {hasEdges(m) ? <Text color={C.emeraldLt} backgroundColor={C.abyss}>{EDGE.forward}</Text> : null}
    </Box>
  )
}

function tabStrip(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  const isNarrow = m.columns < 50
  return (
    <Box backgroundColor={C.abyss}>
      {badge(ui, m)}
      {TABS.map((t, i) => {
        const isActive = t.tab === m.tab
        const bg = isActive ? C.raised : C.surface
        const label = isNarrow && !isActive ? `${t.glyph} ${t.key}` : `${t.glyph} ${t.label}`
        const button = (
          <Button key={`tab-${t.tab}`} label={label} hotkey={t.key} plain dimColor={!isActive} onPress={() => act.tab(t.tab)} />
        )
        return <Box key={`island-${t.tab}`}>{island(ui, m, i, i === TABS.length - 1, bg, button)}</Box>
      })}
    </Box>
  )
}

function panelTitle(m: Model): string {
  if (m.tab === 'turns') return `${GLYPH.turns} Requests · ${m.turns.length}`
  if (m.tab === 'activity') return `${GLYPH.activity} Activity · ${m.tools.length + m.agents.length}`
  return `${GLYPH.context} Context window`
}

function body(ui: Ui, m: Model) {
  if (m.tab === 'turns') return turnsBody(ui, m)
  if (m.tab === 'activity') return activityBody(ui, m)
  return contextBody(ui, m)
}

// The lazygit options bar: each key a plain Button, so the hotkey works and
// the key shows in the accent colour.
function optionsBar(ui: Ui, act: Act) {
  const { Box, Button } = ui
  const keys = [
    { key: 'r', label: `${GLYPH.context} refresh`, run: act.refresh },
    { key: 'q', label: 'close', run: act.close },
  ]
  return (
    <Box columnGap={2} paddingX={1}>
      {keys.map(k => <Button key={`opt-${k.key}`} label={k.label} hotkey={k.key} plain onPress={k.run} />)}
    </Box>
  )
}

export function drawPane(ui: Ui, m: Model, act: Act) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {tabStrip(ui, m, act)}
      <Box flexDirection="column" borderStyle="double" borderColor={C.emeraldLt} paddingX={1}>
        <Text color={C.emeraldLt} bold>{panelTitle(m)}</Text>
        {body(ui, m)}
      </Box>
      {m.note !== null ? <Box paddingX={1}><Text color={C.blondeLt} wrap="wrap">{m.note}</Text></Box> : null}
      {optionsBar(ui, act)}
    </Box>
  )
}
