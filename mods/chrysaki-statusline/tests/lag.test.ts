import { describe, expect, test } from 'claude-code/testing'

import { LAG_FRESH_MS, WARN_FRESH_MS, lagFrom, warnFrom } from '../hooks/lagfile'

const PSI = (avg10: number) => ({ avg10, avg60: avg10, avg300: avg10 })

function file(level: string, at: number): string {
  return JSON.stringify({
    v: 1, at, level, bound: 'io',
    pressure: { io: PSI(41.4), memory: PSI(1), cpu: PSI(1) },
    top: [{ label: 'golden-pg', detail: 'container · 200 MB/s disk' }, { label: 'ZapZap', detail: '2.5G swap' }, { label: 'x', detail: 'y' }],
  })
}

describe('the lag badge', () => {
  test('a fresh laggy file gives the bound resource and its share', async () => {
    expect(lagFrom(file('laggy', 1000), 1000)).toEqual({
      level: 'laggy', bound: 'io', pct: 41, top: ['golden-pg container · 200 MB/s disk', 'ZapZap 2.5G swap'],
    })
  })

  test('a calm machine, a stale file and a torn file give no badge', async () => {
    expect(lagFrom(file('calm', 1000), 1000)).toBe(null)
    expect(lagFrom(file('busy', 1000), 1000 + LAG_FRESH_MS + 1)).toBe(null)
    expect(lagFrom('{"v":1,"at":', 1000)).toBe(null)
  })
})

describe('the warning badge', () => {
  const warning = (short: string, level: string, isHidden = false) => ({ key: short, group: 'disk', level, short, text: `${short} text`, mark: `${short}|${level}|`, isHidden })

  function file(at: number, healthAt: number, warnings: unknown[]): string {
    return JSON.stringify({ v: 1, at, level: 'calm', bound: 'none', pressure: {}, top: [], health: { at: healthAt, warnings } })
  }

  test('a fresh check gives the worst shown warning and a count of the rest', async () => {
    const list = [warning('/home 98%', 'crit'), warning('3 units', 'warn', true), warning('swap 85%', 'warn'), warning('cpu 96°C', 'warn')]
    expect(warnFrom(file(1000, 1000, list), 1000)).toEqual({ level: 'crit', short: '/home 98%', more: 2 })
  })

  test('hidden warnings, a stale check and a file from an older build give no badge', async () => {
    expect(warnFrom(file(1000, 1000, [warning('3 units', 'warn', true)]), 1000)).toBe(null)
    expect(warnFrom(file(1000 + WARN_FRESH_MS, 1000, [warning('3 units', 'warn')]), 1001 + WARN_FRESH_MS)).toBe(null)
    expect(warnFrom(JSON.stringify({ v: 1, at: 1000, level: 'calm' }), 1000)).toBe(null)
  })
})
