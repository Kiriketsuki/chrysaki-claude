// Prompt cache warmth: where the figures come from, how the segment reads,
// and when to warn. Pure functions. register.tsx does the I/O.
//
// Facts from code.claude.com/docs/en/prompt-caching: the main conversation
// TTL is 1h on a subscription within plan usage and 5m otherwise. Every hit
// resets the TTL, and the lifetime counts from the start of the request.
// After expiry the next request writes the whole prefix again.

import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { CacheAlert, CacheTone, CacheView, StatuslineCache } from '../types'
import { ROLE } from './palette'

export type Ttl = '5m' | '1h'

export const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60 * 1000, '1h': 60 * 60 * 1000 }

function isTtl(v: unknown): v is Ttl {
  return v === '5m' || v === '1h'
}

// Source 1: the statusLine stdin JSON that statusline-command.sh writes to
// disk. Answers null when the text is not JSON or holds no prompt_cache.
export function parseStatuslineCache(text: string): StatuslineCache | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  const pc = (doc as { prompt_cache?: Record<string, unknown> } | null)?.prompt_cache
  if (pc === undefined || pc === null || typeof pc !== 'object') return null
  const expires = typeof pc.expires_at === 'number' ? pc.expires_at * 1000 : undefined
  return {
    source: 'statusline',
    isWarm: pc.warm === true,
    ttl: isTtl(pc.ttl) ? pc.ttl : '5m',
    expiresAt: expires,
    hitRatio: typeof pc.hit_ratio === 'number' ? pc.hit_ratio : undefined,
    misses: typeof pc.misses === 'number' ? pc.misses : undefined,
    lastMissCause: missCause(pc.last_miss_cause),
    recacheTokens: typeof pc.recache_tokens_if_cold === 'number' ? pc.recache_tokens_if_cold : undefined,
  }
}

// The live statusLine JSON spells last_miss_cause as { causes: string[] },
// for example { causes: ["ttl_expired_1h"] }. A plain string also reads.
export function missCause(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  const causes = (raw as { causes?: unknown } | null)?.causes
  if (!Array.isArray(causes)) return undefined
  const names = causes.filter((c): c is string => typeof c === 'string')
  return names.length > 0 ? names.join(', ') : undefined
}

export type TtlInputs = {
  force5m?: string
  ttlEnv?: string
  ttlSetting?: unknown
  enable1h?: string
  // The highest rate-limit window reading, 0 to 100 and past.
  maxRateLimit?: number
}

// Source 2: the TTL in the documented override order, then the plan default.
// A window at 100% or more means overage, which drops the TTL to 5m.
export function inferTtl(i: TtlInputs): Ttl {
  if (i.force5m === '1') return '5m'
  if (isTtl(i.ttlEnv)) return i.ttlEnv
  if (isTtl(i.ttlSetting)) return i.ttlSetting
  if (i.enable1h === '1') return '1h'
  return (i.maxRateLimit ?? 0) >= 100 ? '5m' : '1h'
}

export type StepUsage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// Source 2: one main-thread request started at `startedAt`. The whole prompt
// it sent is what a cold cache writes again.
export function inferredCache(startedAt: number, ttl: Ttl, u: StepUsage): StatuslineCache {
  return {
    source: 'inferred',
    isWarm: true,
    ttl,
    expiresAt: startedAt + TTL_MS[ttl],
    recacheTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
  }
}

// The warning lead in seconds: `auto` is 60 for a 5m TTL and 300 for 1h.
export function leadSeconds(config: string, ttl: Ttl): number {
  const n = Number(config)
  if (config !== 'auto' && Number.isFinite(n) && n > 0) return n
  return ttl === '5m' ? 60 : 300
}

