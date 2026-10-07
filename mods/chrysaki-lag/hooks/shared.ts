// The state file that every session on the machine shares, at
// $XDG_RUNTIME_DIR/chrysaki-lag/state.json. One session at a time samples
// and writes it. The statusline reads it for the header badge. The plugin
// API has no rename, so a write is not atomic, and a reader drops a file
// that does not parse. No I/O happens here.

import type { Bound, Level, Pressure, Swap } from '../types'

export type LagTop = { label: string; detail: string }

export type LagFile = {
  v: 1
  at: number
  level: Level
  bound: Bound
  pressure: Pressure
  swap: Swap
  // The top causes from the last full sample, and when it ran.
  top: LagTop[]
  topAt: number
  // When a session last sent the desktop notice, and which session it was.
  notifiedAt: number
  writer: string
}

export const FILE_NAME = 'chrysaki-lag/state.json'

// A session samples when the file is older than this. Another session
// sampled more recently otherwise.
export const SAMPLE_MS = 8000
// The desktop notice waits at least this long after the last one.
export const NOTICE_GAP_MS = 900000

// XDG_RUNTIME_DIR is per user and lives in memory. /tmp stands in without it.
export function filePath(runtimeDir: string | undefined): string {
  return `${runtimeDir ?? '/tmp'}/${FILE_NAME}`
}

function isPsi(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.avg10 === 'number' && typeof o.avg60 === 'number'
}

export function parseLagFile(text: string): LagFile | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const p = o.pressure as Record<string, unknown> | undefined
  if (o.v !== 1 || typeof o.at !== 'number' || p === undefined || !isPsi(p.io) || !isPsi(p.memory) || !isPsi(p.cpu)) return null
  return o as unknown as LagFile
}

export function isSampleDue(file: LagFile | null, now: number): boolean {
  return file === null || now - file.at >= SAMPLE_MS
}

export function isNoticeDue(file: LagFile | null, now: number): boolean {
  return now - (file?.notifiedAt ?? 0) >= NOTICE_GAP_MS
}
