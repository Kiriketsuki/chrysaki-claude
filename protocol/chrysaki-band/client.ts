// A small client for Claude Code mods that contribute to the Chrysaki band.
// Copy this file and band.d.ts into a mod. It needs no dependency on
// chrysaki-statusline. Without that mod, the client writes the file and
// nothing reads it.
//
// The validator follows `$` only in the module that registers the hooks, so
// this file never touches `$`. The mod builds a BandHost from `$` in its
// register module and passes it in. README.md beside this file shows how.
//
// The client runs no shell command, so it works on Linux, macOS and
// Windows. Publish again before ttlMs runs out, or the items leave the
// band. Publish an empty list to clear them at once.

import type { BandEnv, BandFile, BandItem } from './band'

export const BAND_DIR_NAME = 'chrysaki-band'

// What the client needs from the engine, built from `$` by the mod.
export type BandHost = {
  // The variables of the folder rule, from $.env.get.
  env: () => Promise<BandEnv>
  now: () => Promise<number>
  // $.fs.write, which also makes the folder.
  write: (path: string, text: string) => Promise<void>
}

function isSet(v: string | undefined): v is string {
  return v !== undefined && v !== ''
}

function trimSep(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

// Joins with the separator that the base uses. A Windows path without a
// forward slash takes a backslash. Every other path takes a forward slash.
export function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return `${trimSep(base)}${sep}${name}`
}

// The band folder on every platform. CHRYSAKI_BAND_DIR names the whole
// folder. Otherwise the first base that is set takes `chrysaki-band`:
// XDG_RUNTIME_DIR on Linux, TMPDIR on macOS, TEMP or TMP on Windows.
// The statusline reads the folder by the same rule.
export function bandDir(env: BandEnv): string {
  if (isSet(env.CHRYSAKI_BAND_DIR)) return trimSep(env.CHRYSAKI_BAND_DIR) || env.CHRYSAKI_BAND_DIR
  const base = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TEMP, env.TMP].find(isSet) ?? '/tmp'
  return joinPath(base, BAND_DIR_NAME)
}

// The file's text. Pure, so a mod can test what it publishes.
export function bandText(source: string, items: BandItem[], now: number, ttlMs = 30000): string {
  const file: BandFile = { v: 1, source, updatedAt: now, ttlMs, items }
  return JSON.stringify(file)
}

// Writes the file in place. $.fs has no rename, so a read can meet half a
// file for a moment. The statusline then keeps the source's last good
// items, so the band does not flicker.
export async function publishBand(host: BandHost, source: string, items: BandItem[], ttlMs = 30000): Promise<void> {
  const [env, now] = await Promise.all([host.env(), host.now()])
  await host.write(joinPath(bandDir(env), `${source}.json`), bandText(source, items, now, ttlMs))
}
