// The band protocol, version 1, read side. Other mods and processes write
// $XDG_RUNTIME_DIR/chrysaki-band/<source>.json. This module checks each
// file against protocol/chrysaki-band/band.d.ts and keeps the fresh items.
// The statusline drops a file that breaks a rule whole, so a contributor
// never draws half a segment. No I/O happens here.

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

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\n\r\t]/.test(v) ? v : undefined
}

// The items of one file, or null when the file is stale, malformed or not
// version 1. `name` is the file name without `.json`.
export function parseBand(text: string, name: string, now: number): BandEntry[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
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
  return items
}

// Every fresh item, in a stable order: by source, then rank, then id. The
// statusline drops a hotkey that it or an earlier item already holds.
export function collectBand(files: readonly { name: string; text: string }[], now: number): BandEntry[] {
  const all = files
    .flatMap(f => parseBand(f.text, f.name, now) ?? [])
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
