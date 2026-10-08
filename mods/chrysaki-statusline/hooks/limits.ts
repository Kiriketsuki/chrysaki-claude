// The rate-limit windows between pushes. The engine reads them from API
// response headers alone, so two gaps stay open without help:
//
// 1. A window that passes its reset time keeps its old percent until the next
//    response. rollUsage shows it as reset at once.
// 2. A fresh session has no reading until its first response. The last
//    reading of any session lives in $.store, and withSaved fills it in.

import type { StatuslineUsage, StatuslineWindow } from '../types'
import type { OAuthLimits } from './oauth'

// The $.store key of the last reading. Each account has its own limits, so
// the key names the account.
export function limitsKey(email: string): string {
  return `limits:${email}`
}

export type SavedLimits = {
  // When the reading was taken, in epoch milliseconds.
  at: number
  fiveHour?: StatuslineWindow
  sevenDay?: StatuslineWindow
}

// A window past its reset time has reset. The next reset time is unknown
// until a response reports it.
export function rollWindow(w: StatuslineWindow | undefined, now: number): StatuslineWindow | undefined {
  if (w?.resetsAt === undefined || now < w.resetsAt) return w
  return { percent: 0 }
}

// The usage with each reset window rolled over. It returns the same object
// when nothing rolled, so a caller can skip the state write.
export function rollUsage(u: StatuslineUsage, now: number): StatuslineUsage {
  const fiveHour = rollWindow(u.fiveHour, now)
  const sevenDay = rollWindow(u.sevenDay, now)
  return fiveHour === u.fiveHour && sevenDay === u.sevenDay ? u : { ...u, fiveHour, sevenDay }
}

// Fills the windows a session has no reading for from the saved reading,
// rolled over to now. A window the session has read wins.
export function withSaved(u: StatuslineUsage, saved: SavedLimits | null, now: number): StatuslineUsage {
  if (saved === null) return u
  return rollUsage({ ...u, fiveHour: u.fiveHour ?? saved.fiveHour, sevenDay: u.sevenDay ?? saved.sevenDay }, now)
}

export function toSaved(u: StatuslineUsage, now: number): SavedLimits | null {
  if (u.fiveHour === undefined && u.sevenDay === undefined) return null
  return { at: now, fiveHour: u.fiveHour, sevenDay: u.sevenDay }
}

function parseWindow(v: unknown): StatuslineWindow | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const w = v as Record<string, unknown>
  if (typeof w.percent !== 'number' || !Number.isFinite(w.percent)) return undefined
  const resetsAt = typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) ? w.resetsAt : undefined
  return { percent: Math.max(0, Math.min(100, Math.floor(w.percent))), resetsAt }
}

// The store file is the user's to edit, so its value is checked, not trusted.
export function parseSaved(v: unknown): SavedLimits | null {
  if (typeof v !== 'object' || v === null) return null
  const s = v as Record<string, unknown>
  if (typeof s.at !== 'number') return null
  const fiveHour = parseWindow(s.fiveHour)
  const sevenDay = parseWindow(s.sevenDay)
  if (fiveHour === undefined && sevenDay === undefined) return null
  return { at: s.at, fiveHour, sevenDay }
}

// The usage with a reading of the OAuth usage endpoint laid over it. The
// context figures stay the engine's. A window the endpoint left out keeps
// its last value.
export function withOAuth(prev: StatuslineUsage | null, l: OAuthLimits, now: number): StatuslineUsage {
  return rollUsage({
    ...(prev ?? { ctxWindow: 0 }),
    fiveHour: l.fiveHour ?? prev?.fiveHour,
    sevenDay: l.sevenDay ?? prev?.sevenDay,
    scoped: l.scoped,
  }, now)
}
