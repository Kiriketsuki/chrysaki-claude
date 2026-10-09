import { describe, expect, test } from 'claude-code/testing'

import { CODEKS_FRESH_MS, codeksFrom } from '../hooks/codeksfile'

function file(at: number, up: boolean, live = 2, active = 1): string {
  return JSON.stringify({ v: 1, at, pid: 42, app_server: { up, error: up ? null : 'connect ECONNREFUSED' }, counts: { live, active, exposed: 1, inboxes: 1 } })
}

describe('the codeKs badge', () => {
  test('a fresh heartbeat with the app-server up gives the thread counts', async () => {
    expect(codeksFrom(file(1000, true), 1000, true)).toEqual({ state: 'up', live: 2, active: 1, exposed: 1 })
  })

  test('a fresh heartbeat with the app-server down gives a down badge', async () => {
    expect(codeksFrom(file(1000, false, 0, 0), 1000, false)?.state).toBe('down')
  })

  test('a stale, torn or foreign heartbeat reads as off while the mod is loaded', async () => {
    const off = { state: 'off', live: 0, active: 0, exposed: 0 }
    expect(codeksFrom(file(1000, true), 1001 + CODEKS_FRESH_MS, true)).toEqual(off)
    expect(codeksFrom('{"v":1,"at":', 1000, true)).toEqual(off)
    expect(codeksFrom(JSON.stringify({ v: 2, at: 1000 }), 1000, true)).toEqual(off)
    expect(codeksFrom(null, 1000, true)).toEqual(off)
  })

  test('no heartbeat and no mod give no badge', async () => {
    expect(codeksFrom(null, 1000, false)).toBe(null)
    expect(codeksFrom(file(1000, true), 1001 + CODEKS_FRESH_MS, false)).toBe(null)
  })
})
