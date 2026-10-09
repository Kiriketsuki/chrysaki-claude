import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { AccountMenu, CacheAlert, LimitsFetch, CacheView, FirefoxProfile, PendingHandoff, PendingLogin, ShareOffer, StatuslineAccount, StatuslineCache, StatuslineLag, StatuslineGit, StatuslineIdentity, StatuslineOutage, StatuslineRemote, StatuslineUsage, StatuslineWarn, StatuslineCodeks } from '../types'
import { ACCOUNTS_KEY, NEW_PROFILE, SEED_ACCOUNTS, guessWork, isEmail, parseAccounts, parseProfiles, resolvePaths, upsertAccount } from './accounts'
import { cacheView, inferTtl, inferredCache, leadSeconds, nextAlert, readCacheFile } from './cache'
import type { AlertAction, CacheFileHost } from './cache'
import { mergeIdentity, readGit, readIdentity, readInbox, readRemote, usageFrom, usageFromMeasure } from './collect'
import type { Host } from './collect'
import { bandStrips, drawBand } from './draw'
import type { BandData, LiveStrip } from './draw'
import { SWEEP_FRAMES, isRuleLive } from './ledger'
import type { BarStyle } from './format'
import { kilo } from './format'
import { limitsKey, parseSaved, rollUsage, toSaved, withOAuth, withSaved } from './limits'
import { LIVE_MS, fetchLimits, fetchOutage } from './live'
import type { LiveHost } from './live'
import type { OAuthLimits } from './oauth'
import { finishHandoff, pressHandoff, pressResume, refreshResume, watchHandoff } from './handoff'
import type { HandoffHost } from './handoff'
import { HANDOFF_FILE } from './resume'
import { LAG_FILE, lagFrom, warnFrom } from './lagfile'
import { CODEKS_FILE, codeksFrom } from './codeksfile'
import { EMPTY_HISTORY, addSample, addTokens, historyKey, parseHistory } from './history'
import type { UsageHistory } from './history'
import { OFFERED_KEY, artifactUrlFrom, isNewPublish, liveOffer, offerFor, parseOffered, withOffered } from './share'

export { HANDOFF_FILE }

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
const handoff = atom({ plugin: 'chrysaki-statusline', key: 'handoff' } as const, null as PendingHandoff | null)
const resume = atom({ plugin: 'chrysaki-statusline', key: 'resume' } as const, null as string | null)
const accounts = atom({ plugin: 'chrysaki-statusline', key: 'accounts' } as const, [] as StatuslineAccount[])
const profiles = atom({ plugin: 'chrysaki-statusline', key: 'profiles' } as const, [] as FirefoxProfile[])
const accountMenu = atom({ plugin: 'chrysaki-statusline', key: 'accountMenu' } as const, null as AccountMenu | null)
const login = atom({ plugin: 'chrysaki-statusline', key: 'login' } as const, null as PendingLogin | null)
const hintOpen = atom({ plugin: 'chrysaki-statusline', key: 'hintOpen' } as const, false)
const limitsFetch = atom({ plugin: 'chrysaki-statusline', key: 'limitsFetch' } as const, { isBusy: false } as LimitsFetch)
const outage = atom({ plugin: 'chrysaki-statusline', key: 'outage' } as const, null as StatuslineOutage | null)
const lag = atom({ plugin: 'chrysaki-statusline', key: 'lag' } as const, null as StatuslineLag | null)
const warn = atom({ plugin: 'chrysaki-statusline', key: 'warn' } as const, null as StatuslineWarn | null)
const codeks = atom({ plugin: 'chrysaki-statusline', key: 'codeks' } as const, null as StatuslineCodeks | null)
const shareOffer = atom({ plugin: 'chrysaki-statusline', key: 'shareOffer' } as const, null as ShareOffer | null)
const usageHistory = atom({ plugin: 'chrysaki-statusline', key: 'usageHistory' } as const, EMPTY_HISTORY as UsageHistory)
const ctxHistory = atom({ plugin: 'chrysaki-statusline', key: 'ctxHistory' } as const, [] as number[])

// The step of the animated rule. 40 steps of 150 ms make one 6-second cycle.
// Each step repaints the rule Rasters with $.ui.blit. The band does not draw again.
const SWEEP_MS = 150

