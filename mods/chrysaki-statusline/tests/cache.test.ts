import { describe, expect, test } from 'claude-code/testing'

import { cacheView, inferTtl, inferredCache, leadSeconds, missCause, nextAlert, parseStatuslineCache, readCacheFile, resetCacheReport, toneColor } from '../hooks/cache'
import type { CacheFileHost } from '../hooks/cache'
import { ROLE } from '../hooks/palette'
import type { StatuslineCache } from '../types'

const NOW = 1_800_000_000_000

describe('source 1: statusLine JSON', () => {
  test('reads prompt_cache', async () => {
    const c = parseStatuslineCache(JSON.stringify({
      session_id: 's',
      prompt_cache: { warm: true, ttl: '1h', expires_at: 1_800_000_600, hit_ratio: 0.92, misses: 3, last_miss_cause: 'ttl_expired', recache_tokens_if_cold: 85000 },
    }))
    expect(c).toEqual({
      source: 'statusline', isWarm: true, ttl: '1h', expiresAt: 1_800_000_600_000,
      hitRatio: 0.92, misses: 3, lastMissCause: 'ttl_expired', recacheTokens: 85000,
    })
  })

  test('ignores a file with no prompt_cache or bad JSON', async () => {
    expect(parseStatuslineCache('{"model":{}}')).toBeNull()
    expect(parseStatuslineCache('{not json')).toBeNull()
    expect(parseStatuslineCache(JSON.stringify({ prompt_cache: { warm: false, ttl: '5m', expires_at: null } }))?.expiresAt).toBeUndefined()
  })
})

describe('source 2: TTL inference', () => {
  test('follows the documented override order', async () => {
    expect(inferTtl({ force5m: '1', ttlEnv: '1h', enable1h: '1' })).toBe('5m')
    expect(inferTtl({ ttlEnv: '5m', ttlSetting: '1h' })).toBe('5m')
    expect(inferTtl({ ttlEnv: 'bogus', ttlSetting: '5m', enable1h: '1' })).toBe('5m')
    expect(inferTtl({ enable1h: '1', maxRateLimit: 120 })).toBe('1h')
    expect(inferTtl({ maxRateLimit: 40 })).toBe('1h')
    expect(inferTtl({ maxRateLimit: 100 })).toBe('5m')
  })

  test('counts the whole prompt from the request start', async () => {
    const c = inferredCache(NOW, '5m', { input_tokens: 1000, cache_read_input_tokens: 60000, cache_creation_input_tokens: 4000 })
    expect(c.expiresAt).toBe(NOW + 300000)
    expect(c.recacheTokens).toBe(65000)
  })
})

describe('segment', () => {
  const warm: StatuslineCache = { source: 'statusline', isWarm: true, ttl: '5m', expiresAt: NOW + 200000, recacheTokens: 50000 }

  test('colour thresholds and labels', async () => {
    expect(leadSeconds('auto', '5m')).toBe(60)
    expect(leadSeconds('auto', '1h')).toBe(300)
    expect(leadSeconds('120', '1h')).toBe(120)
    expect(cacheView(warm, NOW, 60)).toEqual({ label: '3:20', tone: 'warm' })
    expect(cacheView(warm, NOW + 150000, 60)).toEqual({ label: '0:50', tone: 'warning' })
    expect(cacheView(warm, NOW + 200000, 60)).toEqual({ label: 'cold', tone: 'cold' })
    expect(cacheView({ ...warm, ttl: '1h', expiresAt: NOW + 2_400_000 }, NOW, 300)).toEqual({ label: '40m', tone: 'warm' })
    expect(toneColor('warm')).toBe(ROLE.emeraldLt)
    expect(toneColor('warning')).toBe(ROLE.warn)
    expect(toneColor('cold')).toBe(ROLE.error)
  })

  test('alerts once per warm period, then once when cold', async () => {
    const base = { cache: warm, isTurnRunning: false, minTokens: 20000 }
    const at = (t: number) => ({ ...base, now: t, view: cacheView(warm, t, 60)! })
    let r = nextAlert({}, at(NOW))
    expect(r.action).toBeNull()
    r = nextAlert(r.state, at(NOW + 150000))
    expect(r.action).toEqual({ kind: 'warn', minutes: 1, tokens: 50000 })
    r = nextAlert(r.state, at(NOW + 165000))
    expect(r.action).toBeNull()
    r = nextAlert(r.state, at(NOW + 210000))
    expect(r.action).toEqual({ kind: 'cold', tokens: 50000 })
    r = nextAlert(r.state, at(NOW + 225000))
    expect(r.action).toBeNull()
  })

  test('stays quiet during a turn and under the token minimum', async () => {
    const view = cacheView(warm, NOW + 150000, 60)!
    expect(nextAlert({}, { cache: warm, view, now: NOW + 150000, isTurnRunning: true, minTokens: 20000 }).action).toBeNull()
    expect(nextAlert({}, { cache: { ...warm, recacheTokens: 5000 }, view, now: NOW + 150000, isTurnRunning: false, minTokens: 20000 }).action).toBeNull()
  })
})

