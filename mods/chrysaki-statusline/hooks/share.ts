// The share offer. A publish that makes a new artifact offers to open it in
// the Firefox profile of the account that owns it. The person then adds the
// partner account from the Share menu on claude.ai. Neither the Artifact tool
// nor the plugin API can share an artifact, so that last step stays the
// person's. No I/O happens here.

import type { ShareOffer, StatuslineAccount } from '../types'

// The $.store key of the artifact URLs that had an offer. A republish of
// the same artifact never offers again.
export const OFFERED_KEY = 'shareOffered'
const OFFERED_MAX = 200

// An offer leaves the band after this long. The desktop notice waits as long.
export const OFFER_WINDOW_MS = 1800000

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/

// The Artifact arguments that tell a new artifact from an update.
export type PublishInput = { action?: string; url?: string; asset?: boolean }

// True for a publish that can make a new artifact: it names no artifact to
// update and uploads no asset. A redeploy of a page this session published
// also passes, and the offered list stops its second offer.
export function isNewPublish(e: PublishInput): boolean {
  const isPublish = e.action === undefined || e.action === 'publish'
  return isPublish && (e.url === undefined || e.url === '') && e.asset !== true
}

// The first artifact link in the tool's result text, or null.
export function artifactUrlFrom(text: string): string | null {
  return ARTIFACT_URL.exec(text)?.[0] ?? null
}

// The store file is the user's to edit, so its value is checked, not trusted.
export function parseOffered(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// The offered list with `url` added last, cut to the newest OFFERED_MAX.
export function withOffered(list: readonly string[], url: string): string[] {
  return [...list.filter(u => u !== url), url].slice(-OFFERED_MAX)
}

// The offer for a new artifact, or null when it had one already or the
// account has no partner. The profile path is empty when no account entry
// names one, and the artifact then opens in the default browser.
// `partners` comes from the personal config: each account's share partner.
export function offerFor(url: string, email: string, accounts: readonly StatuslineAccount[], offered: readonly string[], now: number, partners: Readonly<Record<string, string>>): ShareOffer | null {
  if (offered.includes(url)) return null
  const owner = email.trim().toLowerCase()
  const partner = partners[owner]
  if (partner === undefined) return null
  const path = accounts.find(a => a.email === owner)?.path ?? ''
  return { url, owner, partner, path, at: now }
}

// The offer while its window is open, else null.
export function liveOffer(o: ShareOffer | null, now: number): ShareOffer | null {
  return o !== null && now - o.at <= OFFER_WINDOW_MS ? o : null
}
