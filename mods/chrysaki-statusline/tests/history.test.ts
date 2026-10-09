import { describe, expect, test } from 'claude-code/testing'

import { FIVE_HOURS_MS, addSample, addTokens, parseHistory, recentTokens, windowBuckets } from '../hooks/history'
import { sparkPaints } from '../hooks/ledger'
import { CORE } from '../hooks/palette'

const NOW = Date.parse('2098-12-31T19:35:00Z')
const MIN = 60000

describe('the usage history', () => {
  test('a reading adds a sample, and a repeat within 10 minutes adds none', async () => {
    const one = addSample({ fiveHour: [], sevenDay: [] }, { ctxWindow: 1, fiveHour: { percent: 10 } }, NOW)
    expect(one.fiveHour).toEqual([[NOW, 10]])
    const same = addSample(one, { ctxWindow: 1, fiveHour: { percent: 10 } }, NOW + 5 * MIN)
    expect(same.fiveHour.length).toBe(1)
    const later = addSample(one, { ctxWindow: 1, fiveHour: { percent: 10 } }, NOW + 11 * MIN)
    expect(later.fiveHour.length).toBe(2)
  })

  test('samples older than their window drop out', async () => {
    const old = { fiveHour: [[NOW - FIVE_HOURS_MS - MIN, 50] as const], sevenDay: [] }
    expect(addSample(old, { ctxWindow: 1, fiveHour: { percent: 3 } }, NOW).fiveHour).toEqual([[NOW, 3]])
  })

  test('the stored history drops anything malformed', async () => {
    expect(parseHistory({ fiveHour: [[1, 2], 'x', [3]], sevenDay: null })).toEqual({ fiveHour: [[1, 2]], sevenDay: [] })
    expect(parseHistory(undefined)).toEqual({ fiveHour: [], sevenDay: [] })
  })
})

describe('window buckets', () => {
  test('a bucket carries the last value, and the part still ahead is null', async () => {
    // The window resets in 1h 15m, so 3h 45m of it has run. Six buckets of
    // 37.5 minutes are past, the seventh starts now, the eighth is ahead.
    const resetsAt = NOW + 75 * MIN
    const start = resetsAt - FIVE_HOURS_MS
    const samples = [[start + 10 * MIN, 5], [start + 100 * MIN, 30], [start + 200 * MIN, 60]] as const
    expect(windowBuckets(samples, resetsAt, FIVE_HOURS_MS, NOW)).toEqual([5, 5, 30, 30, 30, 60, 60, null])
  })

  test('readings from the last window do not leak into this one', async () => {
    const resetsAt = NOW + 4 * 60 * MIN
    expect(windowBuckets([[NOW - 2 * 60 * MIN, 90]], resetsAt, FIVE_HOURS_MS, NOW)).toEqual([0, 0, null, null, null, null, null, null])
  })
})

describe('the context history', () => {
  test('keeps the last counts and pads a young session', async () => {
    expect(addTokens([1, 2], 2)).toEqual([1, 2])
    expect(addTokens([1, 2], 5)).toEqual([1, 2, 5])
    expect(recentTokens([10, 20], 4)).toEqual([null, null, 10, 20])
  })
})

describe('braille sparks', () => {
  test('heights follow the level and nulls draw a dim dot', async () => {
    const paints = sparkPaints([0, 50, 100, null], v => v, () => '#ffffff')
    expect(paints.map(p => p.glyph).join('')).toBe('⡀⣦⣿⡀')
    expect(paints[3]?.fg).toBe(CORE.border)
    expect(paints[1]?.fg).toBe('#ffffff')
  })
})
