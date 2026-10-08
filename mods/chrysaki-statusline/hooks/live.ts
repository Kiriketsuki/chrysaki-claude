// The two network reads of the band: the OAuth usage endpoint and the Claude
// status page. The usage read carries the session's own credential as an
// opaque handle, so the token never reaches the mod. The engine interface
// cannot cross an import, so register.tsx hands these functions a LiveHost.

import type { HttpInit, HttpResponse } from 'claude-code'

import type { LimitsFetch, StatuslineOutage } from '../types'
import { USAGE_HEADERS, USAGE_URL, parseOAuthUsage } from './oauth'
import type { OAuthLimits } from './oauth'
import { STATUS_URL, parseIncidents } from './status'

export type LiveHost = {
  now: () => Promise<number>
  // The handle of the session's credential, or null without a Claude login.
  authorize: () => Promise<string | null>
  fetch: (url: string, init?: HttpInit) => Promise<HttpResponse>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  toast: (text: string) => void
  log: (text: string) => void
  getFetch: () => Promise<LimitsFetch>
  setFetch: (v: LimitsFetch) => Promise<void>
  getOutage: () => Promise<StatuslineOutage | null>
  setOutage: (v: StatuslineOutage | null) => Promise<void>
}

// The period of both reads.
export const LIVE_MS = 300000
// A busy flag older than this belongs to a fetch a reload cut short.
const BUSY_STALE_MS = 30000
const FETCH_TIMEOUT_MS = 10000

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function percentText(l: OAuthLimits): string {
  const five = l.fiveHour === undefined ? '?' : `${l.fiveHour.percent}%`
  const seven = l.sevenDay === undefined ? '?' : `${l.sevenDay.percent}%`
  return `5h ${five} · 7d ${seven}`
}

async function readUsage(h: LiveHost): Promise<OAuthLimits> {
  const auth = await h.authorize()
  if (auth === null) throw new Error('this session has no Claude login')
  let timer: { cancel: () => void } | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = h.after(FETCH_TIMEOUT_MS, () => reject(new Error('the request timed out')))
  })
  const r = await Promise.race([h.fetch(USAGE_URL, { headers: USAGE_HEADERS, auth }), timeout])
    .finally(() => timer?.cancel())
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const parsed = parseOAuthUsage(r.text)
  if (parsed === null) throw new Error('the response held no usage windows')
  return parsed
}

// Reads the rate-limit windows and hands them to `apply`. A press always
// reads now, unless a read is in flight. A press shows the result as a
// toast. A timer read fails quietly to the debug log.
export async function fetchLimits(
  h: LiveHost,
  isManual: boolean,
  apply: (l: OAuthLimits, now: number) => Promise<void>,
): Promise<void> {
  const [state, now] = await Promise.all([h.getFetch(), h.now()])
  if (state.isBusy && state.at !== undefined && now - state.at < BUSY_STALE_MS) return
  await h.setFetch({ isBusy: true, at: now })
  try {
    const limits = await readUsage(h)
    await apply(limits, now)
    await h.setFetch({ isBusy: false, at: now })
    if (isManual) h.toast(`Usage read: ${percentText(limits)}`)
  } catch (error) {
    await h.setFetch({ isBusy: false, at: now, error: message(error) })
    if (isManual) h.toast(`The usage read failed: ${message(error)}`)
    else h.log(`usage read failed: ${message(error)}`)
  }
}

// Reads the open incidents. It writes state only when the badge changes.
export async function fetchOutage(h: LiveHost): Promise<void> {
  try {
    const r = await h.fetch(STATUS_URL)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const next = parseIncidents(r.text)
    const prev = await h.getOutage()
    if (JSON.stringify(prev) !== JSON.stringify(next)) await h.setOutage(next)
  } catch (error) {
    h.log(`status page read failed: ${message(error)}`)
  }
}