describe('the live statusLine prompt_cache shape', () => {
  // Captured from a Claude Code 2.1.288 session on 2026-10-05.
  const LIVE = {
    warm: true, caching_observed: true, ttl: '1h', expires_at: 1791154592, requests: 127, misses: 2,
    expected_rebuilds: 0, hit_ratio: 0.9681334015147617, cache_write_tokens: 1130553,
    miss_recache_tokens: 744593, last_miss_at: 1791150991,
    last_miss_cause: { causes: ['ttl_expired_1h'] }, miss_causes: { ttl_expired_1h: 2 },
    recache_tokens_if_cold: 417462,
  }

  test('reads every field the segment uses', async () => {
    const c = parseStatuslineCache(JSON.stringify({ prompt_cache: LIVE }))
    expect(c).toMatchObject({ isWarm: true, ttl: '1h', expiresAt: 1791154592000, misses: 2, lastMissCause: 'ttl_expired_1h', recacheTokens: 417462 })
  })

  test('reads the miss cause as an object or a string', async () => {
    expect(missCause({ causes: ['ttl_expired_1h', 'model_changed'] })).toBe('ttl_expired_1h, model_changed')
    expect(missCause('ttl_expired_5m')).toBe('ttl_expired_5m')
    expect(missCause({ causes: [] })).toBeUndefined()
    expect(missCause(null)).toBeUndefined()
  })
})

// A host that counts its calls. Each field of `over` replaces one default.
function stubHost(over: Partial<CacheFileHost> = {}) {
  const calls = { readFile: 0, run: 0, report: [] as string[], argv: [] as string[][] }
  const host: CacheFileHost = {
    sessionId: async () => 's',
    runtimeDir: async () => undefined,
    readFile: async () => { calls.readFile += 1; return '{}' },
    run: async argv => { calls.run += 1; calls.argv.push(argv); return { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
    report: text => { calls.report.push(text) },
    fail: error => { throw error },
    ...over,
  }
  return { host, calls }
}

const MISSING = 'ENOENT: no such file or directory, open /tmp/chrysaki-statusline/s.json'
const VALID = JSON.stringify({ prompt_cache: { warm: true, ttl: '5m', expires_at: 1_800_000_300 } })

describe('readCacheFile', () => {
  test('a file that no reader finds reads silently', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({ readFile: async () => { throw new Error(MISSING) } })
    expect(await readCacheFile(host)).toBeNull()
    expect(calls.report).toEqual([])
  })

  test('an ENOENT code is silent too', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({ readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } })
    expect(await readCacheFile(host)).toBeNull()
    expect(calls.report).toEqual([])
  })

  test('an ENOENT from fs.read still tries cat on the default /tmp path', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({
      readFile: async () => { throw new Error(MISSING) },
      run: async argv => { calls.argv.push(argv); return { exitCode: 0, stdout: VALID, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
    })
    const cache = await readCacheFile(host)
    expect(cache?.ttl).toBe('5m')
    expect(cache?.source).toBe('statusline')
    expect(calls.argv).toEqual([['cat', '/tmp/chrysaki-statusline/s.json']])
    expect(calls.report).toEqual([])
  })

  test('a cat that cannot run after an ENOENT stays silent', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({
      readFile: async () => { throw new Error(MISSING) },
      run: async () => { throw new Error('spawn cat ENOENT') },
    })
    expect(await readCacheFile(host)).toBeNull()
    expect(calls.report).toEqual([])
  })

  test('another read failure still falls back to cat', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({
      readFile: async () => { throw new Error('refused') },
      run: async argv => { calls.argv.push(argv); return { exitCode: 0, stdout: VALID, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
    })
    const cache = await readCacheFile(host)
    expect(cache?.ttl).toBe('5m')
    expect(calls.argv).toEqual([['cat', '/tmp/chrysaki-statusline/s.json']])
  })

  test('a file with no prompt_cache reports once', async () => {
    resetCacheReport()
    const { host, calls } = stubHost({ readFile: async () => '{not json' })
    expect(await readCacheFile(host)).toBeNull()
    expect(calls.report.length).toBe(1)
    expect(calls.report[0]).toContain('the file holds no prompt_cache')
    expect(await readCacheFile(host)).toBeNull()
    expect(calls.report.length).toBe(1)
  })
})
