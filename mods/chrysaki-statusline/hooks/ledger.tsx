// The ledger under the header: rows of cells on one fixed grid. Each cell
// opens with a filled jewel badge that names it and ends in a powerline edge.
// Each badge takes its own jewel: 5h Emerald, 7d Teal, ctx Royal Blue Lt,
// cache Amethyst Lt, git and diff Rhodolite.
// The badges are the only fills and the only separators. Cell bodies have no
// ground, so the window shows through between the figures. No I/O happens here.

import type { RenderElement } from 'claude-code'

import type { StatuslineWindow } from '../types'
import { cacheCard, toneColor } from './cache'
import type { BandData } from './draw'
import { CTX_AMBER_TOKENS, CTX_RED_TOKENS, barCells, isHandoffDue, kilo, marker, untilReset } from './format'
import { CORE, ROLE } from './palette'
import { hoverGroup, spaces, truncate } from './prims'
import type { Table } from './prims'

const EDGE = ''
// Empty bar cells: dim sockets in the Border colour.
const SOCKET = CORE.border
// The blank cells between two cells of a row.
export const CELL_GAP = 2
// The bar length at 120 columns and up, and below.
const BAR_LONG = 20
const BAR_SHORT = 14
// At this width and up, git shares the rows of usage and context.
export const LEDGER_WIDE = 200

// --- Badges ----------------------------------------------------------------------

type Badge = {
  key: string
  text: string
  bg: string
  width: number
  press?: { label: string; hotkey?: string; onPress: () => void }
}

// The badge, its edge in the badge colour on no ground, and one space.
function badge(T: Table, b: Badge): RenderElement[] {
  const { Box, Text, Button } = T
  const body = b.press === undefined
    ? <Text backgroundColor={b.bg} color={ROLE.text} bold>{` ${b.text}`.padEnd(b.width)}</Text>
    : (
      <Box key={`badge-${b.key}`} width={b.width} backgroundColor={b.bg}>
        <Text backgroundColor={b.bg}> </Text>
        <Button key={b.key} label={b.press.label} hotkey={b.press.hotkey} plain onPress={b.press.onPress} />
      </Box>
    )
  return [body, <Text color={b.bg}>{EDGE}</Text>, <Text> </Text>]
}

// --- Bars ------------------------------------------------------------------------

// A colour zone of a bar: cells up to `until` percent of its length.
type Zone = { until: number; color: string }

const USAGE_ZONES: readonly Zone[] = [
  { until: 50, color: ROLE.emeraldLt },
  { until: 75, color: ROLE.teal },
  { until: 90, color: ROLE.blondeLt },
  { until: Infinity, color: ROLE.error },
]

// The context zones sit at fixed token counts, so they move with the window.
function contextZones(window: number): Zone[] {
  const at = (tokens: number) => (tokens / Math.max(1, window)) * 100
  return [
    { until: at(CTX_AMBER_TOKENS), color: ROLE.emeraldLt },
    { until: at(CTX_RED_TOKENS), color: ROLE.blondeLt },
    { until: Infinity, color: ROLE.error },
  ]
}

function zoneAt(zones: readonly Zone[], position: number): string {
  return zones.find(z => position <= z.until)?.color ?? ROLE.error
}

type Bar = { el: RenderElement; reached: string }

// A bar coloured by the zone each cell sits in. `reached` is the colour of the
// last filled cell, or the text colour while the bar stays in its first zone.
function zoneBar(T: Table, d: BandData, pct: number, zones: readonly Zone[], length: number): Bar {
  const { Text } = T
  const cells = barCells(pct, d.barStyle, d.phase % 4, length)
  const colors = cells.map((c, i) => (c.isFilled ? zoneAt(zones, ((i + 1) / length) * 100) : SOCKET))
  const runs: { color: string; text: string }[] = []
  cells.forEach((c, i) => {
    const color = colors[i] ?? SOCKET
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === color) last.text += c.glyph
    else runs.push({ color, text: c.glyph })
  })
  const filled = cells.filter(c => c.isFilled).length
  const top = filled === 0 ? undefined : colors[filled - 1]
  const reached = top === undefined || top === zones[0]?.color ? ROLE.text : top
  return { el: <Text>{runs.map(r => <Text color={r.color}>{r.text}</Text>)}</Text>, reached }
}

