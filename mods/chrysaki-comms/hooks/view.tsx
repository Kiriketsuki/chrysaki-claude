// Draws the comms pane: a strip of peers, one double-bordered panel with the
// full text of each message, and the options bar. Pure functions of the model.
// Every change goes through the handlers in `Act`, which register.tsx supplies.

import type { Elements } from 'claude-code'

import type { CommsMessage } from '../types'
import { peers, shown } from './log'
import { C, CROSS, HEX, IN, OUT } from './theme'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Model = {
  // Every message, oldest first, each address named.
  log: CommsMessage[]
  filter: string | null
  note: string | null
  limit: number
}

export type Act = {
  filter: (peer: string | null) => void
  refresh: () => void
  close: () => void
}

// Peers past the ninth have no hotkey. /comms <name> still shows them.
const HOTKEY_PEERS = 9

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function clock(at: number): string {
  const d = new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function peerStrip(ui: Ui, m: Model, act: Act) {
  const { Box, Button, Text } = ui
  const list = peers(m.log)
  const count = (peer: string | null) => (peer === null ? m.log.length : m.log.filter(x => x.peer === peer).length)
  const chip = (peer: string | null, key: string | undefined) => {
    const isActive = peer === m.filter
    const label = `${peer ?? 'all'} ${count(peer)}`
    return (
      <Box key={`chip-${peer ?? '*'}`} backgroundColor={isActive ? C.raised : C.surface} paddingX={1}>
        <Button key={`peer-${peer ?? '*'}`} label={label} {...(key === undefined ? {} : { hotkey: key })} plain dimColor={!isActive} onPress={() => act.filter(peer)} />
      </Box>
    )
  }
  return (
    <Box backgroundColor={C.abyss} flexWrap="wrap">
      <Text color={C.text} backgroundColor={C.emeraldLt} bold> {HEX} comms </Text>
      {chip(null, '0')}
      {list.map((peer, i) => chip(peer, i < HOTKEY_PEERS ? String(i + 1) : undefined))}
    </Box>
  )
}

function messageRow(ui: Ui, message: CommsMessage, index: number) {
  const { Box, Text } = ui
  const isOut = message.direction === 'out'
  return (
    <Box key={`msg-${index}`} flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={isOut ? C.tealLt : C.blondeLt} bold>{isOut ? OUT : IN} {message.peer}</Text>
        {message.at === null ? null : <Text color={C.muted}>  {clock(message.at)}</Text>}
        {message.failure === null ? null : <Text color={C.errorLt}>  {CROSS} {message.failure}</Text>}
      </Text>
      <Box paddingLeft={2}>
        <Text color={C.text} wrap="wrap">{message.text}</Text>
      </Box>
    </Box>
  )
}

function body(ui: Ui, m: Model) {
  const { Box, Text } = ui
  const { messages, hidden } = shown(m.log, m.filter, m.limit)
  if (messages.length === 0) {
    const who = m.filter === null ? 'another session' : m.filter
    return <Text color={C.muted}>No message to or from {who} yet.</Text>
  }
  return (
    <Box flexDirection="column">
      {hidden > 0 ? <Text color={C.muted}>{hidden} earlier messages are not shown.</Text> : null}
      {messages.map((message, i) => messageRow(ui, message, hidden + i))}
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
      {peerStrip(ui, m, act)}
      <Box flexDirection="column" borderStyle="double" borderColor={C.emeraldLt} paddingX={1}>
        {body(ui, m)}
      </Box>
      {m.note !== null ? <Box paddingX={1}><Text color={C.blondeLt} wrap="wrap">{m.note}</Text></Box> : null}
      {optionsBar(ui, act)}
    </Box>
  )
}
