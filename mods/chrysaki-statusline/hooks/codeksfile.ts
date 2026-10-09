// The source of the codeKs badge: the heartbeat that `codeks inboxd` writes at
// $XDG_RUNTIME_DIR/codeks/state.json every 5 s. Mods do not import across
// folders, so this reads the few fields the badge needs. No I/O happens here.

import type { StatuslineCodeks } from '../types'

export const CODEKS_FILE = 'codeks/state.json'
// inboxd writes every 5 s. A file older than this means inboxd stopped.
export const CODEKS_FRESH_MS = 20000

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

// The badge for codeKs. `isLoaded` says whether the codeks mod is loaded in
// this session. A missing, stale or torn heartbeat reads as off while the mod
// is loaded, and as no badge without it.
export function codeksFrom(text: string | null, now: number, isLoaded: boolean): StatuslineCodeks | null {
  const off: StatuslineCodeks | null = isLoaded ? { state: 'off', live: 0, active: 0, exposed: 0 } : null
  if (text === null) return off
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return off
  }
  if (typeof v !== 'object' || v === null) return off
  const o = v as Record<string, unknown>
  if (o.v !== 1 || typeof o.at !== 'number' || now - o.at > CODEKS_FRESH_MS) return off
  const app = o.app_server as { up?: unknown } | undefined
  const counts = (o.counts ?? {}) as Record<string, unknown>
  return {
    state: app?.up === true ? 'up' : 'down',
    live: count(counts.live),
    active: count(counts.active),
    exposed: count(counts.exposed),
  }
}