// A bar in one colour, for the cache that drains as it cools.
function plainBar(T: Table, d: BandData, pct: number, color: string, length: number): RenderElement {
  return zoneBar(T, d, pct, [{ until: Infinity, color }], length).el
}

function emptyBar(T: Table, length: number): RenderElement {
  const { Text } = T
  return <Text color={SOCKET}>{'─'.repeat(length)}</Text>
}

// --- Cells -----------------------------------------------------------------------

// A fixed-width figure, padded on the side away from its column edge.
function fig(T: Table, text: string, width: number, color: string, opts: { bold?: boolean; right?: boolean } = {}): RenderElement {
  const { Text } = T
  const padded = opts.right ? text.padStart(width) : text.padEnd(width)
  return <Text color={color} bold={opts.bold}>{truncate(padded, width)}</Text>
}

function cell(T: Table, key: string, width: number, children: RenderElement[]): RenderElement {
  const { Box } = T
  return <Box key={key} width={width} overflow="hidden">{children}</Box>
}

// badge 6, edge and space 2, bar, 2, percent 4, 2, reset 8.
function usageWidth(bar: number): number {
  return 6 + 2 + bar + 2 + 4 + 2 + 8
}

// badge 9, edge and space 2, bar, 2, figure 4, 2, tokens 12, 2, key 12.
function contextWidth(bar: number): number {
  return 9 + 2 + bar + 2 + 4 + 2 + 12 + 2 + 12
}

function windowCell(T: Table, d: BandData, label: string, w: StatuslineWindow | undefined, bar: number): RenderElement {
  const { Text } = T
  const pct = w?.percent ?? 0
  const head = badge(T, { key: label, text: `${marker(pct, 50, 75)} ${label}`, bg: label === '5h' ? CORE.emerald : CORE.teal, width: 6 })
  if (w === undefined) return cell(T, `cell-${label}`, usageWidth(bar), [...head, emptyBar(T, bar)])
  const b = zoneBar(T, d, pct, USAGE_ZONES, bar)
  const reset = untilReset(w.resetsAt, d.now)
  const when = w.resetsAt === undefined ? 'reset time unknown' : `resets ${new Date(w.resetsAt).toISOString().slice(11, 16)} UTC, in ${reset}`
  return cell(T, `cell-${label}`, usageWidth(bar), [
    ...head,
    hoverGroup(T, `win-${label}`, `${label} window · ${pct}% used · ${when}`, [
      b.el,
      spaces(T, 2),
      fig(T, `${pct}%`, 4, b.reached, { bold: true, right: true }),
      spaces(T, 2),
      reset === '' ? spaces(T, 8) : <Text><Text color={ROLE.teal}>↻</Text><Text color={ROLE.sec}>{` ${reset}`.padEnd(7)}</Text></Text>,
    ]),
  ])
}

// The key at the end of the context row: handoff past 100k, resume in a
// fresh session with a handoff path on the clipboard, else fresh.
function contextKey(T: Table, d: BandData, tokens: number | undefined): RenderElement {
  const { Box, Text, Button } = T
  if (d.isHandingOff) return fig(T, '◐ handing off', 12, ROLE.warn, { bold: true })
  if (tokens === undefined && d.resumePath !== null) {
    return <Box key="resume-key"><Text color={ROLE.blondeLt} bold>⬢ </Text><Button key="resume" label="resume" hotkey="r" plain onPress={d.onResume} /></Box>
  }
  if (!isHandoffDue(tokens)) return fig(T, '◇ fresh', 12, ROLE.emeraldLt)
  return <Box key="handoff-key"><Text color={ROLE.blondeLt} bold>⬢ </Text><Button key="handoff" label="handoff" hotkey="h" plain onPress={d.onHandoff} /></Box>
}

