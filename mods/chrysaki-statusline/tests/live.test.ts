import { describe, expect, test } from 'claude-code/testing'

import { withOAuth } from '../hooks/limits'
import { fetchLimits } from '../hooks/live'
import type { LiveHost } from '../hooks/live'
import { parseOAuthUsage } from '../hooks/oauth'
import { parseIncidents } from '../hooks/status'
import type { LimitsFetch } from '../types'

// A trimmed copy of a real answer of the OAuth usage endpoint.
const USAGE = JSON.stringify({
  five_hour: { utilization: 8.0, resets_at: '2026-10-06T07:00:00.746706+00:00' },
  seven_day: { utilization: 70.4, resets_at: '2026-10-10T21:00:00.746729+00:00' },
  seven_day_opus: null,
  limits: [
    { kind: 'session', percent: 8, resets_at: '2026-10-06T07:00:00.746706+00:00', scope: null },
    { kind: 'weekly_scoped', percent: 3, resets_at: '2026-10-10T21:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' } } },
  ],
})

describe('the OAuth usage answer', () => {
  test('gives both windows and the model-scoped limits', async () => {
    const l = parseOAuthUsage(USAGE)
    expect(l?.fiveHour).toEqual({ percent: 8, resetsAt: Date.parse('2026-10-06T07:00:00.746706+00:00') })
    expect(l?.sevenDay?.percent).toBe(70)
    expect(l?.scoped).toEqual([{ label: 'Fable', percent: 3, resetsAt: Date.parse('2026-10-10T21:00:00+00:00') }])
  })

  test('refuses a body with no window', async () => {
    expect(parseOAuthUsage('{"five_hour":null,"seven_day":null}')).toBe(null)
    expect(parseOAuthUsage('not json')).toBe(null)
    expect(parseOAuthUsage('[]')).toBe(null)
  })

  test('clamps a percent out of range', async () => {
    expect(parseOAuthUsage('{"five_hour":{"utilization":140}}')?.fiveHour?.percent).toBe(100)
  })

})

// A host whose clock stands still and whose fetch counts its calls.
function fakeHost(): { host: LiveHost; calls: () => number; toasts: string[] } {
  let n = 0
  let state: LimitsFetch = { isBusy: false }
  const toasts: string[] = []
  const host: LiveHost = {
    now: async () => 1000,
    authorize: async () => 'handle',
    fetch: async () => {
      n += 1
      return { ok: true, status: 200, text: '{"five_hour":{"utilization":10}}' } as never
    },
    after: () => ({ cancel: () => {} }),
    toast: t => { toasts.push(t) },
    log: () => {},
    getFetch: async () => state,
    setFetch: async v => { state = v },
    getOutage: async () => null,
    setOutage: async () => {},
  }
  return { host, calls: () => n, toasts }
}

describe('a press on the reset time', () => {
  test('reads again at once after a read', async () => {
    const f = fakeHost()
    await fetchLimits(f.host, true, async () => {})
    await fetchLimits(f.host, true, async () => {})
    expect(f.calls()).toBe(2)
    expect(f.toasts.every(t => t.startsWith('Usage read'))).toBe(true)
  })

  test('does nothing while a read is in flight', async () => {
    const f = fakeHost()
    await f.host.setFetch({ isBusy: true, at: 1000 })
    await fetchLimits(f.host, true, async () => {})
    expect(f.calls()).toBe(0)
  })
})

describe('a usage reading over the band', () => {
  test('replaces the windows and keeps the context figures', async () => {
    const prev = { ctxWindow: 1000000, ctxPercent: 15, fiveHour: { percent: 2 } }
    const u = withOAuth(prev, { fiveHour: { percent: 8 }, scoped: [] }, 0)
    expect(u.ctxPercent).toBe(15)
    expect(u.fiveHour?.percent).toBe(8)
  })

  test('fills a session that has no figures yet', async () => {
    const u = withOAuth(null, { sevenDay: { percent: 70 }, scoped: [{ label: 'Fable', percent: 3 }] }, 0)
    expect(u.sevenDay?.percent).toBe(70)
    expect(u.scoped?.[0]?.label).toBe('Fable')
  })
})

describe('the status page', () => {
  test('no open incident shows no badge', async () => {
    expect(parseIncidents('{"incidents":[]}')).toBe(null)
    expect(parseIncidents('oops')).toBe(null)
  })

  test('the worst incident leads and the rest count', async () => {
    const body = JSON.stringify({
      incidents: [
        { name: 'Slow logins', impact: 'minor', shortlink: 'https://stspg.io/a' },
        { name: 'API errors', impact: 'major', shortlink: 'https://stspg.io/b' },
      ],
    })
    expect(parseIncidents(body)).toEqual({ impact: 'major', name: 'API errors', count: 2, url: 'https://stspg.io/b' })
  })

  test('a notice rated none still shows as minor', async () => {
    expect(parseIncidents('{"incidents":[{"name":"Maintenance","impact":"none"}]}')?.impact).toBe('minor')
  })
})
