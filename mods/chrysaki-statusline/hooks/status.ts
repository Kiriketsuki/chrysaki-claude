// Open incidents on the Claude status page. The header shows a badge while
// one is open, so a slow or failing turn has a visible cause. No I/O happens
// here.

import type { StatuslineOutage } from '../types'

// The open incidents alone. An empty list means all systems run.
export const STATUS_URL = 'https://status.claude.com/api/v2/incidents/unresolved.json'
export const STATUS_PAGE = 'https://status.claude.com'

const RANK = { none: 0, minor: 1, major: 2, critical: 3 } as const
type Impact = keyof typeof RANK

function impactOf(v: unknown): Impact {
  return typeof v === 'string' && v in RANK ? (v as Impact) : 'minor'
}

// Null when no incident is open, or when the body does not parse. The badge
// then stays hidden: a status page that fails to answer is no outage.
export function parseIncidents(text: string): StatuslineOutage | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const list = (body as { incidents?: unknown })?.incidents
  if (!Array.isArray(list) || list.length === 0) return null
  const incidents = list
    .map(i => i as { name?: unknown; impact?: unknown; shortlink?: unknown })
    .map(i => ({ name: typeof i.name === 'string' ? i.name : 'incident', impact: impactOf(i.impact), url: typeof i.shortlink === 'string' ? i.shortlink : STATUS_PAGE }))
    .sort((a, b) => RANK[b.impact] - RANK[a.impact])
  const top = incidents[0]
  if (top === undefined) return null
  // An incident the page rates "none" is maintenance or a notice. It still
  // shows, at the lowest level.
  return { impact: top.impact === 'none' ? 'minor' : top.impact, name: top.name, count: incidents.length, url: top.url }
}