function contextCell(T: Table, d: BandData, bar: number): RenderElement {
  const { Text } = T
  const u = d.usage
  const tokens = u?.ctxTokens
  const head = badge(T, { key: 'ctx-detail', text: '', bg: CORE.blueLight, width: 9, press: { label: `${marker(u?.ctxPercent ?? 0, 50, 75)} ctx`, onPress: d.onContext } })
  if (u?.ctxPercent === undefined) {
    const name = d.resumePath === null ? 'no context yet' : d.resumePath.slice(d.resumePath.lastIndexOf('/') + 1).replace(/\.md$/, '')
    return cell(T, 'cell-ctx', contextWidth(bar), [
      ...head, emptyBar(T, bar), spaces(T, 2 + 4 + 2), fig(T, name, 12, ROLE.muted), spaces(T, 2), contextKey(T, d, undefined),
    ])
  }
  const b = zoneBar(T, d, u.ctxPercent, contextZones(u.ctxWindow), bar)
  const used = tokens === undefined ? '' : kilo(tokens)
  const of = ` / ${kilo(u.ctxWindow)}`
  return cell(T, 'cell-ctx', contextWidth(bar), [
    ...head,
    hoverGroup(T, 'ctx', `context ${u.ctxPercent}% · ${tokens ?? '?'} of ${u.ctxWindow} tokens · amber from 250k, red from 500k · handoff at 100k · press ctx for the breakdown`, [
      b.el,
      spaces(T, 2),
      fig(T, `${u.ctxPercent}%`, 4, b.reached, { bold: true, right: true }),
      spaces(T, 2),
      <Text><Text color={ROLE.text} bold>{used}</Text><Text color={ROLE.sec}>{of.padEnd(12 - used.length)}</Text></Text>,
      spaces(T, 2),
      contextKey(T, d, tokens),
    ]),
  ])
}

const CACHE_STATE = { warm: '● warm', warning: '◐ cooling', cold: '○ cold' } as const

function cacheCell(T: Table, d: BandData, bar: number): RenderElement {
  const head = badge(T, { key: 'cache', text: '⧗ cache', bg: CORE.amethystLight, width: 9 })
  const c = d.cache
  const v = d.cacheView
  if (c === null || v === null) {
    return cell(T, 'cell-cache', contextWidth(bar), [...head, emptyBar(T, bar), spaces(T, 2), fig(T, '…', 4, ROLE.muted, { right: true })])
  }
  const color = toneColor(v.tone)
  const ttlMs = c.ttl === '1h' ? 3600000 : 300000
  const leftMs = c.expiresAt === undefined ? 0 : Math.max(0, c.expiresAt - d.now)
  const pct = v.tone === 'cold' ? 0 : Math.round((leftMs / ttlMs) * 100)
  return cell(T, 'cell-cache', contextWidth(bar), [
    ...head,
    hoverGroup(T, 'cache', cacheCard(c, v), [
      plainBar(T, d, pct, color, bar),
      spaces(T, 2),
      fig(T, v.tone === 'cold' ? '0m' : v.label, 4, ROLE.text, { bold: true, right: true }),
      spaces(T, 2),
      fig(T, `ttl ${c.ttl}`, 12, ROLE.sec),
      spaces(T, 2),
      fig(T, CACHE_STATE[v.tone], 12, v.tone === 'cold' ? ROLE.muted : color, { bold: v.tone !== 'warm' }),
    ]),
  ])
}

// --- Git -------------------------------------------------------------------------

// One count: a zero dims the whole item, a count above zero lights its icon.
function count(T: Table, icon: string, n: number, word: string, color: string): RenderElement {
  const { Text } = T
  if (n === 0) return <Text color={ROLE.muted}>{`${icon} 0 ${word}`}</Text>
  return <Text><Text color={color}>{icon}</Text><Text color={ROLE.text} bold>{` ${n}`}</Text><Text color={ROLE.sec}>{` ${word}`}</Text></Text>
}

