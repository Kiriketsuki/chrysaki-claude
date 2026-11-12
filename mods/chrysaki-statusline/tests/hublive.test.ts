import { describe, expect, test } from 'claude-code/testing'

import { LIVE_HEARTBEAT_MS, LIVE_PRUNE_EVERY_MS, LIVE_PRUNE_MS, hubLiveDir, liveFileText, syncLiveFile } from '../hooks/hublive'
import type { LiveFileHost } from '../hooks/hublive'

const DIR = '/tmp/test-cache/work.live'

// An in-memory folder and a clock that the test moves by hand.
function fakeHost(start = 1794402600000) {
  const files = new Map<string, string>()
  const calls: string[] = []
  let now = start
  const host: LiveFileHost = {
    now: async () => now,
    read: async p => files.get(p) ?? null,
    makePrivateDir: async p => { calls.push(`mkdir ${p}`) },
    write: async (p, t) => { calls.push(`write ${p}`); files.set(p, t) },
    move: async (from, to) => { calls.push(`move ${from}`); files.set(to, files.get(from) ?? ''); files.delete(from) },
    prune: async (d, age) => { calls.push(`prune ${d} ${age}`) },
  }
  return { host, files, calls, advance: (ms: number) => { now += ms } }
}

describe('the hub live session file', () => {
  test('names the folder as the shell script does', () => {
    expect(hubLiveDir('work', { cliproxyCache: '/c', xdgCache: '/x', home: '/h' })).toBe('/c/work.live')
    expect(hubLiveDir('work', { xdgCache: '/x', home: '/h' })).toBe('/x/cliproxy/work.live')
    expect(hubLiveDir('work', { home: '/h/' })).toBe('/h/.cache/cliproxy/work.live')
    expect(hubLiveDir('work', {})).toBe(null)
    expect(hubLiveDir('../x', { home: '/h' })).toBe(null)
    expect(hubLiveDir('', { home: '/h' })).toBe(null)
  })

  test('writes the contract content', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(JSON.parse(t.files.get(`${DIR}/sess-1.json`) ?? '')).toEqual({ seat: 'seat-a', written_at: 1794402600 })
    expect(liveFileText('seat-b', 5500)).toBe('{"seat":"seat-b","written_at":5}\n')
  })

  test('writes a temp file, moves it, and leaves none behind', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(t.calls).toEqual([`mkdir ${DIR}`, `write ${DIR}/.sess-1.tmp`, `move ${DIR}/.sess-1.tmp`, `write ${DIR}/.prune.stamp`, `prune ${DIR} ${LIVE_PRUNE_MS}`])
    expect([...t.files.keys()].filter(k => k.endsWith('.tmp'))).toEqual([])
  })

  test('does not rewrite a young file with the same seat', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    t.calls.length = 0
    t.advance(LIVE_HEARTBEAT_MS - 1000)
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(t.calls).toEqual([])
  })

  test('sends a heartbeat when the file is old', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    t.advance(LIVE_HEARTBEAT_MS + 1000)
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(JSON.parse(t.files.get(`${DIR}/sess-1.json`) ?? '').written_at).toBe(1794402600 + 61)
  })

  test('rewrites at once when the seat changes', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    t.advance(1000)
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-b')
    expect(JSON.parse(t.files.get(`${DIR}/sess-1.json`) ?? '').seat).toBe('seat-b')
  })

  test('rewrites a file that does not parse', async () => {
    const t = fakeHost()
    t.files.set(`${DIR}/sess-1.json`, 'not json')
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(JSON.parse(t.files.get(`${DIR}/sess-1.json`) ?? '').seat).toBe('seat-a')
  })

  test('keeps the old file and writes nothing when the seat is unknown', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    const text = t.files.get(`${DIR}/sess-1.json`)
    t.calls.length = 0
    await syncLiveFile(t.host, DIR, 'sess-1', null)
    expect(t.calls).toEqual([])
    expect(t.files.get(`${DIR}/sess-1.json`)).toBe(text)
  })

  test('prunes at most once in 10 minutes', async () => {
    const t = fakeHost()
    const prunes = () => t.calls.filter(c => c.startsWith('prune')).length
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    t.advance(LIVE_HEARTBEAT_MS + 1000)
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(prunes()).toBe(1)
    t.advance(LIVE_PRUNE_EVERY_MS)
    await syncLiveFile(t.host, DIR, 'sess-1', 'seat-a')
    expect(prunes()).toBe(2)
  })

  test('writes nothing outside the hub', async () => {
    const t = fakeHost()
    await syncLiveFile(t.host, null, 'sess-1', 'seat-a')
    expect(t.calls).toEqual([])
  })

  test('refuses a bad session id or seat name', async () => {
    const t = fakeHost()
    for (const id of ['', '../evil', 'a b', 'a/b', null, undefined]) await syncLiveFile(t.host, DIR, id, 'seat-a')
    await syncLiveFile(t.host, DIR, 'sess-1', 'bad"seat')
    expect(t.calls).toEqual([])
    expect(t.files.size).toBe(0)
  })

  test('never throws when the host fails', async () => {
    const t = fakeHost()
    const host: LiveFileHost = { ...t.host, write: async () => { throw new Error('disk full') } }
    await syncLiveFile(host, DIR, 'sess-1', 'seat-a')
    expect(t.files.size).toBe(0)
  })
})
