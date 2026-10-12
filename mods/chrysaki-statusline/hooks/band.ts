// The band protocol, version 1, read side. Other mods and processes write
// <band folder>/<source>.json, and bandDir names the folder. This module
// checks each file against protocol/chrysaki-band/band.d.ts and keeps the
// fresh items. The statusline drops a file that breaks a rule whole, so a
// contributor never draws half a segment. No I/O happens here.

import type { BandEntry, BandTone } from '../types'

export const BAND_DIR = 'chrysaki-band'
// The statusline lists the folder this often.
export const BAND_TICK_MS = 3000

const SOURCE = /^[a-z0-9][a-z0-9-]{0,31}$/
const ITEM_ID = /^[a-z0-9-]{1,32}$/
const COMMAND = /^[a-z0-9][a-z0-9:_-]{0,63}$/
const TONES: readonly BandTone[] = ['calm', 'info', 'accent', 'warn', 'alert']
const MAX_ITEMS = 4
const DEFAULT_TTL_MS = 30000
const MAX_TTL_MS = 600000
// A clock ahead of ours by more than this is not trusted.
const SKEW_MS = 60000
// The letters the statusline's own keys use, and the dropdown's.
export const RESERVED_HOTKEYS = new Set(['a', 'e', 'g', 'h', 'l', 'n', 'o', 'p', 'r', 's', 'w', 'x'])

// The variables the folder rule reads. An empty value counts as unset.
export type BandEnv = {
  [K in 'CHRYSAKI_BAND_DIR' | 'XDG_RUNTIME_DIR' | 'TMPDIR' | 'TEMP' | 'TMP']?: string | undefined
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
// protocol/chrysaki-band/client.ts holds the same rule, and a test keeps
// the two equal.
export function bandDir(env: BandEnv): string {
  if (isSet(env.CHRYSAKI_BAND_DIR)) return trimSep(env.CHRYSAKI_BAND_DIR) || env.CHRYSAKI_BAND_DIR
  const base = [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TEMP, env.TMP].find(isSet) ?? '/tmp'
  return joinPath(base, BAND_DIR)
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\n\r\t]/.test(v) ? v : undefined
}

// The items of a good read, and when they leave the band.
export type BandHold = { items: BandEntry[]; expiresAt: number }
// The last good read of each source, by source name.
export type BandHeld = ReadonlyMap<string, BandHold>
// A listed file. `text` is null when the read failed.
export type BandFileText = { name: string; text: string | null }

// One file: a hold, `torn` when the text is missing or not JSON, or null
// when the file is stale or breaks a rule. A writer without a rename can
// leave half a file for a moment, and a Windows lock can refuse a read.
function parseFile(text: string | null, name: string, now: number): BandHold | 'torn' | null {
  if (text === null || text.trim() === '') return 'torn'
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'torn'
  }
  if (typeof raw !== 'object' || raw === null) return null
  const f = raw as Record<string, unknown>
  if (f.v !== 1 || f.source !== name || typeof f.source !== 'string' || !SOURCE.test(f.source)) return null
  if (typeof f.updatedAt !== 'number' || !Number.isFinite(f.updatedAt)) return null
  const ttl = typeof f.ttlMs === 'number' && f.ttlMs > 0 ? Math.min(f.ttlMs, MAX_TTL_MS) : DEFAULT_TTL_MS
  const updatedAt = Math.min(f.updatedAt, now + SKEW_MS)
  if (now > updatedAt + ttl) return null
  if (!Array.isArray(f.items) || f.items.length > MAX_ITEMS) return null
  const items: BandEntry[] = []
  for (const it of f.items as unknown[]) {
    if (typeof it !== 'object' || it === null) return null
    const i = it as Record<string, unknown>
    const id = typeof i.id === 'string' && ITEM_ID.test(i.id) ? i.id : undefined
    const text = str(i.text, 32)
    if (id === undefined || text === undefined) return null
    const tone = typeof i.tone === 'string' && (TONES as readonly string[]).includes(i.tone) ? (i.tone as BandTone) : 'calm'
    const icon = typeof i.icon === 'string' && [...i.icon].length <= 2 && !/\s/.test(i.icon) ? i.icon : undefined
    const command = typeof i.command === 'string' && COMMAND.test(i.command) ? i.command : undefined
    const hotkey = typeof i.hotkey === 'string' && /^[a-z]$/.test(i.hotkey) ? i.hotkey : undefined
    items.push({
      source: name,
      id,
      text,
      tone,
      rank: typeof i.rank === 'number' && Number.isFinite(i.rank) ? i.rank : 0,
      ...(icon === undefined ? {} : { icon }),
      ...(str(i.hint, 200) === undefined ? {} : { hint: str(i.hint, 200) as string }),
      ...(command === undefined ? {} : { command }),
      ...(str(i.args, 200) === undefined ? {} : { args: str(i.args, 200) as string }),
      ...(hotkey === undefined ? {} : { hotkey }),
    })
  }
  if (new Set(items.map(x => x.id)).size !== items.length) return null
  return { items, expiresAt: updatedAt + ttl }
}

// The items of one file, or null when the file is stale, malformed or not
// version 1. `name` is the file name without `.json`.
export function parseBand(text: string, name: string, now: number): BandEntry[] | null {
  const parsed = parseFile(text, name, now)
  return parsed === null || parsed === 'torn' ? null : parsed.items
}

// Every fresh item, and the holds for the next listing. A torn file keeps
// the items of its last good read until they expire, so it does not
// flicker. A file that stays torn leaves when its TTL runs out.
export function readBand(files: readonly BandFileText[], now: number, held: BandHeld = new Map()): { entries: BandEntry[]; held: BandHeld } {
  const next = new Map<string, BandHold>()
  for (const f of files) {
    const parsed = parseFile(f.text, f.name, now)
    const hold = parsed === 'torn' ? held.get(f.name) : parsed
    if (hold !== undefined && hold !== null && now <= hold.expiresAt) next.set(f.name, hold)
  }
  return { entries: orderBand([...next.values()].flatMap(h => h.items)), held: next }
}

// Every fresh item of the files, with no holds.
export function collectBand(files: readonly BandFileText[], now: number): BandEntry[] {
  return readBand(files, now).entries
}

// A stable order: by source, then rank, then id. The statusline drops a
// hotkey that it or an earlier item already holds.
function orderBand(items: readonly BandEntry[]): BandEntry[] {
  const all = [...items]
    .sort((a, b) => a.source.localeCompare(b.source) || a.rank - b.rank || a.id.localeCompare(b.id))
  const taken = new Set(RESERVED_HOTKEYS)
  return all.map(e => {
    if (e.hotkey === undefined) return e
    if (taken.has(e.hotkey)) {
      const { hotkey: _dropped, ...rest } = e
      return rest
    }
    taken.add(e.hotkey)
    return e
  })
}

// A Nerd Font glyph sits in a Private Use Area. Surfaces without the font
// draw it as a box, so the statusline draws ◆ there.
export function iconFor(icon: string | undefined, surface: string): string {
  if (icon === undefined) return '◆'
  if (surface === 'terminal') return icon
  return [...icon].some(ch => {
    const c = ch.codePointAt(0) ?? 0
    return (c >= 0xe000 && c <= 0xf8ff) || c >= 0xf0000
  }) ? '◆' : icon
}
