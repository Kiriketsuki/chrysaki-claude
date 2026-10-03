// The values the chrysaki-statusline band draws from, held in $.state.

export type StatuslineWindow = {
  // Whole percent used, 0 to 100.
  percent: number
  // When the window resets, in epoch milliseconds. Absent when unknown.
  resetsAt?: number
}

export type StatuslineUsage = {
  ctxPercent?: number
  ctxTokens?: number
  ctxWindow: number
  fiveHour?: StatuslineWindow
  sevenDay?: StatuslineWindow
  costUsd?: number
  startedAt?: number
}

export type StatuslineIdentity = {
  model: string
  version: string
  cwd: string
  email: string
  isWorkAccount: boolean
}

export type StatuslineGit = {
  branch: string
  hash: string
  ahead: number
  staged: number
  unstaged: number
  insertions: number
  deletions: number
  worktree: string
  // owner/repo from the origin remote, or empty when it is not on GitHub.
  repoPath: string
}

export type StatuslineRemote = {
  issues: number | null
  prNumber: number | null
  prTitle: string
  // When this snapshot was taken, in epoch milliseconds.
  fetchedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'chrysaki-statusline': {
      usage: StatuslineUsage | null
      identity: StatuslineIdentity | null
      git: StatuslineGit | null
      remote: StatuslineRemote | null
      inbox: number
      phase: number
    }
  }
}
