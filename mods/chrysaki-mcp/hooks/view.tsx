// Draws the MCP panel: a header, one double-bordered panel with a row per
// server, and the options bar. Pure functions of the model. Every change goes
// through the handlers in `Act`, which register.tsx supplies.

import type { Elements } from 'claude-code'

import type { McpServer } from '../types'
import { stateOf } from './catalog'
import { C, HEX, OFF, ON } from './theme'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Model = {
  servers: McpServer[]
  pending: string[]
  note: string | null
}

export type Act = {
  flip: (server: McpServer) => void
  refresh: () => void
  close: () => void
}

// Servers past the ninth have no hotkey. A click still flips them.
const HOTKEY_SERVERS = 9

const STATE_COLOR = { on: C.emeraldLt, off: C.muted, waiting: C.blondeLt, pending: C.tealLt } as const

export function tokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

function header(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const on = m.servers.filter(server => !server.isDisabled && server.tools > 0)
  const total = on.reduce((sum, server) => sum + server.tokens, 0)
  return (
    <Box backgroundColor={C.abyss}>
      <Text color={C.text} backgroundColor={C.emeraldLt} bold> {HEX} mcp </Text>
      <Text color={C.text2}>  {on.length} on · {tokens(total)} tokens of tool schemas</Text>
    </Box>
  )
}

function serverRow(ui: Ui, server: McpServer, index: number, isPending: boolean, act: Act) {
  const { Box, Button, Text } = ui
  const state = stateOf(server, isPending)
  const hotkey = index < HOTKEY_SERVERS ? { hotkey: String(index + 1) } : {}
  const verb = server.isDisabled ? 'turn on' : 'turn off'
  return (
    <Box key={`row-${server.name}`} columnGap={2}>
      <Text color={STATE_COLOR[state]}>{state === 'off' ? OFF : ON} {state.padEnd(7)}</Text>
      <Box flexGrow={1}>
        <Text color={C.text} bold={!server.isDisabled}>{server.name}</Text>
        <Text color={C.muted}>  {server.source}</Text>
        {server.isOnDemand ? <Text color={C.blondeLt}>  on demand</Text> : null}
      </Box>
      <Text color={C.text2}>{server.tools > 0 ? `${server.tools} tools · ${tokens(server.tokens)}` : ''}</Text>
      <Button key={`srv-${server.name}`} label={verb} {...hotkey} plain dimColor={isPending} onPress={() => act.flip(server)} />
    </Box>
  )
}

function body(ui: Ui, m: Model, act: Act) {
  const { Box, Text } = ui
  if (m.servers.length === 0) return <Text color={C.muted}>No MCP server is configured or connected.</Text>
  return (
    <Box flexDirection="column">
      {m.servers.map((server, i) => serverRow(ui, server, i, m.pending.includes(server.name), act))}
    </Box>
  )
}

function optionsBar(ui: Ui, act: Act) {
  const { Box, Button } = ui
  return (
    <Box columnGap={2} paddingX={1}>
      <Button key="opt-r" label="refresh" hotkey="r" plain onPress={act.refresh} />
      <Button key="opt-q" label="close" hotkey="q" plain onPress={act.close} />
    </Box>
  )
}

export function drawPane(ui: Ui, m: Model, act: Act) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {header(ui, m)}
      <Box flexDirection="column" borderStyle="double" borderColor={C.emeraldLt} paddingX={1}>
        {body(ui, m, act)}
      </Box>
      {m.note !== null ? <Box paddingX={1}><Text color={C.blondeLt} wrap="wrap">{m.note}</Text></Box> : null}
      {optionsBar(ui, act)}
    </Box>
  )
}
