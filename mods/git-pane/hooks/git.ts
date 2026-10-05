// Git reads and writes for the pane. Parsers are pure so the tests can feed
// them fixture output. Every command takes an argv array, never a shell line.

import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { GitBranch, GitCommit, GitDetail, GitFile, GitHead, GitLists, GitStash } from '../types'

export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

const US = '\x1f'
const NET_TIMEOUT_MS = 90000
const DETAIL_LINES = 400

// --- Parsers -------------------------------------------------------------

// Reads `git status --porcelain=v2 --branch -z --untracked-files=all`.
export function parseStatus(out: string): Omit<GitHead, 'root' | 'repo'> {
  const head = { branch: '', upstream: '', ahead: 0, behind: 0, oid: '', files: [] as GitFile[] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? ''
    if (entry.length === 0) continue
    if (entry.startsWith('# ')) {
      readHeader(head, entry)
      continue
    }
    const kind = entry[0]
    const f = entry.split(' ')
    const xy = f[1] ?? '..'
    if (kind === '1') head.files.push(file(f.slice(8).join(' '), null, xy, false))
    if (kind === '2') {
      head.files.push(file(f.slice(9).join(' '), parts[i + 1] ?? null, xy, false))
      i += 1
    }
    if (kind === 'u') head.files.push({ ...file(f.slice(10).join(' '), null, xy, false), isConflicted: true })
    if (kind === '?') head.files.push(file(entry.slice(2), null, '..', true))
  }
  return head
}

function readHeader(head: { branch: string; upstream: string; ahead: number; behind: number; oid: string }, entry: string): void {
  const [, key = '', ...rest] = entry.split(' ')
  const value = rest.join(' ')
  if (key === 'branch.head') head.branch = value === '(detached)' ? 'HEAD' : value
  if (key === 'branch.oid') head.oid = value.slice(0, 8)
  if (key === 'branch.upstream') head.upstream = value
  if (key === 'branch.ab') {
    const m = /\+(\d+) -(\d+)/.exec(value)
    head.ahead = Number(m?.[1] ?? 0)
    head.behind = Number(m?.[2] ?? 0)
  }
}

function file(path: string, orig: string | null, xy: string, isUntracked: boolean): GitFile {
  return { path, orig, x: xy[0] ?? '.', y: xy[1] ?? '.', isUntracked, isConflicted: false }
}

// Reads `git log --graph` with fields split by the unit separator. A line
// with no separator is a graph connector row.
export function parseLog(out: string): GitCommit[] {
  return out.split('\n').filter(line => line.length > 0).map(line => {
    const at = line.indexOf(US)
    if (at < 0) return { graph: line, hash: null, subject: '', author: '', when: '', refs: '' }
    const [hash = '', subject = '', author = '', when = '', refs = ''] = line.slice(at + 1).split(US)
    return { graph: line.slice(0, at), hash, subject, author, when, refs }
  })
}

export function parseBranches(out: string): GitBranch[] {
  return out.split('\n').filter(line => line.length > 0).map(line => {
    const [head = '', name = '', upstream = '', track = '', when = ''] = line.split(US)
    return { name, isHead: head === '*', upstream, track, when }
  })
}

export function parseStash(out: string): GitStash[] {
  return out.split('\n').filter(line => line.length > 0).map(line => {
    const [ref = '', subject = ''] = line.split(US)
    return { ref, subject }
  })
}

