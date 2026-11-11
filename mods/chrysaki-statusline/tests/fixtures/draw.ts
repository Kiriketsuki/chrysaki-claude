import { drawBand } from '../../hooks/draw'
import type { BandData } from '../../hooks/draw'

// A draw of the band with no engine. The engine of one Claude Code version
// refuses a Button that holds elements, so these tests build the tree
// themselves: `h` makes plain objects, and the element table names its types.
export type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] }

type Child = Node | string | number | boolean | null | undefined | readonly Child[]

function flat(children: readonly Child[]): (Node | string)[] {
  return children.flatMap((c): (Node | string)[] => {
    if (c === null || c === undefined || typeof c === 'boolean') return []
    if (Array.isArray(c)) return flat(c)
    if (typeof c === 'number') return [String(c)]
    return [c as Node | string]
  })
}

function make(type: unknown, props: Record<string, unknown> | null, ...children: Child[]): Node {
  return { type: String(type), props: props ?? {}, children: flat(children) }
}

export const TERMINAL = { Box: 'Box', Text: 'Text', Button: 'Button', Raster: 'Raster', Image: 'Image', Input: 'Input' }
export const DESKTOP = { Box: 'Box', Text: 'Text', Button: 'Button', Svg: 'Svg', Input: 'Input' }
export const MOBILE = { Box: 'Box', Text: 'Text', Button: 'Button', Svg: 'Svg', Input: 'Input' }

const NOW = Date.parse('2098-12-31T19:35:00Z')
const no = () => undefined

export function bandData(over: Partial<BandData> = {}): BandData {
  return {
    usage: {
      ctxPercent: 65, ctxTokens: 130000, ctxWindow: 200000,
      fiveHour: { percent: 80, resetsAt: NOW + 4 * 3600000 + 21 * 60000 },
      sevenDay: { percent: 20, resetsAt: NOW + 3 * 86400000 },
      costUsd: 2, startedAt: NOW - 3600000,
      scoped: [{ label: 'Fable', percent: 12 }],
    },
    identity: { model: 'claude-opus-5-5', version: '2.1.295', cwd: '/home/k/dots/chrysaki', email: 'kiriketsuki@gmail.com', isWorkAccount: false },
    git: {
      branch: 'main', hash: '9f25299', ahead: 2, behind: 0, staged: 0, unstaged: 2, untracked: 0, upstream: 'origin/main',
      subject: 'feat(ags): add Logitech mouse indicator and Solaar quick-control panel', age: '3 weeks ago',
      insertions: 112, deletions: 2, worktree: '', repoPath: 'someone/else',
    },
    remote: { issues: 3, prNumber: 35, prTitle: 'Draw the band', fetchedAt: NOW },
    inbox: 3, phase: 1, now: NOW, home: '/home/k', columns: 160,
    emblem: 'cube-emerald-plain', caption: '', isCrestOpen: true, onToggleCrest: no,
    surface: 'terminal', rowPx: 26, barStyle: 'line',
    history: {
      fiveHour: [[NOW - 4 * 3600000, 10], [NOW - 3 * 3600000, 30], [NOW - 3600000, 60], [NOW, 80]],
      sevenDay: [[NOW - 86400000, 5], [NOW, 20]],
    },
    ctxHistory: [20000, 60000, 90000, 130000],
    isRuleAnimated: false, sweep: 0, usdToSgd: 1.35,
    isLimitsBusy: false, onRefreshLimits: no,
    outage: { impact: 'major', name: 'Elevated errors', count: 2, url: 'https://status.claude.com', components: ['Claude Code'], isMonitoring: false },
    share: null, onShare: no, lag: null, warn: null, onLag: no,
    band: [{ source: 'codex', id: 'a', icon: '\ue000', text: 'codex 0', tone: 'calm', command: 'codex', hotkey: 'x', rank: 1 }],
    onBand: no, onOutage: no, onContext: no,
    cache: { source: 'statusline', isWarm: true, ttl: '1h', expiresAt: NOW + 59 * 60000, recacheTokens: 90000 },
    cacheView: { label: '59m', tone: 'warm' },
    hasGitCommand: true, onGit: no,
    isHandingOff: false, onHandoff: no, resumePath: null, onResume: no,
    accounts: [
      { email: 'kiriketsuki@gmail.com', profile: 'Original profile', path: '/p/a', isWork: false },
      { email: 'jlim@aurrigo.com', profile: 'Work Claude', path: '/p/b', isWork: true },
    ],
    profiles: [{ name: 'Original profile', path: '/p/a' }],
    accountMenu: null, loginEmail: null, onAccounts: no, onPickAccount: no, onAddAccount: no, onCancelAdd: no,
    onDraftEmail: no, onDraftProfile: no, onSaveAccount: no,
    isHintOpen: false, onToggleHint: no,
    ...over,
  }
}

// Draws the band on the given element table and returns the tree. The global
// `h` is swapped for the call only, so the engine's own stays whole.
export function drawTree(table: Record<string, string>, d: BandData): Node {
  const g = globalThis as unknown as { h: unknown }
  const saved = g.h
  g.h = make
  try {
    return drawBand(table as never, d) as unknown as Node
  } finally {
    g.h = saved
  }
}

// The scenarios of the terminal snapshot: a key, and the data it draws.
export function scenarios(): Record<string, BandData> {
  const at = (columns: number, over: Partial<BandData> = {}) => bandData({ columns, ...over })
  const warning = { cache: { source: 'inferred' as const, isWarm: true, ttl: '5m' as const, expiresAt: NOW + 50000, recacheTokens: 90000 }, cacheView: { label: '0:50', tone: 'warning' as const } }
  return {
    '80': at(80),
    '130': at(130),
    '160': at(160),
    '238': at(238),
    '160-nocrest': at(160, { emblem: 'none' }),
    '238-nocrest': at(238, { emblem: 'none' }),
    '238-live': at(238, { isRuleAnimated: true, sweep: 7 }),
    '160-smooth': at(160, { barStyle: 'smooth' }),
    '160-nogit': at(160, { git: null, remote: null }),
    '160-nousage': at(160, { usage: null, cache: null, cacheView: null }),
    '160-menu': at(160, { accountMenu: { mode: 'pick', draftEmail: '', draftProfile: '' } }),
    '160-warning': at(160, warning),
    '160-live-warning': at(160, { isRuleAnimated: true, sweep: 3, ...warning }),
    '160-wave': at(160, { barStyle: 'wave' }),
    '160-resume': at(160, { usage: { ctxWindow: 200000 }, resumePath: '/home/k/.claude/handoffs/2026-10-05-band.md' }),
  }
}
