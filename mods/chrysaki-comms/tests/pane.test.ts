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
  await ui.press({ key: 'opt-v' })
  expect(await ui.find({ text: /→ var-mini/ })).toBeDefined()
  expect(await ui.find({ text: /14:02/ })).toBeDefined()
  expect(await ui.find({ text: LONG })).toBeDefined()
  expect(await ui.find({ text: /← orchestrator/ })).toBeDefined()
  expect(await ui.find({ text: 'ack, sending now' })).toBeDefined()
  await ui.unmount()
})

test('the compact view shows a short message whole and the first line of a long one', async ($, on) => {
  engine(on)
  await $.session.send({ to: 'var-mini', text: LONG, origin: { kind: 'model' } })
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope('ack, sending now') })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: 'ack, sending now' })).toBeDefined()
  expect(await ui.find({ text: LONG })).toBeUndefined()
  expect(await ui.find({ text: /This is for ADA 4/ })).toBeDefined()
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

test('/comms reads the transcript file, with the time of each message', async ($, on) => {
  engine(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.id', async () => ({ value: 'session-1' }))
  on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? '/home/dev' : undefined }))
  const argvs: (readonly string[])[] = []
  on('process.run', async (_$, e) => {
    argvs.push(e.argv)
    const events = [{ kind: 'in', at: new Date(2026, 9, 16, 9, 30).getTime(), text: envelope('before the compaction') }]
    return { value: { exitCode: 0, stdout: JSON.stringify(events), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'comms', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true } } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: 'before the compaction' })).toBeDefined()
  expect(await ui.find({ text: /09:30/ })).toBeDefined()
  expect(argvs[0]?.slice(2)).toEqual(['session-1', '/home/dev/.claude'])
  await ui.unmount()
})

test('without the transcript file, the pane says what it shows instead', async ($, on) => {
  engine(on)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.id', async () => ({ value: 'session-1' }))
  on('env.get', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'no transcript for session session-1', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run({ command: 'comms', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true } } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /no transcript for session session-1/ })).toBeDefined()
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

// The pieces that /comms needs to open the pane and read a transcript file.
function opener(on: On, events: unknown[]) {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('session.id', async () => ({ value: 'session-1' }))
  on('env.get', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: JSON.stringify(events), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

const OPEN = { command: 'comms', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true } } as never

test('the compact view asks Haiku for a one-line summary of each long message', async ($, on) => {
  engine(on)
  opener(on, [{ kind: 'in', at: new Date(2026, 9, 16, 9, 30).getTime(), text: envelope(LONG) }])
  const asked: { model: string; prompt: string }[] = []
  on('model.complete', async (_$, e) => {
    asked.push({ model: e.model, prompt: e.prompt })
    return { value: { isAnswered: true, text: '["ADA 4 needs the wide frame to alternate"]', usage: {} } } as never
  })
  await $.command.run(OPEN)
  const ui = await $.ui.mount(PANE)
  // The summary call runs in the background. A redraw waits for it.
  await ui.redraw()
  expect(await ui.find({ text: 'ADA 4 needs the wide frame to alternate' })).toBeDefined()
  expect(asked.map(a => a.model)).toEqual(['claude-haiku-5-5'])
  expect(asked[0]?.prompt).toContain('<message index="1" from="orchestrator">')

  await ui.press({ key: 'opt-v' })
  expect(await ui.find({ text: LONG })).toBeDefined()
  expect(await ui.find({ text: 'ADA 4 needs the wide frame to alternate' })).toBeUndefined()
  await ui.unmount()
})

test('a failed summary call leaves a note and the first line', async ($, on) => {
  engine(on)
  opener(on, [{ kind: 'in', at: null, text: envelope(LONG) }])
  on('model.complete', async () => ({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} } }) as never)
  await $.command.run(OPEN)
  const ui = await $.ui.mount(PANE)
  // The summary call runs in the background. A redraw waits for it.
  await ui.redraw()
  expect(await ui.find({ text: /claude-haiku-5-5 wrote no summaries: API error 529 \(overloaded\)/ })).toBeDefined()
  expect(await ui.find({ text: /This is for ADA 4/ })).toBeDefined()
  await ui.unmount()
})

test('f pauses the pane at its place and turns follow back on', async ($, on) => {
  engine(on)
  opener(on, [])
  await $.command.run(OPEN)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ text: /↓ follow/ })).toBeDefined()
  await ui.press({ key: 'opt-f' })
  expect(await ui.find({ text: /paused/ })).toBeDefined()
  await ui.press({ key: 'opt-f' })
  expect(await ui.find({ text: /↓ follow/ })).toBeDefined()
  await ui.unmount()
})