// Quotes one word for a POSIX shell. Only the commit goes through the Bash
// tool, so that other mods such as kilint-gate see it.
export function shQuote(word: string): string {
  return "'" + word.replace(/'/g, "'\\''") + "'"
}

// --- Loaders -------------------------------------------------------------

export async function loadHead(run: Run): Promise<GitHead | null> {
  const top = await run(['git', 'rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return null
  const root = top.stdout.trim()
  const status = await run(['git', '-C', root, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  if (status.exitCode !== 0) return null
  return { root, repo: root.split('/').pop() ?? root, ...parseStatus(status.stdout) }
}

export async function loadLists(run: Run, root: string): Promise<GitLists> {
  const [branches, log, stash, last] = await Promise.all([
    run(['git', '-C', root, 'for-each-ref', '--sort=-committerdate',
      '--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(committerdate:relative)',
      'refs/heads']),
    run(['git', '-C', root, 'log', '--graph', '--color=never', '-n', '60',
      '--format=%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D']),
    run(['git', '-C', root, 'stash', 'list', '--format=%gd%x1f%s']),
    run(['git', '-C', root, 'log', '-1', '--format=%h %s (%ar)']),
  ])
  return {
    branches: parseBranches(branches.stdout),
    log: parseLog(log.stdout),
    stash: parseStash(stash.stdout),
    last: last.stdout.trim(),
  }
}

function detail(title: string, out: string): GitDetail {
  const lines = out.split('\n')
  const cut = lines.length > DETAIL_LINES
  return { title, lines: cut ? [...lines.slice(0, DETAIL_LINES), `… ${lines.length - DETAIL_LINES} more lines`] : lines }
}

export async function fileDiff(run: Run, root: string, f: GitFile): Promise<GitDetail> {
  if (f.isUntracked) {
    // Exit code 1 is normal here: the files differ.
    const r = await run(['git', '-C', root, 'diff', '--no-index', '--', '/dev/null', f.path])
    return detail(`${f.path} (untracked)`, r.stdout)
  }
  const parts: string[] = []
  if (f.y !== '.') parts.push((await run(['git', '-C', root, 'diff', '--', f.path])).stdout)
  if (f.x !== '.') parts.push((await run(['git', '-C', root, 'diff', '--cached', '--', f.path])).stdout)
  return detail(f.path, parts.join('\n'))
}

export async function commitDiff(run: Run, root: string, hash: string): Promise<GitDetail> {
  const r = await run(['git', '-C', root, 'show', '--format=%h %s%n%an, %ar%n', '-M', hash])
  return detail(hash, r.stdout)
}

export async function branchLog(run: Run, root: string, name: string): Promise<GitDetail> {
  const r = await run(['git', '-C', root, 'log', '--graph', '--color=never', '-n', '30', '--format=%h %s (%ar)', name, '--'])
  return detail(name, r.stdout)
}

export async function stashDiff(run: Run, root: string, ref: string): Promise<GitDetail> {
  const r = await run(['git', '-C', root, 'stash', 'show', '-p', '--include-untracked', ref])
  return detail(ref, r.stdout)
}

// --- Writes --------------------------------------------------------------

export type Outcome = { isOk: boolean; text: string }

async function act(run: Run, argv: readonly string[], init?: ProcessRunInit): Promise<Outcome> {
  try {
    const r = await run(argv, init)
    const text = (r.exitCode === 0 ? r.stdout || r.stderr : r.stderr || r.stdout).trim()
    return { isOk: r.exitCode === 0, text: text.split('\n').slice(-3).join(' ') }
  } catch (error) {
    return { isOk: false, text: error instanceof Error ? error.message : String(error) }
  }
}

export function toggleStage(run: Run, root: string, f: GitFile): Promise<Outcome> {
  const isStaged = f.x !== '.' && f.y === '.' && !f.isUntracked
  return isStaged
    ? act(run, ['git', '-C', root, 'restore', '--staged', '--', f.path])
    : act(run, ['git', '-C', root, 'add', '--', f.path])
}

export function stageAll(run: Run, root: string, files: readonly GitFile[]): Promise<Outcome> {
  const isAllStaged = files.length > 0 && files.every(f => !f.isUntracked && f.y === '.')
  return isAllStaged
    ? act(run, ['git', '-C', root, 'reset', '-q'])
    : act(run, ['git', '-C', root, 'add', '-A'])
}

export function discard(run: Run, root: string, f: GitFile): Promise<Outcome> {
  return f.isUntracked
    ? act(run, ['git', '-C', root, 'clean', '-f', '--', f.path])
    : act(run, ['git', '-C', root, 'restore', '--staged', '--worktree', '--source=HEAD', '--', f.path])
}

export function checkout(run: Run, root: string, name: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'switch', name])
}

export function newBranch(run: Run, root: string, name: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'switch', '-c', name])
}

export function push(run: Run, root: string, hasUpstream: boolean): Promise<Outcome> {
  const argv = hasUpstream ? ['git', '-C', root, 'push'] : ['git', '-C', root, 'push', '-u', 'origin', 'HEAD']
  return act(run, argv, { timeoutMs: NET_TIMEOUT_MS })
}

export function pull(run: Run, root: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'pull', '--ff-only'], { timeoutMs: NET_TIMEOUT_MS })
}

export function fetch(run: Run, root: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'fetch', '--all', '--prune'], { timeoutMs: NET_TIMEOUT_MS })
}

export function stashPush(run: Run, root: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'stash', 'push', '--include-untracked'])
}

export function stashPop(run: Run, root: string, ref: string): Promise<Outcome> {
  return act(run, ['git', '-C', root, 'stash', 'pop', ref])
}