// The $.store key that keeps the drawer open or closed across sessions.
const HINT_OPEN_KEY = 'hintOpen'

// A login the switcher started gives BROWSER back after this long, even when
// the account never changed.
const LOGIN_WINDOW_MS = 600000

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

// The last identity any session of this process read. After a /clear the
// new session starts with empty state, and the band draws this one until its
// own read lands, so the header never shows empty.
let lastIdentity: StatuslineIdentity | null = null

async function refreshLocal($: EngineInterface): Promise<void> {
  const host = hostOf($)
  const read_ = await readIdentity(host)
  const id = mergeIdentity(read_, (await read($, identity)) ?? lastIdentity)
  lastIdentity = id
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

// The figures at session start: the session's own, with the last saved
// rate-limit reading filling the windows a fresh session has not read yet.
// After this, session.measure pushes every change, so nothing polls usage.
// It runs after the identity read, which names the account.
async function seedUsage($: EngineInterface): Promise<void> {
  try {
    const email = (await read($, identity))?.email ?? 'unknown'
    const [u, raw, now] = await Promise.all([$.session.usage(), $.store.get(limitsKey(email)).catch(() => undefined), $.clock.now()])
    const fresh = usageFrom(u)
    // A hot reload keeps the state. Its windows stand in for any the
    // engine has not read yet.
    await update($, usage, prev => withSaved({
      ...fresh,
      fiveHour: fresh.fiveHour ?? prev?.fiveHour,
      sevenDay: fresh.sevenDay ?? prev?.sevenDay,
      startedAt: fresh.startedAt ?? prev?.startedAt,
    }, parseSaved(raw), now))
  } catch (error) {
    logFailure($, error)
  }
}

// Puts a reading of the OAuth usage endpoint into the band and saves it for
// the next session. The context figures stay the engine's.
async function applyLimits($: EngineInterface, l: OAuthLimits, now: number): Promise<void> {
  await update($, usage, prev => withOAuth(prev, l, now))
  const u = await read($, usage)
  if (u !== null) await saveLimits($, u)
}

function liveHostOf($: EngineInterface): LiveHost {
  return {
    now: async () => $.clock.now(),
    authorize: async () => (await $.session.authorize())?.handle ?? null,
    fetch: async (url, init) => $.http.fetch(url, init),
    after: (ms, fn) => $.clock.after(ms, fn),
    toast: text => { $.ui.toast(text) },
    log: text => { $.ui.log(`chrysaki-statusline: ${text}`, { to: 'debug' }) },
    getFetch: async () => read($, limitsFetch),
    setFetch: async v => { await update($, limitsFetch, () => v) },
    getOutage: async () => read($, outage),
    setOutage: async v => { await update($, outage, () => v) },
  }
}

function refreshLimits($: EngineInterface, isManual: boolean): Promise<void> {
  return fetchLimits(liveHostOf($), isManual, (l, now) => applyLimits($, l, now))
}

function refreshOutage($: EngineInterface): Promise<void> {
  return fetchOutage(liveHostOf($))
}

// Shows a window as reset once its reset time passes. No request is needed.
async function rollLimits($: EngineInterface): Promise<void> {
  const [u, now] = await Promise.all([read($, usage), $.clock.now()])
  if (u === null) return
  const rolled = rollUsage(u, now)
  if (rolled !== u) await update($, usage, () => rolled)
}

// Saves a fresh rate-limit reading for the next session to start from, and
// adds it to the history the sparks draw.
async function saveLimits($: EngineInterface, u: StatuslineUsage): Promise<void> {
  const now = await $.clock.now()
  const saved = toSaved(u, now)
  if (saved === null) return
  try {
    const email = (await read($, identity))?.email ?? 'unknown'
    await $.store.set(limitsKey(email), saved)
    const h = addSample(await read($, usageHistory), u, now)
    await update($, usageHistory, () => h)
    await $.store.set(historyKey(email), h)
  } catch (error) {
    logFailure($, error)
  }
}

// Reads the account's usage history from the store. Another session may have
// added samples since this one last read it.
async function loadHistory($: EngineInterface): Promise<void> {
  try {
    const email = (await read($, identity))?.email ?? 'unknown'
    const raw = await $.store.get(historyKey(email)).catch(() => undefined)
    await update($, usageHistory, () => parseHistory(raw))
  } catch (error) {
    logFailure($, error)
  }
}

function logFailure($: EngineInterface, error: unknown): void {
  $.ui.log(`chrysaki-statusline: refresh failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

// The fast refresh: identity, git and inbox. Hooks await it, because $
// belongs to the dispatch that holds it. A failure goes to the debug log and
// the band keeps its last values.
async function refreshFast($: EngineInterface): Promise<void> {
  try {
    await refreshLocal($)
    await checkLogin($)
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

// Source 1: the statusLine stdin JSON. See readCacheFile in cache.ts.
function cacheHostOf($: EngineInterface): CacheFileHost {
  return {
    sessionId: async () => $.session.id(),
    runtimeDir: async () => $.env.get('XDG_RUNTIME_DIR'),
    readFile: async path => $.fs.read(path),
    run: async (argv, init) => $.process.run(argv, init),
    report: text => { $.ui.log(`chrysaki-statusline: ${text}`, { to: 'transcript' }) },
    fail: error => logFailure($, error),
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
  const fromFile = await readCacheFile(cacheHostOf($))
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

// The engine surface the handoff and resume keys in handoff.ts use.
function handoffHostOf($: EngineInterface): HandoffHost {
  return {
    now: async () => $.clock.now(),
    surface: async () => $.session.surface(),
    getHandoff: async () => read($, handoff),
    setHandoff: async fn => { await update($, handoff, fn) },
    getResume: async () => read($, resume),
    setResume: async path => { await update($, resume, () => path) },
    hasContext: async () => (await read($, usage))?.ctxPercent !== undefined,
    runCommand: async command => { await $.command.run({ command }) },
    submit: async text => { await $.prompt.submit({ text, asUser: true }) },
    run: async (argv, timeoutMs) => $.process.run(argv, timeoutMs === undefined ? undefined : { timeoutMs }),
    home: async () => $.env.get('HOME'),
    configDir: async () => $.env.get('CLAUDE_CONFIG_DIR'),
    list: async dir => $.fs.list(dir),
    mtime: async path => (await $.fs.stat(path)).mtimeMs,
    exists: async path => $.fs.exists(path),
    copy: async (text, surface) => (await $.ui.copy(surface === null ? { text } : { text, surface })).isCopied,
    promptText: async () => (await $.prompt.read()).text,
    fill: async text => (await $.prompt.fill({ text, mode: 'replace' })).isFilled,
    toast: (text, timeoutMs) => { $.ui.toast(text, timeoutMs === undefined ? undefined : { timeoutMs }) },
    fail: error => logFailure($, error),
  }
}

// --- Account switcher -----------------------------------------------------------

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadAccounts($: EngineInterface): Promise<void> {
  const raw = await $.store.get(ACCOUNTS_KEY).catch(() => undefined)
  const list = parseAccounts(raw) ?? [...SEED_ACCOUNTS]
  await update($, accounts, () => list)
}

async function saveAccounts($: EngineInterface, list: StatuslineAccount[]): Promise<void> {
  await update($, accounts, () => list)
  try {
    await $.store.set(ACCOUNTS_KEY, list)
  } catch (error) {
    $.ui.toast(`The account list did not save: ${message(error)}`)
  }
}

// The Firefox user profiles, from bin/firefox-profiles.
async function readProfiles($: EngineInterface): Promise<FirefoxProfile[]> {
  const r = await $.process.run([`${$.plugin.root}/bin/firefox-profiles`], { timeoutMs: 5000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`)
  return parseProfiles(r.stdout)
}

// Opens the dropdown, or closes it when it is open. Each open reads the
// Firefox profiles again, so a profile made since then shows up.
async function toggleAccounts($: EngineInterface): Promise<void> {
  if ((await read($, accountMenu)) !== null) {
    await update($, accountMenu, () => null)
    return
  }
  await update($, accountMenu, () => ({ mode: 'pick', draftEmail: '', draftProfile: '' }))
  try {
    const list = await readProfiles($)
    await update($, profiles, () => list)
    const current = await read($, accounts)
    const resolved = resolvePaths(current, list)
    if (JSON.stringify(resolved) !== JSON.stringify(current)) await saveAccounts($, resolved)
  } catch (error) {
    $.ui.toast(`The Firefox profile list failed: ${message(error)}`)
  }
}

async function setMenu($: EngineInterface, change: (m: AccountMenu) => AccountMenu): Promise<void> {
  await update($, accountMenu, m => (m === null ? null : change(m)))
}

// Gives BROWSER back and clears the profile the login used.
async function endLogin($: EngineInterface): Promise<void> {
  const p = await read($, login)
  if (p === null) return
  await $.env.set('BROWSER', p.prevBrowser ?? undefined)
  await $.env.set('CHRYSAKI_LOGIN_PROFILE', undefined)
  await update($, login, () => null)
}

// Ends a pending login once the account changed, or once the window lapsed.
async function checkLogin($: EngineInterface): Promise<void> {
  const p = await read($, login)
  if (p === null) return
  const [id, now] = await Promise.all([read($, identity), $.clock.now()])
  if (id?.email.toLowerCase() === p.email) {
    await endLogin($)
    $.ui.toast(`Signed in as ${p.email}.`)
    return
  }
  if (now - p.since > LOGIN_WINDOW_MS) await endLogin($)
}

// Switches to an account: BROWSER points at bin/open-in-profile with the
// account's Firefox profile, then /login runs. The OAuth page opens in the
// profile that holds the account's claude.ai session.
async function switchAccount($: EngineInterface, email: string): Promise<void> {
  const a = (await read($, accounts)).find(x => x.email === email)
  await update($, accountMenu, () => null)
  if (a === undefined) return
  if ((await read($, identity))?.email.toLowerCase() === a.email) {
    $.ui.toast(`You are signed in as ${a.email} already.`)
    return
  }
  if (a.path === '' || !(await $.fs.exists(a.path))) {
    $.ui.toast(`No Firefox profile folder is set for ${a.email}. Add the account again and pick its profile.`, { timeoutMs: 8000 })
    return
  }
  const [prev, now, pending] = await Promise.all([$.env.get('BROWSER'), $.clock.now(), read($, login)])
  // A second switch during a pending login keeps the first saved value.
  const prevBrowser = pending !== null ? pending.prevBrowser : prev ?? null
  await $.env.set('CHRYSAKI_LOGIN_PROFILE', a.path)
  await $.env.set('BROWSER', `${$.plugin.root}/bin/open-in-profile`)
  await update($, login, () => ({ email: a.email, since: now, prevBrowser }))
  $.ui.toast(`Signing in as ${a.email}. The login page opens in the Firefox profile ${a.profile}.`, { timeoutMs: 8000 })
  try {
    await $.command.run({ command: 'login' })
  } catch (error) {
    await endLogin($)
    $.ui.toast(`/login did not start: ${message(error)}`)
  }
}

// The profile pick of a new account. The last option opens Firefox, where
// the profile menu makes a new profile. The Firefox CLI has no flag for it.
async function pickDraftProfile($: EngineInterface, value: string): Promise<void> {
  if (value !== NEW_PROFILE) {
    await setMenu($, m => ({ ...m, draftProfile: value }))
    return
  }
  // A bare `firefox` opens the profile installs.ini names, which can be any
  // account's. The profile of the account in use is the safe one to open.
  const email = (await read($, identity))?.email.toLowerCase() ?? ''
  const list = await read($, accounts)
  const path = (list.find(a => a.email === email) ?? list.find(a => a.path !== ''))?.path ?? ''
  try {
    await $.process.run(path === '' ? ['setsid', '-f', 'firefox'] : ['setsid', '-f', 'firefox', '--profile', path], { timeoutMs: 5000 })
  } catch (error) {
    logFailure($, error)
  }
  $.ui.toast('Make the profile from the Firefox profile menu, then open accounts again to pick it.', { timeoutMs: 10000 })
}

async function saveDraft($: EngineInterface): Promise<void> {
  const m = await read($, accountMenu)
  if (m === null) return
  const email = m.draftEmail.trim().toLowerCase()
  const profile = (await read($, profiles)).find(p => p.path === m.draftProfile)
  if (!isEmail(email)) {
    $.ui.toast('Type the account email first.')
    return
  }
  if (profile === undefined) {
    $.ui.toast('Pick the Firefox profile that holds this account.')
    return
  }
  await saveAccounts($, upsertAccount(await read($, accounts), { email, profile: profile.name, path: profile.path, isWork: guessWork(email) }))
  await setMenu($, () => ({ mode: 'pick', draftEmail: '', draftProfile: '' }))
  $.ui.toast(`Saved ${email} with the Firefox profile ${profile.name}.`)
}

// --- Share offer ---------------------------------------------------------------

// A new artifact: a `p: share` key on the band and a desktop notice. Either
// opens the artifact in the Firefox profile of the account that owns it.
async function offerShare($: EngineInterface, url: string): Promise<void> {
  const [raw, id, list, now] = await Promise.all([$.store.get(OFFERED_KEY).catch(() => undefined), read($, identity), read($, accounts), $.clock.now()])
  const offered = parseOffered(raw)
  // The paths fill in when the account dropdown opens. A list with a gap reads the profiles now.
  const known = list.every(a => a.path !== '') ? list : resolvePaths(list, await readProfiles($).catch(() => []))
  const offer = offerFor(url, id?.email ?? '', known, offered, now)
  if (offer === null) return
  await update($, shareOffer, () => offer)
  await $.store.set(OFFERED_KEY, withOffered(offered, url)).catch(error => logFailure($, error))
  $.ui.toast(`New artifact. Press p on the band, or click the desktop notice, to share it with ${offer.partner}.`, { timeoutMs: 8000 })
  await $.process.run(['setsid', '-f', `${$.plugin.root}/bin/share-notify`, offer.path, offer.url, offer.partner], { timeoutMs: 5000 })
    .catch(error => logFailure($, error))
}

async function openShare($: EngineInterface): Promise<void> {
  const o = await read($, shareOffer)
  if (o === null) return
  await update($, shareOffer, () => null)
  const argv = o.path === '' ? ['setsid', '-f', 'xdg-open', o.url] : ['setsid', '-f', 'firefox', '--profile', o.path, '-new-tab', o.url]
  await $.process.run(argv, { timeoutMs: 5000 }).catch(error => $.ui.toast(`The artifact did not open: ${message(error)}. ${o.url}`, { timeoutMs: 10000 }))
}

// --- Lag badge -------------------------------------------------------------------

// Reads the chrysaki-lag state file. Without the mod, the file never appears.
async function refreshLag($: EngineInterface): Promise<void> {
  const [dir, now] = await Promise.all([$.env.get('XDG_RUNTIME_DIR'), $.clock.now()])
  const text = await $.fs.read(`${dir ?? '/tmp'}/${LAG_FILE}`).catch(() => null)
  const next = typeof text === 'string' ? lagFrom(text, now) : null
  if (JSON.stringify(next) !== JSON.stringify(await read($, lag))) await update($, lag, () => next)
  const nextWarn = typeof text === 'string' ? warnFrom(text, now) : null
  if (JSON.stringify(nextWarn) !== JSON.stringify(await read($, warn))) await update($, warn, () => nextWarn)
}

// The badge opens /lag when chrysaki-lag is loaded, else a toast of the causes.
async function openLag($: EngineInterface, l: StatuslineLag | null): Promise<void> {
  if ((await $.command.list().catch(() => [])).some(c => c.name === 'lag')) await $.command.run({ command: 'lag' })
  else if (l !== null) $.ui.toast(l.top.length > 0 ? l.top.join(' · ') : 'No cause stands out.', { timeoutMs: 8000 })
}

// --- codeKs badge ----------------------------------------------------------------

// Reads the codeKs heartbeat. The badge shows while the codeks mod is loaded or
// a heartbeat exists, so a stopped service shows as off and never disappears.
async function refreshCodeks($: EngineInterface): Promise<void> {
  const [dir, now, commands] = await Promise.all([$.env.get('XDG_RUNTIME_DIR'), $.clock.now(), $.command.list().catch(() => [])])
  const text = await $.fs.read(`${dir ?? '/tmp'}/${CODEKS_FILE}`).catch(() => null)
  const next = codeksFrom(typeof text === 'string' ? text : null, now, commands.some(c => c.name === 'codex'))
  if (JSON.stringify(next) !== JSON.stringify(await read($, codeks))) await update($, codeks, () => next)
}

// The badge opens the codeKs panel when the codeks mod is loaded.
async function openCodeks($: EngineInterface): Promise<void> {
  if ((await $.command.list().catch(() => [])).some(c => c.name === 'codex')) await $.command.run({ command: 'codex', args: 'panel' })
  else $.ui.toast('codeKs runs, but its mod is not loaded here. Run: ./install.sh --claude-mod', { timeoutMs: 8000 })
}

// --- Hint drawer ----------------------------------------------------------------

async function loadHintOpen($: EngineInterface): Promise<void> {
  const v = await $.store.get(HINT_OPEN_KEY).catch(() => undefined)
  await update($, hintOpen, () => v === true)
}

async function toggleHint($: EngineInterface): Promise<void> {
  const next = !(await read($, hintOpen))
  await update($, hintOpen, () => next)
  await $.store.set(HINT_OPEN_KEY, next).catch(error => logFailure($, error))
}

// The outage badge opens the incident page in the browser.
async function openOutage($: EngineInterface, o: StatuslineOutage | null): Promise<void> {
  if (o === null) return
  try {
    await $.process.run(['xdg-open', o.url], { timeoutMs: 5000 })
  } catch {
    $.ui.toast(`${o.name}: ${o.url}`, { timeoutMs: 10000 })
  }
}

// The ctx button: the context tab of the chrysaki-insight pane when that mod
// is loaded. Without it, a toast of the largest used categories.
async function toastBreakdown($: EngineInterface): Promise<void> {
  try {
    if ((await $.command.list()).some(c => c.name === 'insight')) {
      await $.command.run({ command: 'insight', args: 'context' })
      return
    }
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

// What startup needs from the closure of register: the options and the
// flags the hooks keep.
type Runtime = {
  cacheConfig: CacheConfig
  isAnimated: boolean
  isRuleAnimated: boolean
  // Reads and clears the flag that forces the next GitHub read.
  takeRemoteDue: () => boolean
  isTurnRunning: () => boolean
  // Moves the rule sweep one frame. Returns the new frame and the rules
  // the last band drew, or null when no rule is live.
  stepSweep: () => { frame: number; live: LiveRules | null }
}

// The Raster rows of the last band drawn, and the site that holds them.
type LiveRules = { requestId: string; strips: LiveStrip[] }

// Repaints the live rules at the next sweep frame. A blit the surface
// refuses, such as one before the band mounts, costs nothing. The next draw
// records the rules again.
async function sweepRules($: EngineInterface, rt: Runtime): Promise<void> {
  const { frame, live } = rt.stepSweep()
  if (live === null) return
  await Promise.all(live.strips.map(r => $.ui.blit({ requestId: live.requestId, key: r.key, cells: r.frame(frame) }).catch(() => ({}))))
}

// Reads every value the band draws and starts the timers. session.start
// runs it, and so does the first draw after a /clear. It cancels the timers
// of the last run and returns the new ones, so a reseed never doubles them.
function startup($: EngineInterface, rt: Runtime, old: readonly Timer[]): Timer[] {
  for (const t of old) t.cancel()
  $.clock.after(0, () => { void loadAccounts($).catch(error => logFailure($, error)) })
  $.clock.after(0, () => { void loadHintOpen($).catch(error => logFailure($, error)) })
  $.clock.after(0, () => {
    void refreshFast($)
      .then(() => loadHistory($))
      .then(() => seedUsage($))
      .then(() => refreshLimits($, false))
      .then(() => refreshRemote($, true))
      .catch(error => logFailure($, error))
  })
  $.clock.after(0, () => { void refreshOutage($) })
  $.clock.after(0, () => { void refreshGitCommand($).then(() => tickCache($, rt.cacheConfig, rt.isTurnRunning())) })
  // The resume key looks at the clipboard on the same clock as the cache.
  $.clock.after(0, () => { void refreshResume(handoffHostOf($)) })
  $.clock.after(0, () => { void refreshLag($) })
  $.clock.after(0, () => { void refreshCodeks($) })
  return [
    $.clock.every(REFRESH_MS, () => {
      const isForced = rt.takeRemoteDue()
      void rollLimits($)
      void refreshSlow($, isForced).then(() => refreshGitCommand($))
    }),
    // The usage endpoint and the status page answer without a turn, so an
    // idle session stays current too.
    $.clock.every(LIVE_MS, () => {
      void refreshLimits($, false)
      void refreshOutage($)
    }),
    $.clock.every(CACHE_TICK_MS, () => { void tickCache($, rt.cacheConfig, rt.isTurnRunning()) }),
    $.clock.every(CACHE_TICK_MS, () => { void refreshResume(handoffHostOf($)) }),
    $.clock.every(CACHE_TICK_MS, () => { void refreshLag($) }),
    $.clock.every(CACHE_TICK_MS, () => { void refreshCodeks($) }),
    ...(rt.isAnimated ? [$.clock.every(ANIMATE_MS, () => { void update($, phase, n => (n + 1) % 36) })] : []),
    ...(rt.isRuleAnimated ? [$.clock.every(SWEEP_MS, () => { void sweepRules($, rt) })] : []),
  ]
}

export const register: Register = (on, options) => {
  const barStyle = String(options.barStyle ?? 'line') as BarStyle
  const isAnimated = String(options.animate ?? 'off') === 'on'
  const isRuleAnimated = String(options.ruleAnimation ?? 'on') === 'on'
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

  // The repeating timers of the current session. A start cancels the last
  // set, so a reseed after /clear never doubles them.
  let clocks: Timer[] = []
  // Set when a /clear or a resume ends the session. No session.start fires
  // for the next one, so the band's next draw starts it.
  let isReseedDue = false
  let reseedAt = 0
  // The sweep frame lives here, not in $.state: a state write draws the band
  // again, and the sweep only repaints the rule cells.
  let sweepFrame = 0
  let liveRules: LiveRules | null = null
  const rt: Runtime = {
    cacheConfig,
    isAnimated,
    isRuleAnimated,
    takeRemoteDue: () => {
      const was = isRemoteDue
      isRemoteDue = false
      return was
    },
    isTurnRunning: () => isTurnRunning,
    stepSweep: () => {
      sweepFrame = (sweepFrame + 1) % SWEEP_FRAMES
      return { frame: sweepFrame, live: liveRules }
    },
  }

  on('session.start', async ($, e, next) => {
    const done = await next(e)
    // The bash statusline reads this and prints nothing while the mod draws.
    await $.env.set('CHRYSAKI_STATUSLINE_MOD', '1')
    isReseedDue = false
    clocks = startup($, rt, clocks)
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') isReseedDue = true
    return next(e)
  })

  // The engine pushes context, rate-limit and cost figures here after each turn.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, usage, prev => rollUsage(usageFromMeasure(e, prev), now))
    if (e.changed.includes('context')) await update($, ctxHistory, h => addTokens(h, e.context?.tokens))
    if (e.changed.includes('rateLimits')) await saveLimits($, usageFrom(e))
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
      await finishHandoff(handoffHostOf($))
      await refreshFast($)
      await tickCache($, cacheConfig, isTurnRunning)
      await refreshResume(handoffHostOf($))
    }
    return done
  })

  // A git command from the model moves the branch line at once.
  // /context-handoff, typed or pressed, starts the watch for its file.
  on('command.run', { command: 'context-handoff' }, async ($, e, next) => {
    await watchHandoff(handoffHostOf($), null)
    return next(e)
  })

  // /login, from the switcher or typed, changes the account at its end.
  on('command.run', { command: 'login' }, async ($, e, next) => {
    const done = await next(e)
    await refreshFast($)
    return done
  })

  on('prompt.submit', async ($, e, next) => {
    if (/^\s*\/context-handoff\b/.test(e.text)) await watchHandoff(handoffHostOf($), null)
    return next(e)
  })

  // The handoff skill writes its file with Write. The path is the one to copy.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && HANDOFF_FILE.test(e.file_path)) {
      const path = e.file_path
      if ((await read($, handoff)) !== null) await update($, handoff, p => (p === null ? null : { ...p, path }))
    }
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) await refreshFast($)
    if (/\bgh\b|\bgit push\b/.test(e.command)) isRemoteDue = true
    return ran
  })

  // A publish that makes a new artifact offers the share with the partner account.
  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    const url = ran.deny === undefined && ran.isError !== true && isNewPublish(e) ? artifactUrlFrom(ran.text ?? '') : null
    if (url !== null) await offerShare($, url)
    return ran
  })

  // The hint text under the prompt as a drawer. The chevron left of the band
  // header opens and closes it. Closed, the hint draws nothing. The engine
  // draws the mode label before it, outside any mod hook, so that label stays.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (await read($, hintOpen)) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text />
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      liveRules = null
      return next(e)
    }
    const below = await next(e)
    const table = $.ui.resolve(e)
    const [u, id, g, r, n, ph, now, home] = await Promise.all([
      read($, usage), read($, identity), read($, git), read($, remote), read($, inbox),
      isAnimated ? read($, phase) : Promise.resolve(0), $.clock.now(), $.env.get('HOME'),
    ])
    const [c, cv, hasGit, busyHandoff, resumePath] = await Promise.all([
      read($, cache), read($, shownCache), read($, hasGitCommand), read($, handoff), read($, resume),
    ])
    const [accountList, profileList, menu, pendingLogin, isHintOpen] = await Promise.all([
      read($, accounts), read($, profiles), read($, accountMenu), read($, login), read($, hintOpen),
    ])
    // The first draw of a session after a /clear finds empty state. It starts
    // the reads itself, at most once in 10 seconds, and draws the last known
    // identity meanwhile.
    if ((isReseedDue || id === null) && now - reseedAt > 10000) {
      isReseedDue = false
      reseedAt = now
      clocks = startup($, rt, clocks)
    }
    const [fetchState, down, offer, lagNow, warnNow, codeksNow] = await Promise.all([read($, limitsFetch), read($, outage), read($, shareOffer), read($, lag), read($, warn), read($, codeks)])
    const [hist, ctxHist] = await Promise.all([read($, usageHistory), read($, ctxHistory)])
    const data: BandData = {
      usage: u, identity: id ?? lastIdentity, git: g, remote: r, inbox: n, phase: ph, now, home: home ?? '',
      isLimitsBusy: fetchState.isBusy,
      onRefreshLimits: () => { void refreshLimits($, true) },
      outage: down,
      onOutage: () => { void openOutage($, down) },
      share: liveOffer(offer, now),
      onShare: () => { void openShare($) },
      lag: lagNow,
      warn: warnNow,
      onLag: () => { void openLag($, lagNow) },
      codeks: codeksNow,
      onCodeks: () => { void openCodeks($) },
      history: hist, ctxHistory: ctxHist,
      columns: e.props.bodyColumns, surface: e.surface, barStyle, isRuleAnimated, sweep: sweepFrame, usdToSgd,
      onContext: () => { void toastBreakdown($) },
      cache: c, cacheView: cv, hasGitCommand: hasGit,
      onGit: () => { void openGitPane($) },
      isHandingOff: busyHandoff !== null,
      onHandoff: () => { void pressHandoff(handoffHostOf($), e.surface) },
      resumePath,
      onResume: () => { void pressResume(handoffHostOf($)) },
      accounts: accountList,
      profiles: profileList,
      accountMenu: menu,
      loginEmail: pendingLogin?.email ?? null,
      onAccounts: () => { void toggleAccounts($) },
      onPickAccount: email => { void switchAccount($, email) },
      onAddAccount: () => { void setMenu($, m => ({ ...m, mode: 'add' })) },
      onCancelAdd: () => { void setMenu($, () => ({ mode: 'pick', draftEmail: '', draftProfile: '' })) },
      onDraftEmail: text => { void setMenu($, m => ({ ...m, draftEmail: text })) },
      onDraftProfile: value => { void pickDraftProfile($, value) },
      onSaveAccount: () => { void saveDraft($) },
      isHintOpen,
      onToggleHint: () => { void toggleHint($) },
    }
    liveRules = isRuleLive(table, data) ? { requestId: e.requestId, strips: bandStrips(data) } : null
    const band = drawBand(table, data)
    const { Box } = table
    return below ? <Box flexDirection="column">{band}{below}</Box> : band
  })
}
