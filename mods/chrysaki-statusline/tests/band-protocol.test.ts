import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { collectBand, iconFor, parseBand } from '../hooks/band'

const NOW = Date.parse('2098-12-31T19:35:00Z')
const file = (over: Record<string, unknown> = {}, items: unknown[] = [{ id: 'era', icon: '⚙', text: 'era 1 · 12k/s', tone: 'accent', command: 'tokin', hotkey: 't' }]) =>
  JSON.stringify({ v: 1, source: 'tokin', updatedAt: NOW - 1000, ttlMs: 30000, items, ...over })

describe('the band protocol', () => {
  test('a fresh version 1 file gives its items', async () => {
    const items = parseBand(file(), 'tokin', NOW)
    expect(items).toEqual([{ source: 'tokin', id: 'era', icon: '⚙', text: 'era 1 · 12k/s', tone: 'accent', rank: 0, command: 'tokin', hotkey: 't' }])
  })

  test('a stale, misnamed, wrong-version or oversize file gives nothing', async () => {
    expect(parseBand(file({ updatedAt: NOW - 31000 }), 'tokin', NOW)).toBeNull()
    expect(parseBand(file(), 'other', NOW)).toBeNull()
    expect(parseBand(file({ v: 2 }), 'tokin', NOW)).toBeNull()
    expect(parseBand(file({}, Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, text: 'x' }))), 'tokin', NOW)).toBeNull()
    expect(parseBand('not json', 'tokin', NOW)).toBeNull()
  })

  test('one bad item drops the whole file', async () => {
    expect(parseBand(file({}, [{ id: 'ok', text: 'fine' }, { id: 'BAD ID', text: 'x' }]), 'tokin', NOW)).toBeNull()
    expect(parseBand(file({}, [{ id: 'a', text: 'x'.repeat(33) }]), 'tokin', NOW)).toBeNull()
  })

  test('an unknown tone reads calm and a bad command is left out', async () => {
    const [item] = parseBand(file({}, [{ id: 'a', text: 'x', tone: 'loud', command: '/bad command' }]), 'tokin', NOW) ?? []
    expect(item?.tone).toBe('calm')
    expect(item?.command).toBeUndefined()
  })

  test('a reserved or taken hotkey is dropped, and order is stable', async () => {
    const a = JSON.stringify({ v: 1, source: 'alpha', updatedAt: NOW, items: [{ id: 'one', text: 'one', hotkey: 't' }, { id: 'two', text: 'two', hotkey: 'x' }] })
    const b = JSON.stringify({ v: 1, source: 'beta', updatedAt: NOW, items: [{ id: 'three', text: 'three', hotkey: 't' }] })
    const all = collectBand([{ name: 'beta', text: b }, { name: 'alpha', text: a }], NOW)
    expect(all.map(e => `${e.source}/${e.id}/${e.hotkey ?? '-'}`)).toEqual(['alpha/one/t', 'alpha/two/-', 'beta/three/-'])
  })

  test('a Nerd Font icon becomes ◆ off the terminal', async () => {
    expect(iconFor('', 'terminal')).toBe('')
    expect(iconFor('', 'desktop')).toBe('◆')
    expect(iconFor('⚙', 'desktop')).toBe('⚙')
  })
})

function props(bodyColumns: number) {
  return { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} }
}

function setup(on: On, text: string) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/k', XDG_RUNTIME_DIR: '/run/user/1000' })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  on('fs.list', async (_$, e) => ({ value: e.path === '/run/user/1000/chrysaki-band' ? [{ name: 'tokin.json', kind: 'file' as const, size: text.length, mtimeMs: NOW, isLink: false }] : [] }))
  on('fs.read', async (_$, e) => (e.path === '/run/user/1000/chrysaki-band/tokin.json' ? { value: text } : { deny: 'missing' }))
  on('env.set', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }))
  on('store.get', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  return clock
}

test('a contributed item draws in the header on both surfaces, and a press runs its command', async ($, on) => {
  const clock = setup(on, file())
  const ran: string[] = []
  on('command.list', async () => ({ value: [] }))
  on('command.run', async (_$, e) => {
    ran.push(e.command)
    return {}
  })
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface, component: 'AbovePrompt', props: props(200) })
    expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
    await ui.press({ key: 'band-tokin-era' })
    await ui.unmount()
  }
  expect(ran).toEqual(['tokin', 'tokin'])
})

test('a stale file leaves the band on the next listing', async ($, on) => {
  const clock = setup(on, file({ ttlMs: 4000 }))
  on('command.list', async () => ({ value: [] }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
  await clock.advance(6000)
  expect(await ui.find({ key: 'band-tokin-era' })).toBeUndefined()
  await ui.unmount()
})
