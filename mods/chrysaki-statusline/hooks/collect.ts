// Reads what the band draws: git, GitHub and the vault through host
// commands, and the usage figures the engine pushes. Nothing here runs
// while the band draws. The hooks call these on events and timers.

import type { ProcessRunInit, ProcessRunResult, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { StatuslineGit, StatuslineIdentity, StatuslineRemote, StatuslineUsage, StatuslineWindow, PersonalConfig } from '../types'
import { inboxDepth, parseShortstat, repoPathFromRemote } from './format'
import { configDirFor } from './personal'

// What the collectors need from the engine. register.tsx builds it from $,
// because the engine allows $ only in functions of the hooks module itself.
export type Host = {
  run: (argv: string[], init: ProcessRunInit) => Promise<ProcessRunResult>
  readFile: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  model: () => Promise<string>
  version: () => Promise<string>
  cwd: () => Promise<string>
  home: () => Promise<string | undefined>
  configDir: () => Promise<string | undefined>
}

const RUN_TIMEOUT_MS = 10000
const GH_TIMEOUT_MS = 15000

// Runs a command and answers its stdout, or null when it fails to run or
// exits non-zero. The band shows a blank segment for a null.
async function out(host: Host, argv: string[], cwd: string, env?: Record<string, string>): Promise<string | null> {
  try {
    // An empty cwd is not a directory. Leave it out and run in the session's own.
    const init = { env, timeoutMs: argv[0] === 'gh' ? GH_TIMEOUT_MS : RUN_TIMEOUT_MS, ...(cwd === '' ? {} : { cwd }) }
    const r = await host.run(argv, init)
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

function toWindow(percentUsed: number, resetsAt: string | undefined): StatuslineWindow {
  const at = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt)
  return { percent: Math.floor(percentUsed), resetsAt: Number.isNaN(at) ? undefined : at }
}

export function usageFrom(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'> & { startedAt?: number }): StatuslineUsage {
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const seven = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    ctxPercent: u.context.percent,
    ctxTokens: u.context.tokens,
    ctxWindow: u.context.window,
    fiveHour: five === undefined ? undefined : toWindow(five.percentUsed, five.resetsAt),
    sevenDay: seven === undefined ? undefined : toWindow(seven.percentUsed, seven.resetsAt),
    costUsd: u.cost?.usd,
    startedAt: u.startedAt,
  }
}

// A measurement with no reading for a window keeps the previous one, so a
// window seeded from the store survives the first context-only measurement.
export function usageFromMeasure(e: SessionMeasureInput, previous: StatuslineUsage | null): StatuslineUsage {
  const u = usageFrom(e)
  return { ...u, fiveHour: u.fiveHour ?? previous?.fiveHour, sevenDay: u.sevenDay ?? previous?.sevenDay, startedAt: previous?.startedAt }
}

// A field the engine could not answer keeps its last value. Right after a
// /clear a read can come back empty for a moment.
export function mergeIdentity(next: StatuslineIdentity, prev: StatuslineIdentity | null): StatuslineIdentity {
  if (prev === null) return next
  return {
    ...next,
    model: next.model || prev.model,
    version: next.version || prev.version,
    cwd: next.cwd || prev.cwd,
    email: next.email === 'unknown' ? prev.email : next.email,
  }
}

export async function readIdentity(host: Host, personal: PersonalConfig): Promise<StatuslineIdentity> {
  const [model, version, cwd, home, configDir] = await Promise.all([
    host.model().catch(() => ''),
    host.version().catch(() => ''),
    host.cwd().catch(() => ''),
    host.home(),
    host.configDir(),
  ])
  const { dir, isWork: isWorkAccount } = configDirFor(personal, cwd, configDir, home ?? '')
  // The personal account keeps .claude.json at HOME. Others keep it in the config dir.
  const credsPath = dir.endsWith('/.claude') ? `${home}/.claude.json` : `${dir}/.claude.json`
  let email = 'unknown'
  try {
    const creds = JSON.parse(await host.readFile(credsPath)) as { oauthAccount?: { emailAddress?: string } }
    email = creds.oauthAccount?.emailAddress ?? 'unknown'
  } catch {
    email = 'unknown'
  }
  return { model, version, cwd, email, isWorkAccount }
}

// One `git status --porcelain=v2 --branch` gives the branch, the hash, the
// ahead count and the staged and unstaged file counts in one run.
export function parseStatus(text: string): Omit<StatuslineGit, 'insertions' | 'deletions' | 'worktree' | 'repoPath' | 'subject' | 'age'> {
  let branch = ''
  let hash = ''
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let upstream = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.oid ')) hash = line.slice(13, 20)
    else if (line.startsWith('# branch.head ')) branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      ahead = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
      behind = Number(/-(\d+)/.exec(line)?.[1] ?? 0)
    } else if (line.startsWith('? ')) untracked += 1
    else if (/^[12u] /.test(line)) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') staged += 1
      if (xy[1] !== '.') unstaged += 1
    }
  }
  if (branch === '(detached)' || branch === '') branch = hash
  return { branch, hash, ahead, behind, staged, unstaged, untracked, upstream }
}

