// A small client for Claude Code mods that contribute to the Chrysaki band.
// Copy this file and band.d.ts into a mod. It needs no dependency on
// chrysaki-statusline. Without that mod, the client writes the file and
// nothing reads it.
//
// The validator follows `$` only in the module that registers the hooks, so
// this file never touches `$`. The mod builds a BandHost from `$` in its
// register module and passes it in. README.md beside this file shows how.
//
// Publish again before ttlMs runs out, or the items leave the band. Publish
// an empty list to clear them at once.

import type { BandFile, BandItem } from './band'

export const BAND_DIR_NAME = 'chrysaki-band'

// What the client needs from the engine, built from `$` by the mod.
export type BandHost = {
  runtimeDir: () => Promise<string>
  now: () => Promise<number>
  write: (path: string, text: string) => Promise<void>
  run: (argv: string[]) => Promise<void>
}

// The file's text. Pure, so a mod can test what it publishes.
export function bandText(source: string, items: BandItem[], now: number, ttlMs = 30000): string {
  const file: BandFile = { v: 1, source, updatedAt: now, ttlMs, items }
  return JSON.stringify(file)
}

// Writes the file atomically: a temporary file, then a rename. The
// statusline lists only names that end in `.json`, so it never reads the
// temporary file, and it never reads half a file.
export async function publishBand(host: BandHost, source: string, items: BandItem[], ttlMs = 30000): Promise<void> {
  const dir = `${await host.runtimeDir()}/${BAND_DIR_NAME}`
  const path = `${dir}/${source}.json`
  await host.run(['mkdir', '-p', dir])
  await host.write(`${path}.tmp`, bandText(source, items, await host.now(), ttlMs))
  await host.run(['mv', '-f', `${path}.tmp`, path])
}
