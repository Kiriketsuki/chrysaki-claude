import { describe, expect, test } from 'claude-code/testing'

import { parseDockerStats, parseSize, parseSnapshot, rankCauses } from '../hooks/causes'
import { GRACE_MS, parseStat, parseUid, stopCause } from '../hooks/kill'
import type { KillHost, ProcId } from '../hooks/kill'
import { DEFAULT_THRESHOLDS, parsePressure, parsePsi, parseSwaps, thresholdsFrom, verdict } from '../hooks/pressure'
import { NOTICE_GAP_MS, SAMPLE_MS, isNoticeDue, isSampleDue, parseLagFile } from '../hooks/shared'
import type { Cause } from '../types'
import { DOCKER, DOCKER_LATER, PSI_CALM, PSI_CPU, PSI_IO, PSI_MEMORY, SWAPS, laterRows, snapshotJson } from './fixtures'

describe('the verdict', () => {
  test('reads the some line and the swap rows', async () => {
    expect(parsePsi(PSI_IO)).toEqual({ avg10: 37.26, avg60: 46.47, avg300: 40.85 })
    expect(parsePsi('')).toEqual({ avg10: 0, avg60: 0, avg300: 0 })
    expect(parseSwaps(SWAPS)).toEqual({ usedKb: 8160652 + 9870760, totalKb: 8388604 + 33554428, zramUsedKb: 8160652, zramTotalKb: 8388604 })
  })

  test('the day the machine lagged was disk-bound and sustained', async () => {
    const v = verdict(parsePressure({ io: PSI_IO, memory: PSI_MEMORY, cpu: PSI_CPU }), DEFAULT_THRESHOLDS)
    expect(v).toEqual({ level: 'laggy', bound: 'io', isSustained: true })
  })

  test('a quiet machine is calm, and memory outweighs cpu at the same share', async () => {
    expect(verdict(parsePressure({ io: PSI_CALM, memory: PSI_CALM, cpu: PSI_CALM }), DEFAULT_THRESHOLDS).level).toBe('calm')
    const even = 'some avg10=12 avg60=5 avg300=1 total=1\n'
    expect(verdict(parsePressure({ io: PSI_CALM, memory: even, cpu: even }), DEFAULT_THRESHOLDS)).toEqual({ level: 'busy', bound: 'memory', isSustained: false })
  })

  test('the options set the thresholds, and a bad value keeps the default', async () => {
    expect(thresholdsFrom({ ioLaggyAt: '50', busyAt: 'x' })).toEqual({ ...DEFAULT_THRESHOLDS, io: 50 })
  })
})

describe('the causes', () => {
  const t0 = Date.parse('2026-10-07T07:00:00Z')
  const first = parseSnapshot(snapshotJson(t0))
  const second = parseSnapshot(snapshotJson(t0 + 3000, laterRows()))

  test('the snapshot and docker output parse, and a bad line adds nothing', async () => {
    expect(first?.procs).toHaveLength(10)
    expect(parseSnapshot('not json')).toBe(null)
    expect(parseSize('12.1GB')).toBe(12.1e9)
    expect(Math.round(parseSize('1.5MiB'))).toBe(1572864)
    expect(parseDockerStats(DOCKER).map(c => c.name)).toEqual(['miki-598f-golden-pg', 'miki-1067-golden-pg'])
  })

  test('a disk-bound machine ranks the busiest writer, then the swapped process in disk wait', async () => {
    if (first === null || second === null) throw new Error('fixture did not parse')
    const causes = rankCauses('io', second, first, parseDockerStats(DOCKER_LATER), parseDockerStats(DOCKER))
    expect(causes[0]).toMatchObject({ label: 'miki-598f-golden-pg', kind: 'container', detail: 'container · 200 MB/s disk · 5% cpu' })
    expect(causes[1]).toMatchObject({ label: 'zapzap (web)', kind: 'own', detail: '10 MB/s disk · disk wait · 2.5G swap · 1.7G ram' })
    // The snapshot script never ranks. An idle container drops out.
    expect(causes.some(c => c.pid === 424690 || c.label === 'miki-1067-golden-pg')).toBe(false)
  })

  test('only processes of this user that hold nothing up get a stop key', async () => {
    if (first === null || second === null) throw new Error('fixture did not parse')
    const kinds = new Map(rankCauses('memory', second, first, [], null, 20).map(c => [c.label, c.kind]))
    expect(kinds.get('zapzap (web)')).toBe('own')
    expect(kinds.get('firefox')).toBe('own')
    // The session's own claude, its terminal, root and other users are shown only.
    expect(kinds.get('claude')).toBe('system')
    expect(kinds.get('ghostty')).toBe('system')
    expect(kinds.get('kswapd0')).toBe('system')
    expect(kinds.get('postgres')).toBe('system')
    const cpu = rankCauses('cpu', second, first, [], null)
    expect(cpu[0]?.label).toBe('firefox')
    expect(cpu[0]?.detail.startsWith('80% cpu')).toBe(true)
  })
})

