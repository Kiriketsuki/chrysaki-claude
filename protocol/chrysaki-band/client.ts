// A small client for Claude Code mods that contribute to the Chrysaki band.
// Copy this file and band.d.ts into a mod. It needs no dependency on
// chrysaki-statusline. Without that mod, the client writes the file and
// nothing reads it.
//
//   import { publishBand } from './chrysaki-band/client'
//   await publishBand($, 'tokin', [{ id: 'era', icon: '*', text: 'era 1', tone: 'accent', command: 'tokin' }])
//
// Publish again before ttlMs runs out, for example on a clock, or the items
// leave the band. Publish an empty list to clear them at once.

import type { EngineInterface } from 'claude-code'

import type { BandFile, BandItem } from './band'

export const BAND_DIR_NAME = 'chrysaki-band'

export async function bandDir($: EngineInterface): Promise<string> {
  const runtime = await $.env.get('XDG_RUNTIME_DIR')
  return `${runtime ?? '/tmp'}/${BAND_DIR_NAME}`
}

export async function publishBand($: EngineInterface, source: string, items: BandItem[], ttlMs = 30000): Promise<void> {
  const dir = await bandDir($)
  const file: BandFile = { v: 1, source, updatedAt: await $.clock.now(), ttlMs, items }
  if (!(await $.fs.exists(dir))) await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5000 })
  await $.fs.write(`${dir}/${source}.json`, JSON.stringify(file))
}