export async function readGit(host: Host, cwd: string): Promise<StatuslineGit | null> {
  const status = await out(host, ['git', 'status', '--porcelain=v2', '--branch'], cwd)
  if (status === null) return null
  const [unstagedStat, stagedStat, gitDir, origin, head] = await Promise.all([
    out(host, ['git', 'diff', '--shortstat'], cwd),
    out(host, ['git', 'diff', '--cached', '--shortstat'], cwd),
    out(host, ['git', 'rev-parse', '--git-dir'], cwd),
    out(host, ['git', 'remote', 'get-url', 'origin'], cwd),
    out(host, ['git', 'log', '-1', '--format=%s%x1f%cr'], cwd),
  ])
  const [subject = '', age = ''] = (head ?? '').trim().split('\x1f')
  const a = parseShortstat(unstagedStat ?? '')
  const b = parseShortstat(stagedStat ?? '')
  const dir = (gitDir ?? '').trim()
  return {
    ...parseStatus(status),
    insertions: a.insertions + b.insertions,
    deletions: a.deletions + b.deletions,
    worktree: dir.includes('/worktrees/') ? dir.split('/').pop() ?? '' : '',
    repoPath: repoPathFromRemote(origin ?? ''),
    subject,
    age,
  }
}

// The gh account comes from the personal config's owner map. An owner it
// does not name uses gh's active login.
export async function readRemote(host: Host, git: StatuslineGit, cwd: string, now: number, accounts: Readonly<Record<string, string>>): Promise<StatuslineRemote | null> {
  const account = accounts[git.repoPath.split('/')[0] ?? '']
  let env: Record<string, string> | undefined
  if (account !== undefined) {
    const token = (await out(host, ['gh', 'auth', 'token', '--user', account], cwd))?.trim()
    if (token === undefined || token === '') return null
    env = { GH_TOKEN: token }
  }
  const issues = await out(host, ['gh', 'issue', 'list', '--repo', git.repoPath, '--state', 'open', '--json', 'number', '--limit', '500'], cwd, env)
  const prs = await out(host, ['gh', 'pr', 'list', '--repo', git.repoPath, '--head', git.branch, '--state', 'open', '--json', 'number,title'], cwd, env)
  let prNumber: number | null = null
  let prTitle = ''
  try {
    const first = (JSON.parse(prs ?? '[]') as Array<{ number: number; title: string }>)[0]
    prNumber = first?.number ?? null
    prTitle = first?.title ?? ''
  } catch {
    prNumber = null
  }
  let issueCount: number | null = null
  try {
    issueCount = issues === null ? null : (JSON.parse(issues) as unknown[]).length
  } catch {
    issueCount = null
  }
  return { issues: issueCount, prNumber, prTitle, fetchedAt: now }
}

// The inbox depth from the personal config's notes file, or 0 without one.
export async function readInbox(host: Host, cwd: string, inbox: PersonalConfig['inbox']): Promise<number> {
  if (inbox === null || cwd === '') return 0
  const path = `${cwd}/${inbox.file}`
  try {
    return (await host.exists(path)) ? inboxDepth(await host.readFile(path), inbox.heading) : 0
  } catch {
    return 0
  }
}
