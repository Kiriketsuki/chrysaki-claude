// The rate-limit windows from the OAuth usage endpoint, the one the /usage
// screen reads. The engine only reads the windows from the response headers
// of a turn. This endpoint answers at any time, so the band can refresh an
// idle session and fill a fresh one before its first turn. No I/O happens here.

import type { StatuslineScopedLimit, StatuslineWindow } from '../types'

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
// The endpoint answers only requests that name this beta.
export const USAGE_HEADERS: Record<string, string> = {
  'anthropic-beta': 'oauth-2025-04-20',
  'content-type': 'application/json',
}

export type OAuthLimits = {
  fiveHour?: StatuslineWindow
  sevenDay?: StatuslineWindow
  // Weekly limits that cover one model, such as Fable.
  scoped: StatuslineScopedLimit[]
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function epoch(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const at = Date.parse(v)
  return Number.isNaN(at) ? undefined : at
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.floor(n)))
}

// `five_hour` and `seven_day` carry `utilization` (0 to 100) and `resets_at`.
function windowOf(v: unknown): StatuslineWindow | undefined {
  const w = record(v)
  if (w === null || typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return undefined
  return { percent: clampPercent(w.utilization), resetsAt: epoch(w.resets_at) }
}

// `limits` lists every limit. A `weekly_scoped` entry names its model in
// `scope.model.display_name`.
function scopedOf(v: unknown): StatuslineScopedLimit[] {
  if (!Array.isArray(v)) return []
  return v.flatMap(item => {
    const l = record(item)
    if (l === null || l.kind !== 'weekly_scoped' || typeof l.percent !== 'number') return []
    const model = record(record(record(l.scope)?.model))
    const label = typeof model?.display_name === 'string' && model.display_name !== '' ? model.display_name : 'scoped'
    return [{ label, percent: clampPercent(l.percent), resetsAt: epoch(l.resets_at) }]
  })
}

// The response is the server's, so its value is checked, not trusted. Null
// when it holds neither window.
export function parseOAuthUsage(text: string): OAuthLimits | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const b = record(body)
  if (b === null) return null
  const fiveHour = windowOf(b.five_hour)
  const sevenDay = windowOf(b.seven_day)
  if (fiveHour === undefined && sevenDay === undefined) return null
  return { fiveHour, sevenDay, scoped: scopedOf(b.limits) }
}

// The shortest wait between two fetches the person starts by hand.
export const MANUAL_COOLDOWN_MS = 30000

// True when a fetch may start now. A timer fetch waits for none, because its
// own period spaces it.
export function mayFetch(lastAt: number | undefined, now: number, isManual: boolean): boolean {
  if (!isManual || lastAt === undefined) return true
  return now - lastAt >= MANUAL_COOLDOWN_MS
}
