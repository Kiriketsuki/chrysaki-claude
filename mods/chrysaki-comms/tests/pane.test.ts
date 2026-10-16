import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { ApiMessage } from '../hooks/log'

const PANE = {
  plugin: 'chrysaki-comms',
  component: 'Pane',
  requestId: 'chrysaki-comms',
  surface: 'terminal',
  props: { title: 'comms', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const ADDRESS = 'uds:/run/user/1000/cc-socks/78231.sock'
const LONG = 'This is for ADA 4 on aws-04, where the wide frame has to alternate every other frame. '.repeat(3).trim()
const envelope = (body: string) => `<cross-session-message from="${ADDRESS}" from-name="orchestrator">\n${body}\n</cross-session-message>`

// The engine sits beneath the plugin. These hooks stand in for it.
function engine(on: On, transcript: ApiMessage[] = []) {
  mock.clock(on, { now: new Date(2026, 9, 16, 14, 2).getTime() })
  on('session.messages', async () => ({ value: transcript }) as never)
  on('session.send', async (_$, e) => (e.to === 'ghost' ? { isDelivered: false, reason: 'nobody by that name' } : { isDelivered: true }))
  on('session.receive', async (_$, e) => ({ text: e.text }))
}

test('a sent and a received message show in full, with direction, peer and time', async ($, on) => {
  engine(on)
  await $.session.send({ to: 'var-mini', text: LONG, origin: { kind: 'model' } })
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope('ack, sending now') })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /→ var-mini/ })).toBeDefined()
  expect(await ui.find({ text: /14:02/ })).toBeDefined()
  expect(await ui.find({ text: LONG })).toBeDefined()
  expect(await ui.find({ text: /← orchestrator/ })).toBeDefined()
  expect(await ui.find({ text: 'ack, sending now' })).toBeDefined()
  await ui.unmount()
})

test('a send that is not delivered shows why', async ($, on) => {
  engine(on)
  await $.session.send({ to: 'ghost', text: 'hello?', origin: { kind: 'model' } })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /nobody by that name/ })).toBeDefined()
  await ui.unmount()
})

test('a relay event is not a message between sessions', async ($, on) => {
  engine(on)
  await $.session.receive({ origin: { kind: 'task-notification' }, text: 'build finished' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /No message to or from another session yet/ })).toBeDefined()
  await ui.unmount()
})

test('/comms reads the transcript, and a peer key filters the log', async ($, on) => {
  engine(on, [
    { role: 'user', content: [{ type: 'text', text: `Another Claude session sent a message:\n${envelope('from the transcript')}` }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'SendMessage', input: { to: 'var-mini', message: 'to var-mini' } }] },
  ])
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  await $.command.run({ command: 'comms', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true } } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: 'from the transcript' })).toBeDefined()
  expect(await ui.find({ text: 'to var-mini' })).toBeDefined()

  await ui.press({ key: 'peer-orchestrator' })
  expect(await ui.find({ text: 'from the transcript' })).toBeDefined()
  expect(await ui.find({ text: 'to var-mini' })).toBeUndefined()
  await ui.press({ key: 'peer-*' })
  expect(await ui.find({ text: 'to var-mini' })).toBeDefined()
  await ui.unmount()
})
