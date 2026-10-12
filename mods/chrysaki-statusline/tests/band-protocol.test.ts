import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bandDir, collectBand, iconFor, joinPath, parseBand, readBand } from '../hooks/band'
import type { BandEnv } from '../hooks/band'

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

const WIN_TEMP = 'C:\\Users\\K\\AppData\\Local\\Temp'
// protocol/chrysaki-band/client.test.ts checks the client against this table.
const ENVS: [string, BandEnv, string][] = [
  ['Linux', { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/var/tmp' }, '/run/user/1000/chrysaki-band'],
  ['macOS', { TMPDIR: '/var/folders/xy/T/' }, '/var/folders/xy/T/chrysaki-band'],
  ['Windows', { TEMP: WIN_TEMP, TMP: 'C:\\other' }, `${WIN_TEMP}\\chrysaki-band`],
  ['Windows with TMP alone', { TMP: `${WIN_TEMP}\\` }, `${WIN_TEMP}\\chrysaki-band`],
  ['an override', { CHRYSAKI_BAND_DIR: '/srv/band/', XDG_RUNTIME_DIR: '/run/user/1000' }, '/srv/band'],
  ['empty values', { CHRYSAKI_BAND_DIR: '', XDG_RUNTIME_DIR: '', TMPDIR: '/tmp/k' }, '/tmp/k/chrysaki-band'],
  ['no variable', {}, '/tmp/chrysaki-band'],
]

describe('the band folder', () => {
  for (const [label, env, dir] of ENVS) {
    test(`${label} reads ${dir}`, async () => {
      expect(bandDir(env)).toBe(dir)
    })
  }

  test('a Windows path joins with a backslash', async () => {
    expect(joinPath(WIN_TEMP, 'tokin.json')).toBe(`${WIN_TEMP}\\tokin.json`)
    expect(joinPath('C:/Users/K/Temp', 'tokin.json')).toBe('C:/Users/K/Temp/tokin.json')
  })
})

describe('a torn read', () => {
  const good = file({ ttlMs: 5000, updatedAt: NOW })
  test('keeps the last good items until they expire', async () => {
    const first = readBand([{ name: 'tokin', text: good }], NOW)
    for (const text of ['{"v":1,"sou', '', null]) {
      const next = readBand([{ name: 'tokin', text }], NOW + 1000, first.held)
      expect(next.entries.map(e => e.id)).toEqual(['era'])
    }
    expect(readBand([{ name: 'tokin', text: '{"v":1' }], NOW + 6000, first.held).entries).toEqual([])
  })

  test('with no good read before it draws nothing', async () => {
    expect(readBand([{ name: 'tokin', text: '{"v":1' }], NOW).entries).toEqual([])
  })

  test('is not a file that breaks a rule, which drops its items at once', async () => {
    const first = readBand([{ name: 'tokin', text: good }], NOW)
    expect(readBand([{ name: 'tokin', text: file({ v: 2 }) }], NOW + 1000, first.held).entries).toEqual([])
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

test('a file rewritten with an empty list leaves the band within one listing', async ($, on) => {
  let text = file({ ttlMs: 120000 })
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
  on('command.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'terminal', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
  text = file({ ttlMs: 120000 }, [])
  await clock.advance(3000)
  expect(await ui.find({ key: 'band-tokin-era' })).toBeUndefined()
  await ui.unmount()
})

test('on Windows the band reads TEMP and keeps a segment through a torn read', async ($, on) => {
  const dir = `${WIN_TEMP}\\chrysaki-band`
  // The test engine runs on Linux and puts the working folder before a
  // Windows path, so the hooks match the end of the path.
  let text: string | null = file({ ttlMs: 120000, updatedAt: NOW })
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:\\Users\\K', TEMP: WIN_TEMP })
  on('session.measure', async (_$, e) => ({ changed: [...e.changed] }))
  on('ui.render', { component: 'AbovePrompt' }, async (h$, e) => h$.ui.resolve(e).Box({ key: 'engine-band' }))
  on('fs.list', async (_$, e) => ({ value: e.path.endsWith(dir) ? [{ name: 'tokin.json', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }] : [] }))
  on('fs.read', async (_$, e) => (e.path.endsWith(`${dir}\\tokin.json`) && text !== null ? { value: text } : { deny: 'locked' }))
  on('env.set', async () => ({ value: undefined }))
  on('fs.exists', async () => ({ value: false }))
  on('settings.read', async () => ({ value: {} }))
  on('store.get', async () => ({ value: undefined }))
  on('command.list', async () => ({ value: [] }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: 'C:\\Users\\K\\repo', surface: 'desktop', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'chrysaki-statusline', surface: 'desktop', component: 'AbovePrompt', props: props(200) })
  expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
  text = null
  await clock.advance(3000)
  expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
  text = '{"v":1,"source":"to'
  await clock.advance(3000)
  expect(await ui.find({ key: 'band-tokin-era' })).toBeDefined()
  await ui.unmount()
})
