// The hub session model. A hub session runs Claude Code through a CLIProxyAPI
// hub, so the session credential is the hub access key and not an Anthropic
// login of one seat, and the pool serves the session. The band must not show the usage endpoint then. The
// statusline script (statusline/hub-status.sh) fetches the hub status and
// keeps a cache file. This module reads that cache. No I/O happens here.

import type { OAuthLimits } from './oauth'

// A cache older than this is stale. The band then shows a quiet placeholder.
export const HUB_STALE_MS = 600000

// The pool name when the session is a hub session, else null. The value is
// CLAUDE_HUB_POOL. A hub session keeps its normal config dir and login.
export function hubPoolOf(poolEnv: string | undefined): string | null {
  return poolEnv !== undefined && /^[a-z0-9-]+$/.test(poolEnv) ? poolEnv : null
}

// The cache path of a pool, as hub-status.sh writes it.
export function hubCachePath(home: string, pool: string, xdgCache?: string): string {
  const base = xdgCache !== undefined && xdgCache !== '' ? xdgCache : `${home.replace(/[\\/]+$/, '')}/.cache`
  return `${base}/cliproxy/${pool}.status.json`
}

// The reset times, in epoch milliseconds, of the windows this session read
// from its own responses. They name the seat that serves the session.
export type HubCurrent = { fiveResetMs?: number; sevenResetMs?: number }

export type HubView = {
  pool: string
  // The text for the account slot, such as "hub work seat-a 3/4".
  label: string
  // The seat that serves this session, or null when unknown.
  seat: string | null
  // The windows of the seat that takes new sessions. Null when the cache is
  // stale, or when the session has its own readings.
  limits: OAuthLimits | null
}

// The store key of an account. A hub label changes with the seat, so every
// label of a pool shares one key.
export function accountKey(email: string): string {
  const m = /^hub ([a-z0-9-]+)/.exec(email)
  return m === null ? email : `hub-${m[1]}`
}

// The tolerance of a reset time match, in milliseconds.
const MATCH_MS = 5000

type Seat = {
  seat?: unknown
  priority?: unknown
  state?: unknown
  week_used?: unknown
  week_hours_left?: unknown
  five_hour_used?: unknown
  five_hour_hours_left?: unknown
  week_reset_epoch?: unknown
  five_hour_reset_epoch?: unknown
  unavailable?: unknown
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function windowOf(used: unknown, hoursLeft: unknown, baseMs: number) {
  const u = num(used)
  if (u === undefined) return undefined
  const h = num(hoursLeft)
  return {
    percent: Math.max(0, Math.min(100, Math.round(u * 100))),
    resetsAt: h === undefined ? undefined : Math.floor(baseMs + h * 3600000),
  }
}

function isOpen(s: Seat): boolean {
  return s.state === 'open' || s.state === 'warm' || (s.state === undefined && s.unavailable !== true)
}

function near(epochS: unknown, ms: number | undefined): boolean {
  const e = num(epochS)
  return e !== undefined && ms !== undefined && Math.abs(e * 1000 - ms) <= MATCH_MS
}

function only(seats: Seat[]): string | null {
  return seats.length === 1 && typeof seats[0]?.seat === 'string' ? seats[0].seat : null
}

// The seat whose reset times equal the session's, within a few seconds. A pool
// of one seat is that seat. Null when no seat or several seats match.
export function matchSeat(seats: Seat[], cur: HubCurrent | null | undefined): string | null {
  if (seats.length === 1) return only(seats)
  if (cur === null || cur === undefined) return null
  const week = seats.filter(s => near(s.week_reset_epoch, cur.sevenResetMs))
  const five = seats.filter(s => near(s.five_hour_reset_epoch, cur.fiveResetMs))
  const both = week.filter(s => near(s.five_hour_reset_epoch, cur.fiveResetMs))
  return only(week) ?? only(both) ?? only(five)
}

// The view of one cache file. `cur` holds the reset times of the session's own
// readings, or null when it has none. The placeholder label answers a missing,
// broken or stale file, and the limits are then null.
export function parseHubCache(pool: string, text: string | null, nowMs: number, cur?: HubCurrent | null): HubView {
  const placeholder: HubView = { pool, label: `hub ${pool} ?`, seat: null, limits: null }
  if (text === null) return placeholder
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return placeholder
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return placeholder
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.seats)) return placeholder
  const updatedS = num(b.updated_epoch) ?? num(b.fetched_at)
  const fetchedS = num(b.fetched_at) ?? updatedS
  if (updatedS === undefined || fetchedS === undefined) return placeholder
  if (nowMs - Math.min(updatedS, fetchedS) * 1000 > HUB_STALE_MS) return placeholder
  const seats = b.seats.filter((s): s is Seat => typeof s === 'object' && s !== null)
  const byPriority = [...seats].sort((x, y) => (num(y.priority) ?? 0) - (num(x.priority) ?? 0))
  const nextName = typeof b.next_seat === 'string' ? b.next_seat : typeof byPriority[0]?.seat === 'string' ? byPriority[0].seat : ''
  const next = seats.find(s => s.seat === nextName)
  const seat = matchSeat(seats, cur)
  const count = seats.length > 1 ? ` ${seats.filter(isOpen).length}/${seats.length}` : ''
  // A ">" marks the next seat, which the bars show only without own readings.
  const name = seat !== null ? seat : cur !== null && cur !== undefined ? '?' : nextName === '' ? '' : `> ${nextName}`
  const label = `hub ${pool}${name === '' ? '' : ` ${name}`}${count}`
  const baseMs = updatedS * 1000
  const resetOf = (epoch: unknown, hours: unknown): number | undefined => {
    const e = num(epoch)
    if (e !== undefined) return e * 1000
    const h = num(hours)
    return h === undefined ? undefined : Math.floor(baseMs + h * 3600000)
  }
  const win = (used: unknown, epoch: unknown, hours: unknown) => {
    const u = num(used)
    return u === undefined ? undefined : { percent: Math.max(0, Math.min(100, Math.round(u * 100))), resetsAt: resetOf(epoch, hours) }
  }
  const fiveHour = next === undefined ? undefined : win(next.five_hour_used, next.five_hour_reset_epoch, next.five_hour_hours_left)
  const sevenDay = next === undefined ? undefined : win(next.week_used, next.week_reset_epoch, next.week_hours_left)
  const own = cur !== null && cur !== undefined
  const limits = own || (fiveHour === undefined && sevenDay === undefined) ? null : { fiveHour, sevenDay, scoped: [] }
  return { pool, label, seat, limits }
}
