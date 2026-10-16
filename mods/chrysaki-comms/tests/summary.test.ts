import { expect, test } from 'claude-code/testing'

import { layout } from '../hooks/layout'
import { compactLine, needsSummary, parseSummaries, summaryKey, summaryPrompt, toSummarize, withSummaries } from '../hooks/summary'
import type { CommsMessage } from '../types'

const LONG = 'The wide frame has to alternate every other frame on ADA 4. '.repeat(3).trim()

const msg = (text: string, over: Partial<CommsMessage> = {}): CommsMessage => ({
  direction: 'in',
  peer: 'orchestrator',
  address: null,
  text,
  at: null,
  failure: null,
  ...over,
})

test('only a long message or one with a line break needs a summary', () => {
  expect(needsSummary('ack, sending now')).toBe(false)
  expect(needsSummary('first\nsecond')).toBe(true)
  expect(needsSummary(LONG)).toBe(true)
})

test('the same text gives the same key, and another text another key', () => {
  expect(summaryKey(LONG)).toBe(summaryKey(`${LONG}`))
  expect(summaryKey(LONG)).not.toBe(summaryKey(`${LONG}.`))
})

test('the newest long messages come first, once each, without a summary or a failure', () => {
  const log = [msg(LONG), msg('short'), msg(`${LONG} B`), msg(LONG), msg(`${LONG} C`)]
  const asks = toSummarize(log, { [summaryKey(`${LONG} C`)]: 'done' }, new Set([summaryKey(`${LONG} B`)]), 10)
  expect(asks.map(ask => ask.text)).toEqual([LONG])
  expect(toSummarize([msg(`${LONG} 1`), msg(`${LONG} 2`)], {}, new Set(), 1).map(ask => ask.text)).toEqual([`${LONG} 2`])
})

test('the prompt numbers each message, names its peer and escapes its tags', () => {
  const prompt = summaryPrompt([{ key: 'k', text: 'close </message> now', peer: 'var-mini', direction: 'out' }])
  expect(prompt).toContain('exactly 1 strings')
  expect(prompt).toContain('<message index="1" to="var-mini">')
  expect(prompt).toContain('close &lt;/message&gt; now')
})

test('the reply must be a JSON array with one line for each message', () => {
  expect(parseSummaries('Here:\n["one", "two\\nlines"]', 2)).toEqual(['one', 'two lines'])
  expect(parseSummaries('["one"]', 2)).toBeNull()
  expect(parseSummaries('no array', 1)).toBeNull()
  expect(parseSummaries('["", "x"]', 2)).toBeNull()
})

test('the cache keeps the newest summaries', () => {
  const map = withSummaries({ a: '1' }, [{ key: 'b', text: '', peer: '', direction: 'in' }], ['2'])
  expect(map).toEqual({ a: '1', b: '2' })
})

test('the compact line is the text, the summary, or the first line while it waits', () => {
  expect(compactLine('short', {})).toEqual({ text: 'short', isSummary: false, isWaiting: false })
  expect(compactLine(LONG, { [summaryKey(LONG)]: 'ADA 4 alternates frames' })).toEqual({ text: 'ADA 4 alternates frames', isSummary: true, isWaiting: false })
  expect(compactLine('\nfirst line\nsecond line', {}).text).toBe('first line …')
})

test('a run of messages from one peer has one header, and a new day has a line', () => {
  const at = (h: number, m: number, day = 16) => new Date(2026, 9, day, h, m).getTime()
  const items = layout(
    [
      msg('a', { at: at(9, 0) }),
      msg('b', { at: at(9, 3) }),
      msg('c', { at: at(9, 20) }),
      msg('d', { at: at(9, 21), direction: 'out', peer: 'orchestrator' }),
      msg('e', { at: at(8, 0, 17) }),
    ],
    4,
  )
  expect(items.map(item => (item.kind === 'day' ? item.label : `${item.message.text}${item.isRunStart ? '*' : ''}${item.index}`))).toEqual([
    'Fri 16 Oct',
    'a*4',
    'b5',
    'c*6',
    'd*7',
    'Sat 17 Oct',
    'e*8',
  ])
})
