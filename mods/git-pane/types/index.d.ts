export type GitFile = {
  path: string
  orig: string | null
  // Index (staged) and work tree (unstaged) status letters. `.` means no change.
  x: string
  y: string
  isUntracked: boolean
  isConflicted: boolean
}

export type GitBranch = {
  name: string
  isHead: boolean
  upstream: string
  track: string
  when: string
}

export type GitCommit = {
  graph: string
  hash: string | null
  subject: string
  author: string
  when: string
  refs: string
}

export type GitStash = { ref: string; subject: string }

export type GitHead = {
  root: string
  repo: string
  branch: string
  upstream: string
  ahead: number
  behind: number
  oid: string
  files: GitFile[]
}

export type GitLists = {
  branches: GitBranch[]
  log: GitCommit[]
  stash: GitStash[]
  last: string
}

export type GitTab = 'status' | 'files' | 'branches' | 'log' | 'stash'

export type GitMode = 'browse' | 'commit' | 'branch' | 'discard'

export type GitDetail = { title: string; lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    'git-pane': {
      head: GitHead | null
      lists: GitLists | null
      tab: GitTab
      selected: string | null
      detail: GitDetail | null
      busy: string | null
      note: string | null
      mode: GitMode
    }
  }
}
