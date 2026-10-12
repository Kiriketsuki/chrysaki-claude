// Run with `node --test protocol/chrysaki-band/client.test.ts`. Node 24 strips the types.
// The folder table matches the one in
// mods/chrysaki-statusline/tests/band-protocol.test.ts, so the client and
// the statusline read the same folder.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { BandEnv } from './band'
import { bandDir, bandText, joinPath, publishBand } from './client.ts'

const WIN_TEMP = 'C:\\Users\\K\\AppData\\Local\\Temp'
const ENVS: [string, BandEnv, string][] = [
  ['Linux', { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/var/tmp' }, '/run/user/1000/chrysaki-band'],
  ['macOS', { TMPDIR: '/var/folders/xy/T/' }, '/var/folders/xy/T/chrysaki-band'],
  ['Windows', { TEMP: WIN_TEMP, TMP: 'C:\\other' }, `${WIN_TEMP}\\chrysaki-band`],
  ['Windows with TMP alone', { TMP: `${WIN_TEMP}\\` }, `${WIN_TEMP}\\chrysaki-band`],
  ['an override', { CHRYSAKI_BAND_DIR: '/srv/band/', XDG_RUNTIME_DIR: '/run/user/1000' }, '/srv/band'],
  ['empty values', { CHRYSAKI_BAND_DIR: '', XDG_RUNTIME_DIR: '', TMPDIR: '/tmp/k' }, '/tmp/k/chrysaki-band'],
  ['no variable', {}, '/tmp/chrysaki-band'],
]

for (const [label, env, dir] of ENVS) {
  test(`${label} writes to ${dir}`, () => {
    assert.equal(bandDir(env), dir)
  })
}

test('a Windows path joins with a backslash', () => {
  assert.equal(joinPath(WIN_TEMP, 'tokin.json'), `${WIN_TEMP}\\tokin.json`)
  assert.equal(joinPath('C:/Users/K/Temp', 'tokin.json'), 'C:/Users/K/Temp/tokin.json')
})

test('publishBand writes once, with no shell command', async () => {
  const writes: [string, string][] = []
  const host = { env: async () => ({ TEMP: WIN_TEMP }), now: async () => 1000, write: async (path: string, text: string) => { writes.push([path, text]) } }
  await publishBand(host, 'tokin', [{ id: 'era', text: 'era 1' }])
  assert.deepEqual(writes, [[`${WIN_TEMP}\\chrysaki-band\\tokin.json`, bandText('tokin', [{ id: 'era', text: 'era 1' }], 1000)]])
})
