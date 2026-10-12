import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

export const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
export const STATUS = '# branch.oid 9f25299abcdef\n# branch.head main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b x.ts\n'

export function props(bodyColumns: number) {
  return {
    hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns,
    scroll: { offset: 0, bodyRows: 12 }, view: {},
  }
}

// The engine's own session.measure step echoes { changed }. A test stands in for it.
// The engine's own band beneath the plugins draws an empty Box here.
export function answerMeasure(on: On): MockClock {
  const clock = mock.clock(on, { now: Date.parse('2098-12-31T19:35:00Z') })
  mock.env(on, { HOME: '/home/k' })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  return clock
}

export const MEASURE = {
  context: { tokens: 130000, window: 200000, percent: 65 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 80, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 20 },
  ],
  cost: { usd: 2 },
  changed: ['context', 'rateLimits', 'cost'] as ('context' | 'rateLimits' | 'cost')[],
}
