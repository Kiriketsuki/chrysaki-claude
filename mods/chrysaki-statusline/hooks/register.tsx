import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheAlert, CacheView, StatuslineCache, StatuslineGit, StatuslineIdentity, StatuslineRemote, StatuslineUsage } from '../types'
import { cacheView, inferTtl, inferredCache, leadSeconds, nextAlert, parseStatuslineCache } from './cache'
import type { AlertAction } from './cache'
import { readGit, readIdentity, readInbox, readRemote, usageFrom, usageFromMeasure } from './collect'
import type { Host } from './collect'
import { drawBand } from './draw'
import type { BarStyle } from './format'
import { kilo } from './format'

const usage = atom({ plugin: 'chrysaki-statusline', key: 'usage' } as const, null as StatuslineUsage | null)
const identity = atom({ plugin: 'chrysaki-statusline', key: 'identity' } as const, null as StatuslineIdentity | null)
const git = atom({ plugin: 'chrysaki-statusline', key: 'git' } as const, null as StatuslineGit | null)
const remote = atom({ plugin: 'chrysaki-statusline', key: 'remote' } as const, null as StatuslineRemote | null)
const inbox = atom({ plugin: 'chrysaki-statusline', key: 'inbox' } as const, 0)
const phase = atom({ plugin: 'chrysaki-statusline', key: 'phase' } as const, 0)
const cache = atom({ plugin: 'chrysaki-statusline', key: 'cache' } as const, null as StatuslineCache | null)
const shownCache = atom({ plugin: 'chrysaki-statusline', key: 'cacheView' } as const, null as CacheView | null)
const cacheAlert = atom({ plugin: 'chrysaki-statusline', key: 'cacheAlert' } as const, {} as CacheAlert)
const hasGitCommand = atom({ plugin: 'chrysaki-statusline', key: 'hasGitCommand' } as const, false)

const ANIMATE_MS = 2000
const REFRESH_MS = 60000
const REMOTE_MAX_AGE_MS = 300000
// The cache segment's clock. 15 seconds keeps idle wakeups rare.
const CACHE_TICK_MS = 15000

export type CacheConfig = { lead: string; minTokens: number; isDesktopNotify: boolean }

// The engine surface the collectors in collect.ts use.
function hostOf($: EngineInterface): Host {
  return {
    // Each wrapper is async, so a call that throws becomes a rejection the
    // collectors can catch.
    run: async (argv, init) => $.process.run(argv, init),
    readFile: async path => $.fs.read(path),
    exists: async path => $.fs.exists(path),
    model: async () => $.session.model(),
    version: async () => (await $.session.version()).version,
    cwd: async () => $.session.cwd(),
    home: async () => $.env.get('HOME'),
    configDir: async () => $.env.get('CLAUDE_CONFIG_DIR'),
  }
}

async function refreshLocal($: EngineInterface): Promise<void> {
  const host = hostOf($)
  const id = await readIdentity(host)
  await update($, identity, () => id)
  const [g, n] = await Promise.all([readGit(host, id.cwd), readInbox(host, id.cwd)])
  await update($, git, () => g)
  await update($, inbox, () => n)
}

async function refreshRemote($: EngineInterface, isForced: boolean): Promise<void> {
  const g = await read($, git)
  const id = await read($, identity)
  if (g === null || id === null || g.repoPath === '') return
  const now = await $.clock.now()
  const last = await read($, remote)
  if (!isForced && last !== null && now - last.fetchedAt < REMOTE_MAX_AGE_MS) return
  const r = await readRemote(hostOf($), g, id.cwd, now)
  await update($, remote, () => r)
}

async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    await update($, usage, () => usageFrom(u))
  } catch {
    // The band keeps its last figures until the next session.measure.
  }
}

