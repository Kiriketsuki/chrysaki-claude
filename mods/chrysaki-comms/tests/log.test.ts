import { expect, test } from 'claude-code/testing'

import type { ApiMessage } from '../hooks/log'
import { envelopes, fromTranscript, merged, named, peers, received, sent, shown } from '../hooks/log'
import { clock } from '../hooks/view'

const ADDRESS = 'uds:/run/user/1000/cc-socks/78231.sock'
const wrap = (body: string, name = 'orchestrator') =>
  `<cross-session-message from="${ADDRESS}" from-name="${name}" from-mode="bypass">\n${body}\n</cross-session-message>`

test('reads the address, the name and the full body of each envelope', () => {
  const text = `Another Claude session sent a message:\n${wrap('first line\nsecond line')}\n\nThis came from another Claude session.`
  expect(envelopes(text)).toEqual([{ from: ADDRESS, name: 'orchestrator', body: 'first line\nsecond line' }])
})

test('a delivery without an envelope takes the peer the hook names', () => {
  expect(received('plain text', 5, 'researcher')).toEqual([
    { direction: 'in', peer: 'researcher', address: null, text: 'plain text', at: 5, failure: null },
  ])
})

test('the transcript gives each SendMessage call and each received envelope, in order', () => {
  const rows: ApiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: `Another Claude session sent a message:\n${wrap('Review PR 419.')}` }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 't1', name: 'SendMessage', input: { to: ADDRESS, message: 'Findings: none.' } },
        { type: 'tool_use', id: 't2', name: 'SendMessage', input: { to: 'main', message: { type: 'shutdown_request' } } },
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 't4', name: 'SendMessage', input: { to: 'ghost', message: 'hello?' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'sent' },
        { type: 'tool_result', tool_use_id: 't4', content: [{ type: 'text', text: 'nobody by that name' }], is_error: true },
      ],
    },
  ]
  expect(fromTranscript(rows)).toEqual([
    { direction: 'in', peer: 'orchestrator', address: ADDRESS, text: 'Review PR 419.', at: null, failure: null },
    { direction: 'out', peer: ADDRESS, address: null, text: 'Findings: none.', at: null, failure: null },
    { direction: 'out', peer: 'ghost', address: null, text: 'hello?', at: null, failure: 'nobody by that name' },
  ])
})

test('a live message replaces its transcript row, and older rows come first', () => {
  const old = sent('var-mini', 'old', null, null)
  const again = sent('var-mini', 'again', null, null)
  const liveAgain = sent('var-mini', 'again', 9, null)
  expect(merged([old, again], [liveAgain])).toEqual([old, liveAgain])
})

test('a reply sent to an address joins the thread of its name', () => {
  const log = named([...received(wrap('ping'), 1, ''), sent(ADDRESS, 'pong', 2, null)])
  expect(log.map(m => m.peer)).toEqual(['orchestrator', 'orchestrator'])
})

test('peers list the latest exchange first', () => {
  const log = [sent('a', '1', 1, null), sent('b', '2', 2, null), sent('a', '3', 3, null)]
  expect(peers(log)).toEqual(['a', 'b'])
})

test('the pane shows the latest messages of the filter and counts the rest', () => {
  const log = [sent('a', '1', 1, null), sent('b', '2', 2, null), sent('a', '3', 3, null), sent('a', '4', 4, null)]
  const view = shown(log, 'a', 2)
  expect(view.messages.map(m => m.text)).toEqual(['3', '4'])
  expect(view.hidden).toBe(1)
})

test('the clock shows hours and minutes', () => {
  expect(clock(new Date(2026, 9, 16, 9, 5).getTime())).toBe('09:05')
})
