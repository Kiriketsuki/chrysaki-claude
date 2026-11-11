import { describe, expect, test } from 'claude-code/testing'

import { accountKey, hubCachePath, hubPoolOf, matchSeat, parseHubCache } from '../hooks/hub'

const NOW = 1794402600000
const seat = (name: string, week: number, five: number, extra: object = {}) => ({
  seat: name, priority: 50, state: 'open', week_used: 0.15, five_hour_used: 0.9,
  week_reset_epoch: week, five_hour_reset_epoch: five, ...extra,
})
const SEATS = [seat('seat-b', 1794949200, 1794413400, { week_used: 0, five_hour_used: 0 }), seat('seat-a', 1794855600, 1794414000), seat('seat-c', 1794524400, 1794418800)]
const body = (o: object = {}) => JSON.stringify({ updated_epoch: 1794402600, fetched_at: 1794402600, next_seat: 'seat-b', seats: SEATS, ...o })
const OWN = { fiveResetMs: 1794414000000, sevenResetMs: 1794855600000 }

describe('the hub session', () => {
  test('reads the pool from CLAUDE_HUB_POOL', () => {
    expect(hubPoolOf('work')).toBe('work')
    expect(hubPoolOf(undefined)).toBe(null)
    expect(hubPoolOf('')).toBe(null)
    expect(hubCachePath('/h', 'work')).toBe('/h/.cache/cliproxy/work.status.json')
    expect(accountKey('hub work seat-a 3/4')).toBe('hub-work')
    expect(accountKey('a@b.co')).toBe('a@b.co')
  })

  test('matches the seat by reset times', () => {
    expect(matchSeat(SEATS, OWN)).toBe('seat-a')
    expect(matchSeat(SEATS, { sevenResetMs: 1794855603000 })).toBe('seat-a')
    expect(matchSeat(SEATS, { fiveResetMs: 1794418800000 })).toBe('seat-c')
    expect(matchSeat(SEATS, { fiveResetMs: 1700000000000, sevenResetMs: 1700000000000 })).toBe(null)
    expect(matchSeat(SEATS, null)).toBe(null)
    expect(matchSeat([seat('only', 1, 2)], null)).toBe('only')
  })

  test('labels the current seat, an unknown seat and the next seat', () => {
    expect(parseHubCache('work', body(), NOW, OWN).label).toBe('hub work seat-a 3/3')
    expect(parseHubCache('work', body(), NOW, { sevenResetMs: 1 }).label).toBe('hub work ? 3/3')
    expect(parseHubCache('work', body(), NOW, null).label).toBe('hub work > seat-b 3/3')
    expect(parseHubCache('work', null, NOW, null).label).toBe('hub work ?')
    expect(parseHubCache('work', body(), NOW + 700000, null).label).toBe('hub work ?')
  })

  test('gives fallback limits only without own readings', () => {
    expect(parseHubCache('work', body(), NOW, OWN).limits).toBe(null)
    const l = parseHubCache('work', body(), NOW, null).limits
    expect(l?.sevenDay).toEqual({ percent: 0, resetsAt: 1794949200000 })
    expect(parseHubCache('work', body(), NOW + 700000, null).limits).toBe(null)
  })
})
