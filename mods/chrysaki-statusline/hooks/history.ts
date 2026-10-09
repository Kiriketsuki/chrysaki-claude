// Usage over time, for the braille sparks in the ledger. Each saved
// rate-limit reading adds a sample per window. The spark splits the current
// window into equal buckets. No I/O happens here.

import type { Sample, StatuslineUsage, UsageHistory } from '../types'

export type { Sample, UsageHistory }

export const FIVE_HOURS_MS = 5 * 3600000
export const SEVEN_DAYS_MS = 7 * 86400000
// A spark has this many cells, one bucket of the window each.
export const SPARK_CELLS = 8
// The store keeps at most this many samples per window.
const MAX_SAMPLES = 400
// A reading with the same percent adds a sample only after this long.
const SAME_PERCENT_GAP_MS = 10 * 60000

export const EMPTY_HISTORY: UsageHistory = { fiveHour: [], sevenDay: [] }

// The $.store key of the history. Each account has its own limits.
export function historyKey(email: string): string {
  return `history:${email}`
}

function isSample(v: unknown): v is Sample {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

// The stored history, with anything malformed dropped.
export function parseHistory(raw: unknown): UsageHistory {
  if (typeof raw !== 'object' || raw === null) return EMPTY_HISTORY
  const r = raw as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isSample) : [])
  return { fiveHour: list(r.fiveHour), sevenDay: list(r.sevenDay) }
}

function append(samples: readonly Sample[], percent: number | undefined, now: number, keepMs: number): Sample[] {
  const kept = samples.filter(s => s[0] > now - keepMs)
  if (percent === undefined) return kept
  const last = kept[kept.length - 1]
  if (last !== undefined && last[1] === percent && now - last[0] < SAME_PERCENT_GAP_MS) return kept
  return [...kept, [now, percent] as const].slice(-MAX_SAMPLES)
}

// The history with the reading in `u` added. Samples older than their window
// drop out.
export function addSample(h: UsageHistory, u: StatuslineUsage, now: number): UsageHistory {
  return {
    fiveHour: append(h.fiveHour, u.fiveHour?.percent, now, FIVE_HOURS_MS),
    sevenDay: append(h.sevenDay, u.sevenDay?.percent, now, SEVEN_DAYS_MS),
  }
}

// The window split into `cells` buckets. A bucket holds the highest percent
// read in it. A bucket with no reading carries the last value before it,
// because usage only grows inside a window. A bucket that starts after `now`
// is null: that part of the window is still ahead. Without a reset time the
// window ends now.
export function windowBuckets(samples: readonly Sample[], resetsAt: number | undefined, spanMs: number, now: number, cells = SPARK_CELLS): (number | null)[] {
  const end = resetsAt ?? now
  const start = end - spanMs
  const width = spanMs / cells
  const inWindow = samples.filter(s => s[0] >= start && s[0] <= now)
  let carry = 0
  return Array.from({ length: cells }, (_, i) => {
    const from = start + i * width
    if (from > now) return null
    const hits = inWindow.filter(s => s[0] >= from && s[0] < from + width).map(s => s[1])
    if (hits.length > 0) carry = Math.max(...hits)
    return carry
  })
}

// The context history: the last `cells` token counts, oldest first, padded
// at the front with nulls while the session is young.
export function recentTokens(history: readonly number[], cells = SPARK_CELLS): (number | null)[] {
  const tail = history.slice(-cells)
  return [...Array.from({ length: cells - tail.length }, () => null), ...tail]
}

// A token count added to the context history. A count equal to the last
// adds nothing, so a redraw does not flatten the spark.
export function addTokens(history: readonly number[], tokens: number | undefined, cells = SPARK_CELLS): number[] {
  if (tokens === undefined || history[history.length - 1] === tokens) return [...history]
  return [...history, tokens].slice(-cells)
}
