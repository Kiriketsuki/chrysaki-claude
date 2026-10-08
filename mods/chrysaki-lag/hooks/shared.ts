// The state file that every session on the machine shares, at
// $XDG_RUNTIME_DIR/chrysaki-lag/state.json. One session at a time samples
// and writes it. The statusline reads it for the header badge. The plugin
// API has no rename, so a write is not atomic, and a reader drops a file
// that does not parse. No I/O happens here.

import type { Bound, Level, Pressure, Swap, Warning } from '../types'
import type { DockerFree, HealthMemo } from './health'

export type LagTop = { label: string; detail: string }

// The last health check. The sampler copies it forward until it is due again.
export type HealthFile = {
  at: number
  warnings: Warning[]
  memo: HealthMemo
  // Warning key to the time of the last desktop notice for it.
  notified: Record<string, number>
  docker: DockerFree | null
}

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
  // Absent in a file from an older build.
  health?: HealthFile
}

export const FILE_NAME = 'chrysaki-lag/state.json'
// The marks of the warnings the person hid. Only a press in /lag writes it,
// so the sampler never races a hide.
export const HIDDEN_NAME = 'chrysaki-lag/hidden.json'

// A session samples when the file is older than this. Another session
// sampled more recently otherwise.
export const SAMPLE_MS = 8000
// The desktop notice waits at least this long after the last one.
export const NOTICE_GAP_MS = 900000
// The health check runs this often.
export const HEALTH_MS = 30000
// A critical warning sends a notice at most this often.
export const WARN_NOTICE_GAP_MS = 3600000
// `docker system df` takes up to half a minute, so it runs at most this often.
export const DOCKER_MS = 1800000

// XDG_RUNTIME_DIR is per user and lives in memory. /tmp stands in without it.
export function filePath(runtimeDir: string | undefined, name = FILE_NAME): string {
  return `${runtimeDir ?? '/tmp'}/${name}`
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

export function isHealthDue(h: HealthFile | null | undefined, now: number): boolean {
  return h === null || h === undefined || now - h.at >= HEALTH_MS
}

// The critical warnings that have had no notice for an hour.
export function warnNoticesDue(h: HealthFile, now: number): Warning[] {
  return h.warnings.filter(w => w.level === 'crit' && !w.isHidden && now - (h.notified[w.key] ?? 0) >= WARN_NOTICE_GAP_MS)
}

// The notice times with the new ones added and the lapsed ones dropped.
export function withNotified(notified: Record<string, number>, keys: readonly string[], now: number): Record<string, number> {
  const kept = Object.entries(notified).filter(([, at]) => now - at < WARN_NOTICE_GAP_MS)
  return Object.fromEntries([...kept, ...keys.map(k => [k, now] as const)])
}

export function parseHidden(text: string): string[] {
  try {
    const v = JSON.parse(text) as { marks?: unknown }
    return Array.isArray(v.marks) ? v.marks.filter((m): m is string => typeof m === 'string') : []
  } catch {
    return []
  }
}

// A press toggles one mark. Marks of warnings that are gone drop out.
export function toggleHidden(hidden: readonly string[], mark: string, live: readonly Warning[]): string[] {
  const kept = hidden.filter(m => m !== mark && live.some(w => w.mark === m))
  return hidden.includes(mark) ? kept : [...kept, mark]
}
