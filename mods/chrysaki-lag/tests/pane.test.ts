import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

import { DOCKER, PSI_CPU, PSI_IO, PSI_MEMORY, SWAPS, snapshotJson } from './fixtures'

const RAN = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const NOW = Date.parse('2026-10-07T07:00:00Z')
const STATE = '/run/user/1000/chrysaki-lag/state.json'
const ZAP_STAT = '4420 (QtWebEngineProc) D 2627 1 1 0 -1 4194560 1 0 0 0 10 20 0 0 20 0 30 0 900 0 0'

type Seen = { ran: string[][]; wrote: [string, string][]; clock: MockClock }

// A session on the lagging machine. `shared` is the state file another
// session wrote, or null when there is none. `isZapAlive` says whether
// /proc/4420 still answers after the first read.
async function start($: Engine, on: On, shared: string | null, zapReads = 1): Promise<Seen> {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/k', XDG_RUNTIME_DIR: '/run/user/1000' })
  const seen: Seen = { ran: [], wrote: [], clock }
  let zapLeft = zapReads
  on('process.run', async (_$, e) => {
    seen.ran.push([...e.argv])
    if (e.argv[0] === 'python3') return { value: { ...RAN, stdout: snapshotJson(NOW) } }
    if (e.argv[0] === 'docker') return { value: { ...RAN, stdout: DOCKER } }
    return { value: { ...RAN, stdout: '' } }
  })
  on('fs.read', async (_$, e) => {
    const files: Record<string, string> = {
      '/proc/pressure/io': PSI_IO, '/proc/pressure/memory': PSI_MEMORY, '/proc/pressure/cpu': PSI_CPU, '/proc/swaps': SWAPS,
    }
    if (e.path === STATE && shared !== null) return { value: shared }
    if (e.path === '/proc/4420/stat' && zapLeft > 0) {
      zapLeft -= 1
      return { value: ZAP_STAT }
    }
    if (e.path === '/proc/4420/status') return { value: 'Uid:\t1000\t1000\t1000\t1000\n' }
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', async (_$, e) => {
    seen.wrote.push([e.path, e.text])
    return { value: undefined }
  })
  on('command.register', async () => ({ value: { command: 'lag' } }))
  on('session.id', async () => ({ value: 'session-test' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', async (_$, e, next) => next(e))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/home/k/repo', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  return seen
}

function props() {
  return { isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }
}

test('a session that finds no shared file samples and writes it', async ($, on) => {
  const seen = await start($, on, null)
  const writes = seen.wrote.filter(([path]) => path === STATE)
  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0]?.[1] ?? '{}')).toMatchObject({ v: 1, level: 'laggy', bound: 'io' })
})

test('a session that finds a fresh shared file leaves it alone', async ($, on) => {
  const fresh = JSON.stringify({
    v: 1, at: NOW - 1000, level: 'calm', bound: 'none',
    pressure: { io: { avg10: 1, avg60: 1, avg300: 1 }, memory: { avg10: 0, avg60: 0, avg300: 0 }, cpu: { avg10: 0, avg60: 0, avg300: 0 } },
    swap: { usedKb: 0, totalKb: 0, zramUsedKb: 0, zramTotalKb: 0 }, top: [], topAt: 0, notifiedAt: 0, writer: 'other',
  })
  const seen = await start($, on, fresh)
  expect(seen.wrote).toEqual([])
})

test('/lag draws the causes, and a stop key asks once before it stops', async ($, on) => {
  const seen = await start($, on, null)
  await $.command.run({ command: 'lag', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'chrysaki-lag', surface: 'terminal', component: 'Pane', requestId: 'lag', props: props() } as never)
  expect(await ui.find({ type: 'Text', text: / disk-bound · laggy / })).toBeDefined()
  expect(await ui.find({ key: 'stop-p4420:900' })).toBeDefined()
  // The session's own claude is shown with no stop key.
  expect(await ui.find({ key: 'stop-p1765307:3000' })).toBeUndefined()

  await ui.press({ key: 'stop-p4420:900' })
  expect((await ui.find({ key: 'stop-p4420:900' }))?.props.label).toBe('confirm stop')
  expect(seen.ran.some(argv => argv[0] === 'kill')).toBe(false)

  await ui.press({ key: 'stop-p4420:900' })
  // SIGTERM goes out, the grace period runs, and the process is gone.
  await seen.clock.advance(5000)
  expect(seen.ran).toContainEqual(['kill', '-TERM', '4420'])
  expect(seen.ran.some(argv => argv[0] === 'kill' && argv[1] === '-KILL')).toBe(false)
  await ui.unmount()
})

test('an armed key lapses after five seconds', async ($, on) => {
  const seen = await start($, on, null)
  await $.command.run({ command: 'lag', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'chrysaki-lag', surface: 'terminal', component: 'Pane', requestId: 'lag', props: props() } as never)
  await ui.press({ key: 'stop-p4420:900' })
  await seen.clock.advance(5000)
  await ui.press({ key: 'stop-p4420:900' })
  expect(seen.ran.some(argv => argv[0] === 'kill')).toBe(false)
  await ui.unmount()
})