function clockLabel(remainingMs: number): string {
  const secs = Math.ceil(remainingMs / 1000)
  if (secs > 600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export function remainingMs(c: StatuslineCache, now: number): number {
  return c.expiresAt === undefined ? 0 : c.expiresAt - now
}

// What the segment shows now. Equal views draw the same, so the timer writes
// state only when this changes.
export function cacheView(c: StatuslineCache | null, now: number, leadSec: number): CacheView | null {
  if (c === null) return null
  const left = remainingMs(c, now)
  if (!c.isWarm || left <= 0) return { label: 'cold', tone: 'cold' }
  return { label: clockLabel(left), tone: left <= leadSec * 1000 ? 'warning' : 'warm' }
}

export function toneColor(tone: CacheTone): string {
  if (tone === 'cold') return ROLE.error
  if (tone === 'warning') return ROLE.warn
  return ROLE.emeraldLt
}

export type AlertInputs = {
  cache: StatuslineCache
  view: CacheView
  now: number
  isTurnRunning: boolean
  minTokens: number
}

export type AlertAction =
  | { kind: 'warn'; minutes: number; tokens: number }
  | { kind: 'cold'; tokens: number }

// Decides one alert. A warm period is one expiry time: a cache hit moves the
// expiry and starts a new period. Each period warns once as it crosses the
// lead, then once more if it goes cold. No alert fires while a turn runs,
// because that turn renews the cache.
export function nextAlert(state: CacheAlert, i: AlertInputs): { state: CacheAlert; action: AlertAction | null } {
  const key = i.cache.expiresAt
  const tokens = i.cache.recacheTokens ?? 0
  if (key === undefined || i.isTurnRunning || tokens < i.minTokens) return { state, action: null }
  if (i.view.tone === 'warning' && state.warnedFor !== key) {
    const minutes = Math.max(1, Math.ceil(remainingMs(i.cache, i.now) / 60000))
    return { state: { ...state, warnedFor: key }, action: { kind: 'warn', minutes, tokens } }
  }
  if (i.view.tone === 'cold' && state.warnedFor === key && state.coldFor !== key) {
    return { state: { ...state, coldFor: key }, action: { kind: 'cold', tokens } }
  }
  return { state, action: null }
}

export function cacheCard(c: StatuslineCache, view: CacheView): string {
  const bits = [`prompt cache ${view.tone}`, `ttl ${c.ttl}`]
  if (c.expiresAt !== undefined) {
    const d = new Date(c.expiresAt)
    bits.push(`expires ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  }
  if (c.recacheTokens !== undefined) bits.push(`re-write ${Math.round(c.recacheTokens / 1000)}k tokens if cold`)
  // The docs do not say whether hit_ratio is a fraction or a percent. A value
  // of 1 or less reads as a fraction.
  if (c.hitRatio !== undefined) bits.push(`hit ratio ${Math.round(c.hitRatio <= 1 ? c.hitRatio * 100 : c.hitRatio)}%`)
  if (c.lastMissCause) bits.push(`last miss: ${c.lastMissCause}`)
  if (c.source === 'inferred') bits.push('estimated from turn timing')
  return bits.join(' · ')
}

// What readCacheFile needs from the engine. register.tsx builds it, because
// the engine interface cannot cross an import.
export type CacheFileHost = {
  sessionId: () => Promise<string>
  runtimeDir: () => Promise<string | undefined>
  readFile: (path: string) => Promise<string>
  run: (argv: string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  // Writes a line the person sees in the transcript.
  report: (text: string) => void
  fail: (error: unknown) => void
}

// The first failure of a load goes to the transcript once, with its reason,
// so a missing segment always has a visible cause.
let hasReportedCacheRead = false

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Source 1: the statusLine stdin JSON that statusline-command.sh writes for
// this session. Null when the file is missing or holds no prompt_cache.
// The engine's file read goes first. When it refuses, `cat` reads the file.
export async function readCacheFile(host: CacheFileHost): Promise<StatuslineCache | null> {
  let path: string
  try {
    const [id, runtime] = await Promise.all([host.sessionId(), host.runtimeDir()])
    path = `${runtime ?? '/tmp'}/chrysaki-statusline/${id}.json`
  } catch (error) {
    host.fail(error)
    return null
  }
  let text: string | null = null
  let reason = ''
  try {
    text = await host.readFile(path)
  } catch (error) {
    reason = `fs.read: ${why(error)}`
    try {
      const r = await host.run(['cat', path], { timeoutMs: 3000 })
      if (r.exitCode === 0) text = r.stdout
      else reason += `, cat exited ${r.exitCode}: ${r.stderr.trim()}`
    } catch (catError) {
      reason += `, cat: ${why(catError)}`
    }
  }
  const parsed = text === null ? null : parseStatuslineCache(text)
  if (parsed === null && !hasReportedCacheRead) {
    hasReportedCacheRead = true
    host.report(`cache segment has no data from ${path} (${text === null ? reason : 'the file holds no prompt_cache'})`)
  }
  return parsed
}
