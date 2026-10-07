// The lag badge's source: the state file that the chrysaki-lag mod writes at
// $XDG_RUNTIME_DIR/chrysaki-lag/state.json. Mods do not import across
// folders, so this reads the few fields the badge needs. No I/O happens here.

import type { StatuslineLag } from '../types'

export const LAG_FILE = 'chrysaki-lag/state.json'
// A file older than this belongs to no live sampler, and draws no badge.
export const LAG_FRESH_MS = 60000

const SHORT: Record<string, 'io' | 'mem' | 'cpu'> = { io: 'io', memory: 'mem', cpu: 'cpu' }

// The badge for a busy or laggy machine, or null for a calm one, a stale
// file, or a file that does not parse.
export function lagFrom(text: string, now: number): StatuslineLag | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const level = o.level
  const bound = typeof o.bound === 'string' ? SHORT[o.bound] : undefined
  if (o.v !== 1 || typeof o.at !== 'number' || now - o.at > LAG_FRESH_MS) return null
  if ((level !== 'busy' && level !== 'laggy') || bound === undefined) return null
  const p = (o.pressure as Record<string, { avg10?: unknown }> | undefined)?.[String(o.bound)]
  const pct = typeof p?.avg10 === 'number' ? Math.round(p.avg10) : 0
  const top = Array.isArray(o.top) ? o.top.slice(0, 2).map(t => {
    const r = t as Record<string, unknown>
    return `${String(r.label ?? '')} ${String(r.detail ?? '')}`.trim()
  }) : []
  return { level, bound, pct, top }
}
