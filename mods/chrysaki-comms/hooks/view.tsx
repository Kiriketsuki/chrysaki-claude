// Draws the comms pane: a header, a strip of peers, one double-bordered panel
// with the log, and the options bar. Pure functions of the model. Every change
// goes through the handlers in `Act`, which register.tsx supplies.

import type { Elements } from 'claude-code'

import type { CommsMessage, CommsView } from '../types'
import { layout } from './layout'
import type { Item } from './layout'
import { peers, shown } from './log'
import { compactLine } from './summary'
import { C, CROSS, DOT, DOWN, HEX, IN, OUT, RULE, SPARK } from './theme'

export type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type Model = {
  // Every message, oldest first, each address named.
  log: CommsMessage[]
  filter: string | null
  // What the pane says about a failed read or a failed summary call.
  notes: string[]
  limit: number
  view: CommsView
  follow: boolean
  summaries: Record<string, string>
  isSummarizing: boolean
}

export type Act = {
  filter: (peer: string | null) => void
  toggleView: () => void
  toggleFollow: () => void
  refresh: () => void
  close: () => void
}

// Peers past the ninth have no hotkey. /comms <name> still shows them.
const HOTKEY_PEERS = 9
// The compact view cuts a peer name to this width.
const PEER_COLUMN = 14
// The verbose view sets a sent message in by this many columns.
const OUT_INDENT = 4

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function clock(at: number): string {
  const d = new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const sideColor = (m: CommsMessage): string => (m.direction === 'out' ? C.tealLt : C.blondeLt)
const arrow = (m: CommsMessage): string => (m.direction === 'out' ? OUT : IN)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function header(ui: Ui, m: Model) {
  const { Box, Text } = ui
  return (
    <Box justifyContent="space-between" backgroundColor={C.abyss}>
      <Text>
        <Text color={C.text} backgroundColor={C.emeraldLt} bold> {HEX} comms </Text>
        <Text color={C.text2}>  {plural(m.log.length, 'message')} {DOT} {plural(peers(m.log).length, 'peer')}</Text>
      </Text>
      <Text>
        {m.isSummarizing ? <Text color={C.blondeLt}>{SPARK} summarizing  </Text> : null}
        <Text color={C.text2}>{m.view}</Text>
        <Text color={C.muted}> {DOT} </Text>
        <Text color={m.follow ? C.tealLt : C.muted}>{m.follow ? `${DOWN} follow` : 'paused'} </Text>
      </Text>
    </Box>
  )
}

function peerStrip(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  const list = peers(m.log)
  const count = (peer: string | null) => (peer === null ? m.log.length : m.log.filter(x => x.peer === peer).length)
  const chip = (peer: string | null, key: string | undefined) => {
    const isActive = peer === m.filter
    return (
      <Box key={`chip-${peer ?? '*'}`} backgroundColor={isActive ? C.raised : C.surface} paddingX={1}>
        <Button key={`peer-${peer ?? '*'}`} label={`${peer ?? 'all'} ${count(peer)}`} {...(key === undefined ? {} : { hotkey: key })} plain dimColor={!isActive} onPress={() => act.filter(peer)} />
      </Box>
    )
  }
  return (
    <Box flexWrap="wrap" columnGap={1}>
      {chip(null, '0')}
      {list.map((peer, i) => chip(peer, i < HOTKEY_PEERS ? String(i + 1) : undefined))}
    </Box>
  )
}

function dayLine(ui: Ui, label: string, key: string) {
  const { Text } = ui
  return <Text key={key} color={C.muted}>{RULE.repeat(2)} {label} {RULE.repeat(2)}</Text>
}

function compactRow(ui: Ui, m: Model, item: Extract<Item, { kind: 'message' }>, width: number) {
  const { Box, Text } = ui
  const { message, isRunStart } = item
  const line = compactLine(message.text, m.summaries)
  const who = message.peer.length > width ? `${message.peer.slice(0, width - 1)}…` : message.peer
  // One Text for the whole row, so that the time and the peer keep their
  // width and only the end of the line is cut.
  return (
    <Box key={`msg-${item.index}`}>
      <Text wrap="truncate-end">
        <Text color={C.muted}>{message.at === null ? '' : `${clock(message.at)} `}</Text>
        <Text color={sideColor(message)} bold={isRunStart} dimColor={!isRunStart}>{arrow(message)} {(isRunStart ? who : '').padEnd(width)}  </Text>
        {line.isSummary ? <Text color={C.muted}>{SPARK} </Text> : null}
        <Text color={line.isWaiting ? C.text2 : C.text}>{line.text}</Text>
        {message.failure === null ? null : <Text color={C.errorLt}>  {CROSS} {message.failure}</Text>}
      </Text>
    </Box>
  )
}

function verboseRow(ui: Ui, item: Extract<Item, { kind: 'message' }>, isFirst: boolean) {
  const { Box, Text } = ui
  const { message, isRunStart } = item
  const color = sideColor(message)
  const time = message.at === null ? '' : clock(message.at)
  return (
    <Box key={`msg-${item.index}`} flexDirection="column" marginTop={isFirst ? 0 : 1} paddingLeft={message.direction === 'out' ? OUT_INDENT : 0}>
      {isRunStart ? (
        <Box justifyContent="space-between">
          <Text color={color} bold>{arrow(message)} {message.peer}</Text>
          <Text color={C.muted}>{time}</Text>
        </Box>
      ) : (
        <Box justifyContent="flex-end">
          <Text color={C.muted}>{time}</Text>
        </Box>
      )}
      <Box>
        <Box width={1} flexShrink={0} backgroundColor={color} />
        <Box flexDirection="column" paddingLeft={1} flexGrow={1} flexShrink={1}>
          <Text color={C.text} wrap="wrap">{message.text}</Text>
          {message.failure === null ? null : <Text color={C.errorLt} wrap="wrap">{CROSS} not delivered: {message.failure}</Text>}
        </Box>
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
  const items = layout(messages, hidden)
  const width = Math.min(PEER_COLUMN, Math.max(...messages.map(x => x.peer.length)))
  return (
    <Box flexDirection="column">
      {hidden > 0 ? <Text color={C.muted}>{hidden} earlier messages are not shown.</Text> : null}
      {items.map((item, i) => {
        if (item.kind === 'day') return dayLine(ui, item.label, `day-${i}`)
        if (m.view === 'compact') return compactRow(ui, m, item, width)
        // No gap at the top of the panel or under a day line.
        return verboseRow(ui, item, i === 0 || items[i - 1]?.kind === 'day')
      })}
    </Box>
  )
}

function optionsBar(ui: Ui, m: Model, act: Act) {
  const { Box, Button } = ui
  return (
    <Box columnGap={2} paddingX={1}>
      <Button key="opt-v" label={m.view === 'compact' ? 'verbose' : 'compact'} hotkey="v" plain onPress={act.toggleView} />
      <Button key="opt-f" label={m.follow ? 'pause' : 'follow'} hotkey="f" plain onPress={act.toggleFollow} />
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
      {peerStrip(ui, m, act)}
      <Box flexDirection="column" borderStyle="double" borderColor={C.emeraldLt} paddingX={1}>
        {body(ui, m)}
      </Box>
      {m.notes.map((text, i) => (
        <Box key={`note-${i}`} paddingX={1}>
          <Text color={C.blondeLt} wrap="wrap">{text}</Text>
        </Box>
      ))}
      {optionsBar(ui, m, act)}
    </Box>
  )
}