describe('a stop', () => {
  const zap: Cause = { key: 'p4420:900', label: 'QtWebEngineProc', detail: '', score: 1, kind: 'own', pid: 4420, start: 900, comm: 'QtWebEngineProc' }

  function host(states: (ProcId | null)[], dockerError: string | null = null): { h: KillHost; sent: string[]; slept: number[] } {
    const sent: string[] = []
    const slept: number[] = []
    let i = 0
    const h: KillHost = {
      identify: async () => states[Math.min(i++, states.length - 1)] ?? null,
      signal: async (pid, sig) => {
        sent.push(`${sig} ${pid}`)
        return true
      },
      sleep: async ms => { slept.push(ms) },
      dockerStop: async name => {
        sent.push(`docker stop ${name}`)
        return dockerError
      },
      uid: 1000,
    }
    return { h, sent, slept }
  }

  const same: ProcId = { comm: 'QtWebEngineProc', start: 900, uid: 1000 }

  test('a process that ends on SIGTERM gets no SIGKILL', async () => {
    const { h, sent, slept } = host([same, null])
    expect(await stopCause(h, zap)).toBe('Stopped QtWebEngineProc (4420) with SIGTERM.')
    expect(sent).toEqual(['TERM 4420'])
    expect(slept).toEqual([GRACE_MS])
  })

  test('a process that ignores SIGTERM gets SIGKILL', async () => {
    const { h, sent } = host([same, same])
    expect(await stopCause(h, zap)).toContain('SIGKILL')
    expect(sent).toEqual(['TERM 4420', 'KILL 4420'])
  })

  test('a pid that now names another process is left alone', async () => {
    const { h, sent } = host([{ ...same, start: 901 }])
    expect(await stopCause(h, zap)).toBe('Process 4420 changed or ended. Nothing was stopped.')
    expect(sent).toEqual([])
  })

  test('a container gets docker stop, and a system process gets nothing', async () => {
    const { h, sent } = host([], 'no such container')
    const pg: Cause = { key: 'cpg', label: 'pg', detail: '', score: 1, kind: 'container', container: 'pg' }
    expect(await stopCause(h, pg)).toBe('docker stop pg failed: no such container')
    expect(await stopCause(h, { ...zap, kind: 'system' })).toContain('system process')
    expect(sent).toEqual(['docker stop pg'])
  })

  test('stat and status parse, with spaces in the comm', async () => {
    const stat = '3698842 (Isolated Web Co) S 1114989 1 1 0 -1 4194560 1 0 0 0 10 20 0 0 20 0 30 0 123456 0 0'
    expect(parseStat(stat)).toEqual({ comm: 'Isolated Web Co', start: 123456 })
    expect(parseUid('Name:\tx\nUid:\t1000\t1000\t1000\t1000\n')).toBe(1000)
  })
})

describe('the shared file', () => {
  test('a stale or missing file asks for a sample, and the notice keeps its gap', async () => {
    const f = parseLagFile(JSON.stringify({
      v: 1, at: 1000, level: 'laggy', bound: 'io',
      pressure: { io: { avg10: 37, avg60: 46, avg300: 40 }, memory: { avg10: 0, avg60: 0, avg300: 0 }, cpu: { avg10: 1, avg60: 0, avg300: 0 } },
      swap: { usedKb: 1, totalKb: 2, zramUsedKb: 1, zramTotalKb: 1 }, top: [], topAt: 0, notifiedAt: 1000, writer: 's1',
    }))
    expect(f?.level).toBe('laggy')
    expect(parseLagFile('{"v":1,"at":5')).toBe(null)
    expect(isSampleDue(null, 0)).toBe(true)
    expect(isSampleDue(f, 1000 + SAMPLE_MS - 1)).toBe(false)
    expect(isSampleDue(f, 1000 + SAMPLE_MS)).toBe(true)
    expect(isNoticeDue(f, 1000 + NOTICE_GAP_MS - 1)).toBe(false)
    expect(isNoticeDue(f, 1000 + NOTICE_GAP_MS)).toBe(true)
  })
})