function logFailure($: EngineInterface, error: unknown): void {
  $.ui.log(`chrysaki-statusline: refresh failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

// The fast refresh: identity, git, inbox and usage. Hooks await it, because
// $ belongs to the dispatch that holds it. A failure goes to the debug log
// and the band keeps its last values.
async function refreshFast($: EngineInterface): Promise<void> {
  try {
    await refreshLocal($)
    await refreshUsage($)
  } catch (error) {
    logFailure($, error)
  }
}

// The slow refresh adds GitHub. Only the timers from session.start run it,
// so no hook waits on gh.
async function refreshSlow($: EngineInterface, isRemoteForced: boolean): Promise<void> {
  await refreshFast($)
  try {
    await refreshRemote($, isRemoteForced)
  } catch (error) {
    logFailure($, error)
  }
}

// Source 1: the statusLine stdin JSON that statusline-command.sh writes for
// this session. Null when the file is missing or holds no prompt_cache.
async function readCacheFile($: EngineInterface): Promise<StatuslineCache | null> {
  try {
    const [id, runtime] = await Promise.all([$.session.id(), $.env.get('XDG_RUNTIME_DIR')])
    const path = `${runtime ?? '/tmp'}/chrysaki-statusline/${id}.json`
    if (!(await $.fs.exists(path))) return null
    return parseStatuslineCache(await $.fs.read(path))
  } catch {
    return null
  }
}

// Source 2: the TTL from the documented overrides, the settings and the plan.
async function currentTtl($: EngineInterface): Promise<'5m' | '1h'> {
  const [force5m, ttlEnv, enable1h, settings, u] = await Promise.all([
    $.env.get('FORCE_PROMPT_CACHING_5M'),
    $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
    $.env.get('ENABLE_PROMPT_CACHING_1H'),
    $.settings.read().catch(() => ({})),
    read($, usage),
  ])
  const maxRateLimit = Math.max(u?.fiveHour?.percent ?? 0, u?.sevenDay?.percent ?? 0)
  const ttlSetting = (settings as Record<string, unknown>).promptCacheTtl
  return inferTtl({ force5m, ttlEnv, ttlSetting, enable1h, maxRateLimit })
}

async function sendAlert($: EngineInterface, action: AlertAction, config: CacheConfig): Promise<void> {
  const k = `${Math.round(action.tokens / 1000)}k`
  const title = action.kind === 'warn' ? `Prompt cache cools in ${action.minutes} min` : 'Prompt cache went cold'
  const body = `Next turn re-writes ${k} tokens`
  $.ui.toast(`${title}. ${body}.`, { timeoutMs: 8000 })
  if (!config.isDesktopNotify) return
  try {
    await $.process.run(['notify-send', '-a', 'Claude Code', '-i', 'dialog-warning', title, body], { timeoutMs: 5000 })
  } catch (error) {
    logFailure($, error)
  }
}

// Recomputes the segment. It writes state only when the shown value changes,
// and it raises at most one alert per warm period.
async function tickCache($: EngineInterface, config: CacheConfig, isTurnRunning: boolean): Promise<void> {
  const fromFile = await readCacheFile($)
  if (fromFile !== null) {
    const prev = await read($, cache)
    if (JSON.stringify(prev) !== JSON.stringify(fromFile)) await update($, cache, () => fromFile)
  }
  const c = await read($, cache)
  const now = await $.clock.now()
  const view = cacheView(c, now, c === null ? 0 : leadSeconds(config.lead, c.ttl))
  const shown = await read($, shownCache)
  if (JSON.stringify(shown) !== JSON.stringify(view)) await update($, shownCache, () => view)
  if (c === null || view === null) return
  const decision = nextAlert(await read($, cacheAlert), { cache: c, view, now, isTurnRunning, minTokens: config.minTokens })
  if (decision.action === null) return
  await update($, cacheAlert, () => decision.state)
  await sendAlert($, decision.action, config)
}

async function refreshGitCommand($: EngineInterface): Promise<void> {
  try {
    const isThere = (await $.command.list()).some(c => c.name === 'git')
    if (isThere !== (await read($, hasGitCommand))) await update($, hasGitCommand, () => isThere)
  } catch (error) {
    logFailure($, error)
  }
}

async function openGitPane($: EngineInterface): Promise<void> {
  try {
    await $.command.run({ command: 'git' })
  } catch (error) {
    $.ui.toast(`The /git command failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// The ctx button: the largest used categories, as /context lists them.
async function toastBreakdown($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const rows = (u.context.breakdown?.categories ?? [])
      .filter(c => c.kind === 'used')
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 4)
      .map(c => `${c.name} ${kilo(c.tokens)}`)
    $.ui.toast(rows.length > 0 ? `Context: ${rows.join(' · ')}` : 'Context: no breakdown yet.', { timeoutMs: 8000 })
  } catch (error) {
    $.ui.toast(`Context breakdown failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const register: Register = (on, options) => {
  const barStyle = String(options.barStyle ?? 'wave') as BarStyle
  const isAnimated = String(options.animate ?? 'on') === 'on'
  const usdToSgd = Number(options.usdToSgd ?? '1.35') || 1.35
  // Set when the model pushes or calls gh. The next slow refresh then skips
  // the five-minute cache. A reload clears it, which costs one late update.
  let isRemoteDue = false
  // True from a main-thread request until its turn completes. A reload during
  // a turn clears it, which only allows one early alert.
  let isTurnRunning = false
  const cacheConfig: CacheConfig = {
    lead: String(options.cacheWarnLead ?? 'auto'),
    minTokens: Number(options.cacheMinTokens ?? '20000') || 20000,
    isDesktopNotify: String(options.desktopNotify ?? 'on') === 'on',
  }

  on('session.start', async ($, e, next) => {
    const done = await next(e)
    // The bash statusline reads this and prints nothing while the mod draws.
    await $.env.set('CHRYSAKI_STATUSLINE_MOD', '1')
    $.clock.after(0, () => { void refreshSlow($, true) })
    $.clock.every(REFRESH_MS, () => {
      const isForced = isRemoteDue
      isRemoteDue = false
      void refreshSlow($, isForced).then(() => refreshGitCommand($))
    })
    $.clock.after(0, () => { void refreshGitCommand($).then(() => tickCache($, cacheConfig, isTurnRunning)) })
    $.clock.every(CACHE_TICK_MS, () => { void tickCache($, cacheConfig, isTurnRunning) })
    if (isAnimated) $.clock.every(ANIMATE_MS, () => { void update($, phase, n => (n + 1) % 36) })
    return done
  })

  // The engine pushes context, rate-limit and cost figures here after each turn.
  on('session.measure', async ($, e, next) => {
    await update($, usage, prev => usageFromMeasure(e, prev))
    return next(e)
  })

  // Source 2: each main-thread request renews the cache from its start.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    isTurnRunning = true
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (result.usage !== null && (await read($, cache))?.source !== 'statusline') {
      const fresh = inferredCache(startedAt, await currentTtl($), result.usage)
      await update($, cache, () => fresh)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      isTurnRunning = false
      await refreshFast($)
      await tickCache($, cacheConfig, isTurnRunning)
    }
    return done
  })

  // A git command from the model moves the branch line at once.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) await refreshFast($)
    if (/\bgh\b|\bgit push\b/.test(e.command)) isRemoteDue = true
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e)
    const table = $.ui.resolve(e)
    const Raster = 'Raster' in table ? table.Raster : undefined
    const [u, id, g, r, n, ph, now, home] = await Promise.all([
      read($, usage), read($, identity), read($, git), read($, remote), read($, inbox),
      isAnimated ? read($, phase) : Promise.resolve(0), $.clock.now(), $.env.get('HOME'),
    ])
    const [c, cv, hasGit] = await Promise.all([read($, cache), read($, shownCache), read($, hasGitCommand)])
    const band = drawBand(table, Raster, {
      usage: u, identity: id, git: g, remote: r, inbox: n, phase: ph, now, home: home ?? '',
      columns: e.props.bodyColumns, barStyle, usdToSgd,
      onContext: () => { void toastBreakdown($) },
      cache: c, cacheView: cv, hasGitCommand: hasGit,
      onGit: () => { void openGitPane($) },
    })
    const { Box } = table
    return below ? <Box flexDirection="column">{band}{below}</Box> : band
  })
}
