import { describe, expect, mock, test } from 'claude-code/testing'

import { parseHistory } from '../hooks/history'
import { limitsKey, parseSaved, rollUsage, rollWindow, toSaved, withSaved } from '../hooks/limits'

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const NOW = Date.parse('2098-12-31T19:35:00Z')
const HOUR = 3600000

describe('rollover without a request', () => {
  test('a window past its reset time shows as reset', async () => {
    expect(rollWindow({ percent: 80, resetsAt: NOW - 1 }, NOW)).toEqual({ percent: 0 })
    expect(rollWindow({ percent: 80, resetsAt: NOW + HOUR }, NOW)).toEqual({ percent: 80, resetsAt: NOW + HOUR })
    expect(rollWindow({ percent: 80 }, NOW)).toEqual({ percent: 80 })
  })

  test('rollUsage keeps the same object when nothing rolled', async () => {
    const u = { ctxWindow: 1000000, fiveHour: { percent: 3, resetsAt: NOW + HOUR } }
    expect(rollUsage(u, NOW)).toBe(u)
    expect(rollUsage(u, NOW + 2 * HOUR).fiveHour).toEqual({ percent: 0 })
  })
})

describe('the saved reading', () => {
  test('fills only the windows the session has not read', async () => {
    const saved = { at: NOW - HOUR, fiveHour: { percent: 40, resetsAt: NOW + HOUR }, sevenDay: { percent: 45, resetsAt: NOW + 50 * HOUR } }
    const u = withSaved({ ctxWindow: 1000000, sevenDay: { percent: 46, resetsAt: NOW + 50 * HOUR } }, saved, NOW)
    expect(u.fiveHour?.percent).toBe(40)
    expect(u.sevenDay?.percent).toBe(46)
    // A saved window that has reset since shows as reset.
    expect(withSaved({ ctxWindow: 1 }, saved, NOW + 2 * HOUR).fiveHour).toEqual({ percent: 0 })
  })

  test('the store value is checked, not trusted', async () => {
    expect(parseSaved(null)).toBe(null)
    expect(parseSaved({ at: 1 })).toBe(null)
    expect(parseSaved({ at: 1, fiveHour: { percent: 'x' } })).toBe(null)
    expect(parseSaved({ at: 1, fiveHour: { percent: 140.7 } })).toEqual({ at: 1, fiveHour: { percent: 100 }, sevenDay: undefined })
    expect(toSaved({ ctxWindow: 1 }, NOW)).toBe(null)
    expect(limitsKey('a@b.c')).toBe('limits:a@b.c')
  })
})

test('a fresh session draws the last saved limits before its first response', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/k' })
  on('process.run', async () => ({ value: { ...RAN, exitCode: 1, stdout: '' } }))
  on('fs.read', async () => ({ value: JSON.stringify({ oauthAccount: { emailAddress: 'k@example.com' } }) }))
  on('fs.exists', async () => ({ value: false }))
  on('env.set', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', async () => ({ value: { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] } }))
  const keys: string[] = []
  on('store.get', async (_$, e) => {
    keys.push(e.key)
    return { value: { at: NOW - HOUR, fiveHour: { percent: 42, resetsAt: NOW + HOUR }, sevenDay: { percent: 45 } } }
  })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  expect(keys.filter(k => k.startsWith('limits:'))).toEqual(['limits:k@example.com'])
  const props = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 12 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props })
  expect(await ui.find({ type: 'Text', text: /^ ?42%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ ?45%$/ })).toBeDefined()
  // A context-only measurement keeps the seeded windows.
  await $.session.measure({ context: { tokens: 5000, window: 1000000, percent: 1 }, rateLimits: [], changed: ['context'] })
  expect(await ui.find({ type: 'Text', text: /^ ?42%$/ })).toBeDefined()
  await ui.unmount()
})

test('a rate-limit push saves the reading for the next session', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  const sets: { key: string; value: unknown }[] = []
  on('store.set', async (_$, e) => {
    sets.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  await $.session.measure({ context: { tokens: 1, window: 1000000, percent: 0 }, rateLimits: [], changed: ['context'] })
  expect(sets).toEqual([])
  await $.session.measure({
    context: { tokens: 1, window: 1000000, percent: 0 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2099-01-01T00:00:00Z' }],
    changed: ['rateLimits'],
  } as never)
  // The reading, then the history the sparks draw.
  expect(sets.map(x => x.key)).toEqual(['limits:unknown', 'history:unknown'])
  expect(parseSaved(sets[0]?.value)?.fiveHour?.percent).toBe(12)
  expect(parseHistory(sets[1]?.value).fiveHour).toEqual([[NOW, 12]])
})
