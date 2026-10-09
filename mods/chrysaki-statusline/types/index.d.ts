// The values the chrysaki-statusline band draws from, held in $.state.

export type StatuslineWindow = {
  // Whole percent used, 0 to 100.
  percent: number
  // When the window resets, in epoch milliseconds. Absent when unknown.
  resetsAt?: number
}

// The band protocol: one item another mod or process contributes to the
// header, checked against protocol/chrysaki-band/band.d.ts.
export type BandTone = 'calm' | 'info' | 'accent' | 'warn' | 'alert'

export type BandEntry = {
  // The file's source name, then the item's own id.
  source: string
  id: string
  icon?: string
  text: string
  tone: BandTone
  hint?: string
  command?: string
  args?: string
  hotkey?: string
  rank: number
}

// One rate-limit reading: epoch milliseconds, then the percent used.
export type Sample = readonly [number, number]

// The 5h and 7d readings over time, per account, for the braille sparks.
export type UsageHistory = { fiveHour: Sample[]; sevenDay: Sample[] }

export type StatuslineUsage = {
  ctxPercent?: number
  ctxTokens?: number
  ctxWindow: number
  fiveHour?: StatuslineWindow
  sevenDay?: StatuslineWindow
  costUsd?: number
  startedAt?: number
  // Weekly limits that cover one model, from the OAuth usage endpoint.
  scoped?: StatuslineScopedLimit[]
}

export type StatuslineScopedLimit = {
  // The model the limit covers, such as Fable.
  label: string
  percent: number
  resetsAt?: number
}

// The last fetch of the OAuth usage endpoint.
export type LimitsFetch = {
  isBusy: boolean
  // When the last fetch started, in epoch milliseconds.
  at?: number
  // Why the last fetch failed. Absent after a success.
  error?: string
}

// The worst open incident on the Claude status page.
export type StatuslineOutage = {
  impact: 'minor' | 'major' | 'critical'
  name: string
  // Open incidents in all.
  count: number
  url: string
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
  behind: number
  staged: number
  unstaged: number
  untracked: number
  // The upstream branch, for example origin/main, or empty without one.
  upstream: string
  // The subject and relative age of the commit at HEAD.
  subject: string
  age: string
  insertions: number
  deletions: number
  worktree: string
  // owner/repo from the origin remote, or empty when it is not on GitHub.
  repoPath: string
}

// The lag badge, from the chrysaki-lag state file.
export type StatuslineLag = {
  level: 'busy' | 'laggy'
  bound: 'io' | 'mem' | 'cpu'
  // The bound resource's pressure share over 10 s, in percent.
  pct: number
  // The top causes, as `label detail` lines for the hover card.
  top: string[]
}

// The worst health warning from the chrysaki-lag state file.
export type StatuslineWarn = {
  level: 'warn' | 'crit'
  // The badge text, such as `/home 91%`.
  short: string
  // How many other warnings show.
  more: number
}

// The codeKs badge, from the heartbeat that `codeks inboxd` writes. `up`: the
// Codex app-server answers. `down`: inboxd runs but the app-server does not.
// `off`: the codeks mod is loaded, but no fresh heartbeat exists.
export type StatuslineCodeks = {
  state: 'up' | 'down' | 'off'
  live: number
  active: number
  exposed: number
}

// A new artifact the band offers to open for a share with the partner account.
export type ShareOffer = {
  url: string
  // The account that published it, and the account to share it with.
  owner: string
  partner: string
  // The owner's Firefox profile folder, or empty when no account entry names one.
  path: string
  at: number
}

// A /context-handoff run the mod watches, to copy the file path it writes.
export type PendingHandoff = {
  since: number
  // Where the copy goes: the surface of the press, or the session's surface.
  surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' | null
  path: string | null
  // Main-thread turns that ended with no handoff file found.
  misses: number
}

export type StatuslineRemote = {
  issues: number | null
  prNumber: number | null
  prTitle: string
  // When this snapshot was taken, in epoch milliseconds.
  fetchedAt: number
}

export type StatuslineCache = {
  // statusline: read from the statusLine stdin JSON on disk. inferred: timed
  // from the main thread's requests.
  source: 'statusline' | 'inferred'
  isWarm: boolean
  ttl: '5m' | '1h'
  // Epoch milliseconds. Absent when the cache holds nothing.
  expiresAt?: number
  hitRatio?: number
  misses?: number
  lastMissCause?: string
  recacheTokens?: number
}

export type CacheTone = 'warm' | 'warning' | 'cold'

export type CacheView = { label: string; tone: CacheTone }

// The expiry times already warned for, so each period alerts once.
export type CacheAlert = { warnedFor?: number; coldFor?: number }

// A Claude account and the Firefox user profile signed in to it.
export type StatuslineAccount = {
  email: string
  // The profile's name in the Firefox profile switcher.
  profile: string
  // The profile folder, absolute. Empty until the name resolves.
  path: string
  isWork: boolean
}

export type FirefoxProfile = { name: string; path: string }

// The account dropdown under the header. pick lists the accounts. add holds
// the draft of a new one.
export type AccountMenu = {
  mode: 'pick' | 'add'
  draftEmail: string
  draftProfile: string
}

// A /login the switcher started. BROWSER points at bin/open-in-profile until
// the account changes or the window lapses.
export type PendingLogin = {
  email: string
  since: number
  // The BROWSER value to put back, or null when it was unset.
  prevBrowser: string | null
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
      cache: StatuslineCache | null
      cacheView: CacheView | null
      cacheAlert: CacheAlert
      hasGitCommand: boolean
      handoff: PendingHandoff | null
      // A handoff path on the clipboard, shown as the resume key in a fresh session.
      resume: string | null
      accounts: StatuslineAccount[]
      profiles: FirefoxProfile[]
      accountMenu: AccountMenu | null
      login: PendingLogin | null
      // True while the hint drawer under the prompt is open.
      hintOpen: boolean
      limitsFetch: LimitsFetch
      outage: StatuslineOutage | null
      // The share offer for the newest artifact, until it is pressed or lapses.
      shareOffer: ShareOffer | null
      // The lag badge, or null while the machine is calm.
      lag: StatuslineLag | null
      warn: StatuslineWarn | null
      // The codeKs badge, or null without codeKs.
      codeks: StatuslineCodeks | null
      // The 5h and 7d readings over time, for the sparks.
      usageHistory: UsageHistory
      // The last context token counts of this session.
      ctxHistory: number[]
      // The fresh items other mods contribute through the band protocol.
      band: BandEntry[]
    }
  }
}