// Row one: branch, ahead and behind, then the commit at HEAD. Row two: the
// diff, the file counts, then the pull request and issues when there are any.
function gitCells(T: Table, d: BandData, width: number): [RenderElement, RenderElement] {
  const { Text } = T
  const g = d.git
  const key = d.hasGitCommand
    ? badge(T, { key: 'git-pane', text: '', bg: CORE.rhodolite, width: 8, press: { label: 'git', hotkey: 'g', onPress: d.onGit } })
    : badge(T, { key: 'git', text: '⎇ git', bg: CORE.rhodolite, width: 8 })
  const diff = badge(T, { key: 'diff', text: '± diff', bg: CORE.rhodolite, width: 8 })
  const body = width - 10
  if (g === null) {
    return [cell(T, 'git-a', width, [...key, <Text color={ROLE.muted}>no git repository</Text>]), cell(T, 'git-b', width, [...diff])]
  }
  const r = d.remote
  const tree = g.worktree ? ` ⌥ ${g.worktree}` : ''
  const sync = g.upstream ? [`↑${g.ahead}`, `↓${g.behind}`] : ['no upstream']
  const head = `⎇ ${g.branch}${tree}  ${sync.join(' ')}  ⊙ ${g.hash} `
  const age = g.age ? ` · ${g.age}` : ''
  const subject = truncate(g.subject, body - head.length - age.length)
  const rowA = cell(T, 'git-a', width, [
    ...key,
    hoverGroup(T, 'branch', `${g.repoPath || 'no GitHub remote'} · ${g.branch} → ${g.upstream || 'no upstream'} · ${g.ahead} ahead, ${g.behind} behind`, [
      <Text color={ROLE.teal}>⎇ </Text>,
      <Text color={ROLE.text} bold>{g.branch}</Text>,
      <Text color={ROLE.sec}>{tree}</Text>,
    ]),
    spaces(T, 2),
    ...(g.upstream
      ? [
        <Text color={g.ahead > 0 ? ROLE.emeraldLt : ROLE.muted}>{`↑${g.ahead}`}</Text>,
        <Text color={g.behind > 0 ? ROLE.blondeLt : ROLE.muted}>{` ↓${g.behind}`}</Text>,
      ]
      : [<Text color={ROLE.muted}>no upstream</Text>]),
    spaces(T, 2),
    <Text color={ROLE.teal}>{`⊙ ${g.hash} `}</Text>,
    hoverGroup(T, 'subject', g.subject, [<Text color={ROLE.text}>{subject}</Text>]),
    <Text color={ROLE.sec}>{age}</Text>,
  ])
  const isClean = g.insertions + g.deletions === 0
  const pr = r?.prNumber == null ? null : r
  const rowB = cell(T, 'git-b', width, [
    ...diff,
    <Text color={isClean ? ROLE.muted : ROLE.emeraldLt}>{`+${g.insertions}`}</Text>,
    <Text color={isClean ? ROLE.muted : ROLE.error}>{` -${g.deletions}`}</Text>,
    spaces(T, 2),
    count(T, '●', g.staged, 'staged', ROLE.emeraldLt),
    spaces(T, 2),
    count(T, '✚', g.unstaged, 'unstaged', ROLE.blondeLt),
    spaces(T, 2),
    count(T, '?', g.untracked, 'untracked', ROLE.teal),
    ...(pr === null ? [] : [
      spaces(T, 2),
      hoverGroup(T, 'pr', pr.prTitle || `PR #${pr.prNumber}`, [<Text color={ROLE.teal}>⇄ </Text>, <Text color={ROLE.text}>{`PR #${pr.prNumber}`}</Text>]),
    ]),
    ...(r?.issues ? [spaces(T, 2), <Text color={ROLE.blondeLt}>◌ </Text>, <Text color={ROLE.sec}>{`${r.issues} issues`}</Text>] : []),
  ])
  return [rowA, rowB]
}

// --- Layout ----------------------------------------------------------------------

// The ledger rows for a band `inner` columns wide. At LEDGER_WIDE and up, git
// shares the two rows. Below it, git takes two rows of its own.
export function ledgerRows(T: Table, d: BandData, inner: number): RenderElement[] {
  const { Box } = T
  const bar = d.columns >= 120 ? BAR_LONG : BAR_SHORT
  const u = d.usage
  const left = [
    [windowCell(T, d, '5h', u?.fiveHour, bar), contextCell(T, d, bar)],
    [windowCell(T, d, '7d', u?.sevenDay, bar), cacheCell(T, d, bar)],
  ]
  const leftWidth = usageWidth(bar) + CELL_GAP + contextWidth(bar)
  const isWide = d.columns >= LEDGER_WIDE
  const gitWidth = isWide ? inner - 1 - leftWidth - CELL_GAP : inner - 1
  const [gitA, gitB] = gitCells(T, d, gitWidth)
  const row = (key: string, children: RenderElement[]) => <Box key={key} paddingLeft={1}>{children}</Box>
  const bars = left.map(([a, b]) => [a as RenderElement, spaces(T, CELL_GAP), b as RenderElement])
  if (isWide) {
    return [
      row('row-0', [...(bars[0] ?? []), spaces(T, CELL_GAP), gitA]),
      row('row-1', [...(bars[1] ?? []), spaces(T, CELL_GAP), gitB]),
    ]
  }
  return [row('row-0', bars[0] ?? []), row('row-1', bars[1] ?? []), row('row-2', [gitA]), row('row-3', [gitB])]
}
